import { measureParcel, normalizeRing } from '../geo/geodesy';
import type { LatLng } from '../geo/types';
import type { SqlDb } from './sql';

export type LocationSource = 'gps' | 'search' | 'map' | 'coordinates';

export interface SavedLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  source: LocationSource;
  /** Where the point came from, e.g. the geocoder's display name. */
  sourceDetail: string | null;
  isFarmStart: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ParcelMethod = 'map-tap';

export interface Parcel {
  id: string;
  name: string;
  ring: LatLng[];
  vertexCount: number;
  areaSquareMeters: number;
  perimeterMeters: number;
  method: ParcelMethod;
  locationId: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

interface LocationRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  altitude_m: number | null;
  source: LocationSource;
  source_detail: string | null;
  is_farm_start: number;
  created_at: number;
  updated_at: number;
}

interface ParcelRow {
  id: string;
  name: string;
  ring_json: string;
  vertex_count: number;
  area_m2: number;
  perimeter_m: number;
  method: ParcelMethod;
  location_id: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toLocation(r: LocationRow): SavedLocation {
  return {
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    accuracyMeters: r.accuracy_m,
    altitudeMeters: r.altitude_m,
    source: r.source,
    sourceDetail: r.source_detail,
    isFarmStart: r.is_farm_start === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toParcel(r: ParcelRow): Parcel {
  return {
    id: r.id,
    name: r.name,
    ring: JSON.parse(r.ring_json) as LatLng[],
    vertexCount: r.vertex_count,
    areaSquareMeters: r.area_m2,
    perimeterMeters: r.perimeter_m,
    method: r.method,
    locationId: r.location_id,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type NewLocation = Omit<SavedLocation, 'id' | 'createdAt' | 'updatedAt'>;

export async function insertLocation(db: SqlDb, input: NewLocation, now = Date.now()): Promise<SavedLocation> {
  const loc: SavedLocation = { ...input, id: newId(), createdAt: now, updatedAt: now };
  await db.runAsync(
    `INSERT INTO saved_locations (id, name, latitude, longitude, accuracy_m, altitude_m, source, source_detail, is_farm_start, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      loc.id,
      loc.name,
      loc.latitude,
      loc.longitude,
      loc.accuracyMeters,
      loc.altitudeMeters,
      loc.source,
      loc.sourceDetail,
      loc.isFarmStart ? 1 : 0,
      loc.createdAt,
      loc.updatedAt,
    ],
  );
  return loc;
}

export async function listLocations(db: SqlDb): Promise<SavedLocation[]> {
  const rows = await db.getAllAsync<LocationRow>('SELECT * FROM saved_locations ORDER BY updated_at DESC', []);
  return rows.map(toLocation);
}

export async function deleteLocation(db: SqlDb, id: string): Promise<void> {
  await db.runAsync('DELETE FROM saved_locations WHERE id = ?', [id]);
}

/** Offline search over saved places by name. */
export async function searchSavedLocations(db: SqlDb, query: string): Promise<SavedLocation[]> {
  const like = `%${query.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.getAllAsync<LocationRow>(
    "SELECT * FROM saved_locations WHERE name LIKE ? ESCAPE '\\' OR source_detail LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 20",
    [like, like],
  );
  return rows.map(toLocation);
}

export interface ParcelInput {
  name: string;
  ring: readonly LatLng[];
  locationId?: string | null;
  notes?: string | null;
}

/** Saves a parcel; area and perimeter are always recomputed from the ring, never taken from the caller. */
export async function saveParcel(
  db: SqlDb,
  input: ParcelInput,
  existingId?: string,
  now = Date.now(),
): Promise<Parcel> {
  const ring = normalizeRing(input.ring);
  if (ring.length < 3) throw new Error('A parcel needs at least three distinct boundary points.');
  const m = measureParcel(ring);
  const ringJson = JSON.stringify(ring.map((p) => ({ latitude: p.latitude, longitude: p.longitude })));

  if (existingId) {
    const existing = await getParcel(db, existingId);
    if (!existing) throw new Error(`Parcel ${existingId} not found`);
    await db.runAsync(
      `UPDATE parcels SET name = ?, ring_json = ?, vertex_count = ?, area_m2 = ?, perimeter_m = ?, location_id = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.name,
        ringJson,
        m.vertexCount,
        m.areaSquareMeters,
        m.perimeterMeters,
        input.locationId ?? existing.locationId,
        input.notes ?? existing.notes,
        now,
        existingId,
      ],
    );
    return (await getParcel(db, existingId))!;
  }

  const id = newId();
  await db.runAsync(
    `INSERT INTO parcels (id, name, ring_json, vertex_count, area_m2, perimeter_m, method, location_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'map-tap', ?, ?, ?, ?)`,
    [
      id,
      input.name,
      ringJson,
      m.vertexCount,
      m.areaSquareMeters,
      m.perimeterMeters,
      input.locationId ?? null,
      input.notes ?? null,
      now,
      now,
    ],
  );
  return (await getParcel(db, id))!;
}

export async function getParcel(db: SqlDb, id: string): Promise<Parcel | null> {
  const row = await db.getFirstAsync<ParcelRow>('SELECT * FROM parcels WHERE id = ?', [id]);
  return row ? toParcel(row) : null;
}

export async function listParcels(db: SqlDb): Promise<Parcel[]> {
  const rows = await db.getAllAsync<ParcelRow>('SELECT * FROM parcels ORDER BY updated_at DESC', []);
  return rows.map(toParcel);
}

export async function deleteParcel(db: SqlDb, id: string): Promise<void> {
  await db.runAsync('DELETE FROM parcels WHERE id = ?', [id]);
}

export async function getSetting(db: SqlDb, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(db: SqlDb, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

export interface StorageStats {
  locations: number;
  parcels: number;
  analyses: number;
  schemaVersion: number;
}

export async function storageStats(db: SqlDb): Promise<StorageStats> {
  const l = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM saved_locations', []);
  const p = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM parcels', []);
  const a = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM env_summaries', []);
  const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  return { locations: l?.n ?? 0, parcels: p?.n ?? 0, analyses: a?.n ?? 0, schemaVersion: v?.user_version ?? 0 };
}

/** Deletes all saved locations, parcels and analyses. Settings (such as language) are kept. */
export async function clearUserData(db: SqlDb): Promise<void> {
  await db.execAsync(
    'BEGIN; DELETE FROM recommendations; DELETE FROM env_summaries; DELETE FROM parcels; DELETE FROM saved_locations; COMMIT;',
  );
}
