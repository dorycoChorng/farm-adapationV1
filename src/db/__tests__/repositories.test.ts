import { measureParcel } from '../../geo/geodesy';
import type { LatLng } from '../../geo/types';
import { migrate, SCHEMA_VERSION } from '../migrations';
import {
  clearUserData,
  deleteLocation,
  getParcel,
  getSetting,
  insertLocation,
  listLocations,
  listParcels,
  saveParcel,
  searchSavedLocations,
  setSetting,
  storageStats,
} from '../repositories';
import { openTestDb } from '../__testutils__/sqljsAdapter';

// Synthetic test shapes only.
const square: LatLng[] = [
  { latitude: 0, longitude: 0 },
  { latitude: 0, longitude: 0.001 },
  { latitude: 0.001, longitude: 0.001 },
  { latitude: 0.001, longitude: 0 },
];

async function freshDb() {
  const db = await openTestDb();
  await migrate(db);
  return db;
}

describe('migrations', () => {
  it('creates the schema and is idempotent', async () => {
    const db = await freshDb();
    await migrate(db);
    expect((await storageStats(db)).schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('saved locations', () => {
  it('round-trips a GPS location with accuracy', async () => {
    const db = await freshDb();
    const saved = await insertLocation(db, {
      name: 'Test field gate',
      latitude: 1.5,
      longitude: 2.5,
      accuracyMeters: 6,
      altitudeMeters: null,
      source: 'gps',
      sourceDetail: null,
      isFarmStart: true,
    });
    const [loaded] = await listLocations(db);
    expect(loaded).toEqual(saved);
    expect(loaded.isFarmStart).toBe(true);
  });

  it('searches by name offline, escaping LIKE wildcards', async () => {
    const db = await freshDb();
    const base = {
      latitude: 0,
      longitude: 0,
      accuracyMeters: null,
      altitudeMeters: null,
      source: 'map' as const,
      sourceDetail: null,
      isFarmStart: false,
    };
    await insertLocation(db, { ...base, name: 'North rice field' });
    await insertLocation(db, { ...base, name: '100% mango' });
    expect((await searchSavedLocations(db, 'rice')).map((l) => l.name)).toEqual(['North rice field']);
    expect((await searchSavedLocations(db, '%')).map((l) => l.name)).toEqual(['100% mango']);
  });
});

describe('parcels', () => {
  it('stores the ring and recomputes area and perimeter', async () => {
    const db = await freshDb();
    const parcel = await saveParcel(db, { name: 'Plot A', ring: [...square, square[0]] });
    const expected = measureParcel(square);
    expect(parcel.vertexCount).toBe(4);
    expect(parcel.ring).toEqual(square);
    expect(parcel.areaSquareMeters).toBeCloseTo(expected.areaSquareMeters, 6);
    expect(parcel.perimeterMeters).toBeCloseTo(expected.perimeterMeters, 6);
  });

  it('updates an edited boundary in place', async () => {
    const db = await freshDb();
    const parcel = await saveParcel(db, { name: 'Plot A', ring: square }, undefined, 1000);
    const triangle = square.slice(0, 3);
    const edited = await saveParcel(db, { name: 'Plot A (edited)', ring: triangle }, parcel.id, 2000);
    expect(edited.id).toBe(parcel.id);
    expect(edited.vertexCount).toBe(3);
    expect(edited.areaSquareMeters).toBeCloseTo(parcel.areaSquareMeters / 2, 0);
    expect(edited.createdAt).toBe(1000);
    expect(edited.updatedAt).toBe(2000);
    expect(await listParcels(db)).toHaveLength(1);
  });

  it('refuses a boundary with fewer than three points', async () => {
    const db = await freshDb();
    await expect(saveParcel(db, { name: 'x', ring: square.slice(0, 2) })).rejects.toThrow(/three/);
  });

  it('keeps a parcel when its starting location is deleted', async () => {
    const db = await freshDb();
    const loc = await insertLocation(db, {
      name: 'Start',
      latitude: 0,
      longitude: 0,
      accuracyMeters: null,
      altitudeMeters: null,
      source: 'map',
      sourceDetail: null,
      isFarmStart: true,
    });
    const parcel = await saveParcel(db, { name: 'Plot', ring: square, locationId: loc.id });
    await deleteLocation(db, loc.id);
    expect((await getParcel(db, parcel.id))?.locationId).toBeNull();
  });
});

describe('settings and clearing', () => {
  it('upserts settings and keeps them when user data is cleared', async () => {
    const db = await freshDb();
    await setSetting(db, 'language', 'en');
    await setSetting(db, 'language', 'km');
    await saveParcel(db, { name: 'Plot', ring: square });
    await clearUserData(db);
    expect(await getSetting(db, 'language')).toBe('km');
    expect(await storageStats(db)).toMatchObject({ locations: 0, parcels: 0 });
  });
});
