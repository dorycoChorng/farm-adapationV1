import type { LocationObject, LocationPermissionResponse } from 'expo-location';

import {
  classifyLocationError,
  getCurrentLocation,
  LAST_KNOWN_MAX_AGE_MS,
  type LocationApi,
} from '../locationService';

// Fake device responses for exercising the permission flow. The coordinates are
// test values, never shown to users.

function permission(overrides: Partial<LocationPermissionResponse>): LocationPermissionResponse {
  return {
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
    ...overrides,
  } as LocationPermissionResponse;
}

const GRANTED = permission({ status: 'granted' as never, granted: true });

function position(accuracy: number | null, timestamp = 1_000_000): LocationObject {
  return {
    coords: {
      latitude: 1.25,
      longitude: 2.5,
      altitude: 10,
      accuracy,
      altitudeAccuracy: 3,
      heading: null,
      speed: null,
    },
    timestamp,
  };
}

function fakeApi(overrides: Partial<Record<keyof LocationApi, jest.Mock>> = {}) {
  const api = {
    getForegroundPermissionsAsync: jest.fn().mockResolvedValue(permission({})),
    requestForegroundPermissionsAsync: jest.fn().mockResolvedValue(GRANTED),
    hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
    getCurrentPositionAsync: jest.fn().mockResolvedValue(position(5)),
    getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
  return api as typeof api & LocationApi;
}

describe('getCurrentLocation permission flow', () => {
  it('asks once, then returns a precise fix with accuracy', async () => {
    const api = fakeApi();
    const result = await getCurrentLocation(api);
    expect(api.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      precision: 'precise',
      lowAccuracy: false,
      fix: {
        latitude: 1.25,
        longitude: 2.5,
        accuracyMeters: 5,
        altitudeMeters: 10,
        altitudeAccuracyMeters: 3,
        timestamp: 1_000_000,
      },
    });
  });

  it('does not prompt again when permission is already granted', async () => {
    const api = fakeApi({ getForegroundPermissionsAsync: jest.fn().mockResolvedValue(GRANTED) });
    await getCurrentLocation(api);
    expect(api.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports a denial the user can retry', async () => {
    const api = fakeApi({
      requestForegroundPermissionsAsync: jest
        .fn()
        .mockResolvedValue(permission({ status: 'denied' as never, canAskAgain: true })),
    });
    expect(await getCurrentLocation(api)).toEqual({ ok: false, reason: 'permission-denied' });
    expect(api.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('treats a dismissed prompt as a denial', async () => {
    const api = fakeApi({ requestForegroundPermissionsAsync: jest.fn().mockResolvedValue(permission({})) });
    expect(await getCurrentLocation(api)).toEqual({ ok: false, reason: 'permission-denied' });
  });

  it('reports a permanent denial without prompting', async () => {
    const api = fakeApi({
      getForegroundPermissionsAsync: jest
        .fn()
        .mockResolvedValue(permission({ status: 'denied' as never, canAskAgain: false })),
    });
    expect(await getCurrentLocation(api)).toEqual({ ok: false, reason: 'permission-blocked' });
    expect(api.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports a permanent denial made at the prompt', async () => {
    const api = fakeApi({
      requestForegroundPermissionsAsync: jest
        .fn()
        .mockResolvedValue(permission({ status: 'denied' as never, canAskAgain: false })),
    });
    expect(await getCurrentLocation(api)).toEqual({ ok: false, reason: 'permission-blocked' });
  });

  it.each([
    ['Android coarse', { android: { accuracy: 'coarse' as const } }],
    ['iOS reduced', { ios: { scope: 'whenInUse' as const, accuracy: 'reduced' as const } }],
  ])('flags approximate location (%s)', async (_label, details) => {
    const api = fakeApi({
      requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ ...GRANTED, ...details }),
      getCurrentPositionAsync: jest.fn().mockResolvedValue(position(1500)),
    });
    const result = await getCurrentLocation(api);
    expect(result.ok && result.precision).toBe('approximate');
    expect(result.ok && result.lowAccuracy).toBe(true);
  });

  it('reports disabled location services before trying for a fix', async () => {
    const api = fakeApi({ hasServicesEnabledAsync: jest.fn().mockResolvedValue(false) });
    expect(await getCurrentLocation(api)).toEqual({ ok: false, reason: 'services-disabled' });
    expect(api.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('flags low accuracy and unknown accuracy', async () => {
    for (const accuracy of [80, null]) {
      const api = fakeApi({ getCurrentPositionAsync: jest.fn().mockResolvedValue(position(accuracy)) });
      const result = await getCurrentLocation(api);
      expect(result.ok && result.lowAccuracy).toBe(true);
    }
  });

  it('maps a GPS-unavailable error', async () => {
    const error = Object.assign(new Error('Current location is unavailable.'), {
      code: 'ERR_CURRENT_LOCATION_IS_UNAVAILABLE',
    });
    const api = fakeApi({ getCurrentPositionAsync: jest.fn().mockRejectedValue(error) });
    const result = await getCurrentLocation(api);
    expect(result.ok === false && result.reason).toBe('unavailable');
  });

  it('maps an unsatisfied-settings error to services disabled', async () => {
    const error = Object.assign(new Error('unsatisfied device settings'), {
      code: 'ERR_LOCATION_SETTINGS_UNSATISFIED',
    });
    const api = fakeApi({ getCurrentPositionAsync: jest.fn().mockRejectedValue(error) });
    const result = await getCurrentLocation(api);
    expect(result.ok === false && result.reason).toBe('services-disabled');
  });

  describe('timeout', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('times out and offers a recent cached fix', async () => {
      const now = 10_000_000;
      const api = fakeApi({
        getCurrentPositionAsync: jest.fn(() => new Promise(() => {})),
        getLastKnownPositionAsync: jest.fn().mockResolvedValue(position(12, now - 60_000)),
      });
      const pending = getCurrentLocation(api, { timeoutMs: 1000, now: () => now });
      await jest.advanceTimersByTimeAsync(1000);
      const result = await pending;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('timeout');
        expect(result.lastKnown?.accuracyMeters).toBe(12);
      }
      expect(api.getLastKnownPositionAsync).toHaveBeenCalledWith({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    });

    it('does not offer a stale cached fix', async () => {
      const now = 10_000_000;
      const api = fakeApi({
        getCurrentPositionAsync: jest.fn(() => new Promise(() => {})),
        getLastKnownPositionAsync: jest
          .fn()
          .mockResolvedValue(position(12, now - LAST_KNOWN_MAX_AGE_MS - 1)),
      });
      const pending = getCurrentLocation(api, { timeoutMs: 1000, now: () => now });
      await jest.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual({ ok: false, reason: 'timeout', lastKnown: undefined });
    });

    it('succeeds on retry after a timeout', async () => {
      const getCurrentPositionAsync = jest
        .fn()
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValueOnce(position(4));
      const api = fakeApi({ getCurrentPositionAsync });
      const first = getCurrentLocation(api, { timeoutMs: 1000 });
      await jest.advanceTimersByTimeAsync(1000);
      expect((await first).ok).toBe(false);
      const second = await getCurrentLocation(api, { timeoutMs: 1000 });
      expect(second.ok).toBe(true);
    });
  });
});

describe('classifyLocationError', () => {
  it.each([
    [{ code: 'ERR_LOCATION_UNAUTHORIZED' }, 'permission-denied'],
    [{ code: 'ERR_LOCATION_UNAVAILABLE' }, 'unavailable'],
    [{ code: 'ERR_LOCATION_SETTINGS_UNSATISFIED' }, 'services-disabled'],
    [{ message: 'something else' }, 'unknown'],
    [null, 'unknown'],
  ])('%j -> %s', (error, expected) => {
    expect(classifyLocationError(error)).toBe(expected);
  });
});
