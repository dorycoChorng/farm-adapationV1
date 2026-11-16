import * as ExpoLocation from 'expo-location';

/** The slice of expo-location this module uses; injectable so the flow can be unit-tested. */
export interface LocationApi {
  getForegroundPermissionsAsync(): Promise<ExpoLocation.LocationPermissionResponse>;
  requestForegroundPermissionsAsync(): Promise<ExpoLocation.LocationPermissionResponse>;
  hasServicesEnabledAsync(): Promise<boolean>;
  getCurrentPositionAsync(options?: ExpoLocation.LocationOptions): Promise<ExpoLocation.LocationObject>;
  getLastKnownPositionAsync(
    options?: ExpoLocation.LocationLastKnownOptions,
  ): Promise<ExpoLocation.LocationObject | null>;
}

export interface LocationFix {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy radius reported by the device, in metres (68% confidence on most platforms). */
  accuracyMeters: number | null;
  /** Altitude above the WGS84 ellipsoid as reported by the device; often unavailable or imprecise. */
  altitudeMeters: number | null;
  altitudeAccuracyMeters: number | null;
  /** Epoch milliseconds when the device produced the fix. */
  timestamp: number;
}

export type LocationPrecision = 'precise' | 'approximate';

export type LocationFailureReason =
  | 'permission-denied'
  | 'permission-blocked'
  | 'services-disabled'
  | 'unavailable'
  | 'timeout'
  | 'unknown';

export type LocationResult =
  | {
      ok: true;
      fix: LocationFix;
      precision: LocationPrecision;
      /** True when the reported accuracy is worse than {@link LOW_ACCURACY_THRESHOLD_METERS} or unknown. */
      lowAccuracy: boolean;
    }
  | {
      ok: false;
      reason: LocationFailureReason;
      /** On timeout, a recent cached fix the UI may offer, clearly labelled with its age. */
      lastKnown?: LocationFix;
      detail?: string;
    };

/** Above this radius a fix is too coarse to place parcel corners; the UI warns the user. */
export const LOW_ACCURACY_THRESHOLD_METERS = 25;
export const DEFAULT_TIMEOUT_MS = 20_000;
/** A cached fix older than this is not offered after a timeout. */
export const LAST_KNOWN_MAX_AGE_MS = 5 * 60_000;

export type PermissionState =
  | { status: 'granted'; precision: LocationPrecision }
  | { status: 'denied' }
  | { status: 'blocked' }
  | { status: 'undetermined' };

export function precisionOf(response: ExpoLocation.LocationPermissionResponse): LocationPrecision {
  if (response.android?.accuracy === 'coarse') return 'approximate';
  if (response.ios?.accuracy === 'reduced') return 'approximate';
  return 'precise';
}

export function permissionStateOf(response: ExpoLocation.LocationPermissionResponse): PermissionState {
  if (response.granted) return { status: 'granted', precision: precisionOf(response) };
  if (response.status === 'undetermined') return { status: 'undetermined' };
  return response.canAskAgain ? { status: 'denied' } : { status: 'blocked' };
}

/**
 * Prompts for foreground ("while using the app") permission only when the OS will
 * still show a prompt. Never requests background location.
 */
export async function ensureForegroundPermission(api: LocationApi = ExpoLocation): Promise<PermissionState> {
  const current = await api.getForegroundPermissionsAsync();
  if (current.granted) return permissionStateOf(current);
  if (current.status !== 'undetermined' && !current.canAskAgain) return { status: 'blocked' };
  const requested = await api.requestForegroundPermissionsAsync();
  const state = permissionStateOf(requested);
  // A dismissed prompt can come back as "undetermined"; treat it as a plain denial.
  return state.status === 'undetermined' ? { status: 'denied' } : state;
}

export function toFix(o: ExpoLocation.LocationObject): LocationFix {
  return {
    latitude: o.coords.latitude,
    longitude: o.coords.longitude,
    accuracyMeters: o.coords.accuracy ?? null,
    altitudeMeters: o.coords.altitude ?? null,
    altitudeAccuracyMeters: o.coords.altitudeAccuracy ?? null,
    timestamp: o.timestamp,
  };
}

export function isLowAccuracy(fix: LocationFix): boolean {
  return fix.accuracyMeters == null || fix.accuracyMeters > LOW_ACCURACY_THRESHOLD_METERS;
}

export function classifyLocationError(error: unknown): LocationFailureReason {
  const e = error as { code?: unknown; message?: unknown } | null;
  const text = `${typeof e?.code === 'string' ? e.code : ''} ${typeof e?.message === 'string' ? e.message : ''}`.toUpperCase();
  if (/SETTINGS_UNSATISFIED|SERVICES_DISABLED|SERVICESDISABLED/.test(text)) return 'services-disabled';
  if (/UNAUTHORIZED|PERMISSION|DENIED/.test(text)) return 'permission-denied';
  if (/UNAVAILABLE|UNKNOWN|REJECTED|CANCEL/.test(text)) return 'unavailable';
  return 'unknown';
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`No location fix within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface GetLocationOptions {
  timeoutMs?: number;
  now?: () => number;
}

/**
 * One-shot foreground location request, run only after the user taps "My Location"
 * and has read why the app needs it. There is no watch or background subscription.
 */
export async function getCurrentLocation(
  api: LocationApi = ExpoLocation,
  { timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now }: GetLocationOptions = {},
): Promise<LocationResult> {
  let permission: PermissionState;
  try {
    permission = await ensureForegroundPermission(api);
  } catch (error) {
    return { ok: false, reason: 'unknown', detail: String(error) };
  }
  if (permission.status === 'blocked') return { ok: false, reason: 'permission-blocked' };
  if (permission.status !== 'granted') return { ok: false, reason: 'permission-denied' };

  try {
    if (!(await api.hasServicesEnabledAsync())) return { ok: false, reason: 'services-disabled' };
  } catch {
    // Some platforms cannot report service state; fall through and let the fix attempt decide.
  }

  try {
    const position = await withTimeout(
      api.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Highest }),
      timeoutMs,
    );
    const fix = toFix(position);
    return { ok: true, fix, precision: permission.precision, lowAccuracy: isLowAccuracy(fix) };
  } catch (error) {
    if (error instanceof TimeoutError) {
      let lastKnown: LocationFix | undefined;
      try {
        const cached = await api.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
        if (cached && now() - cached.timestamp <= LAST_KNOWN_MAX_AGE_MS) lastKnown = toFix(cached);
      } catch {
        // No cached fix available.
      }
      return { ok: false, reason: 'timeout', lastKnown };
    }
    return { ok: false, reason: classifyLocationError(error), detail: String(error) };
  }
}
