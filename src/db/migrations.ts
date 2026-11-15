import type { SqlDb } from './sql';

/**
 * Ordered schema migrations; index + 1 is the resulting PRAGMA user_version.
 * Append new migrations, never edit shipped ones.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS saved_locations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy_m REAL,
    altitude_m REAL,
    source TEXT NOT NULL,
    source_detail TEXT,
    is_farm_start INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS parcels (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    ring_json TEXT NOT NULL,
    vertex_count INTEGER NOT NULL,
    area_m2 REAL NOT NULL,
    perimeter_m REAL NOT NULL,
    method TEXT NOT NULL,
    location_id TEXT REFERENCES saved_locations(id) ON DELETE SET NULL,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS env_summaries (
    id TEXT PRIMARY KEY NOT NULL,
    parcel_id TEXT REFERENCES parcels(id) ON DELETE CASCADE,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    summary_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS env_summaries_parcel ON env_summaries(parcel_id, created_at);
  CREATE TABLE IF NOT EXISTS crop_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    version INTEGER NOT NULL,
    source TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recommendations (
    id TEXT PRIMARY KEY NOT NULL,
    summary_id TEXT NOT NULL REFERENCES env_summaries(id) ON DELETE CASCADE,
    profile_version INTEGER NOT NULL,
    results_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: SqlDb): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.execAsync(`BEGIN; ${MIGRATIONS[v]} PRAGMA user_version = ${v + 1}; COMMIT;`);
  }
}
