import { CROP_PROFILE_SOURCE, CROP_PROFILE_VERSION, type CropProfile } from '../env/crops';
import { landCheck, rankCrops, type CropResult } from '../env/suitability';
import type { EnvSummary } from '../env/types';
import { newId } from './repositories';
import type { SqlDb } from './sql';

export interface StoredSummary {
  id: string;
  parcelId: string | null;
  summary: EnvSummary;
  createdAt: number;
}

export interface StoredRecommendation {
  id: string;
  summaryId: string;
  profileVersion: number;
  results: StoredCropResult[];
  createdAt: number;
}

interface SummaryRow {
  id: string;
  parcel_id: string | null;
  summary_json: string;
  created_at: number;
}

const toSummary = (r: SummaryRow): StoredSummary => ({
  id: r.id,
  parcelId: r.parcel_id,
  summary: JSON.parse(r.summary_json) as EnvSummary,
  createdAt: r.created_at,
});

export async function saveSummary(db: SqlDb, summary: EnvSummary, parcelId: string | null, now = Date.now()): Promise<StoredSummary> {
  const id = newId();
  await db.runAsync(
    'INSERT INTO env_summaries (id, parcel_id, latitude, longitude, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, parcelId, summary.location.latitude, summary.location.longitude, JSON.stringify(summary), now],
  );
  return { id, parcelId, summary, createdAt: now };
}

/** Replaces a saved analysis's content in place (used to attach the farmer's own soil test). */
export async function updateSummary(db: SqlDb, stored: StoredSummary, summary: EnvSummary): Promise<StoredSummary> {
  await db.runAsync('UPDATE env_summaries SET summary_json = ? WHERE id = ?', [JSON.stringify(summary), stored.id]);
  return { ...stored, summary };
}

export async function getSummary(db: SqlDb, id: string): Promise<StoredSummary | null> {
  const row = await db.getFirstAsync<SummaryRow>('SELECT * FROM env_summaries WHERE id = ?', [id]);
  return row ? toSummary(row) : null;
}

/** The newest saved analysis for a parcel. */
export async function latestSummaryForParcel(db: SqlDb, parcelId: string): Promise<StoredSummary | null> {
  const row = await db.getFirstAsync<SummaryRow>('SELECT * FROM env_summaries WHERE parcel_id = ? ORDER BY created_at DESC LIMIT 1', [
    parcelId,
  ]);
  return row ? toSummary(row) : null;
}

/** The newest saved analysis within about 50 m of a point (for unsaved locations). */
export async function latestSummaryNear(db: SqlDb, latitude: number, longitude: number): Promise<StoredSummary | null> {
  const d = 0.0005;
  const row = await db.getFirstAsync<SummaryRow>(
    `SELECT * FROM env_summaries WHERE parcel_id IS NULL AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
     ORDER BY created_at DESC LIMIT 1`,
    [latitude - d, latitude + d, longitude - d, longitude + d],
  );
  return row ? toSummary(row) : null;
}

/** Keep the crop catalogue in SQLite for offline use; rewritten only when the catalogue version changes. */
export function upsertCropProfiles(db: SqlDb, crops: CropProfile[], now = Date.now()): Promise<void> {
  // One rewrite at a time per database: leaving and reopening the crop screen quickly
  // would otherwise start a second transaction inside the first.
  const running = upserts.get(db);
  if (running) return running;
  const job = writeCropProfiles(db, crops, now).finally(() => upserts.delete(db));
  upserts.set(db, job);
  return job;
}

const upserts = new WeakMap<SqlDb, Promise<void>>();

async function writeCropProfiles(db: SqlDb, crops: CropProfile[], now: number): Promise<void> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM crop_profiles WHERE version = ?', [CROP_PROFILE_VERSION]);
  if (row && row.n === crops.length) return;
  await db.execAsync('BEGIN');
  try {
    await db.runAsync('DELETE FROM crop_profiles', []);
    for (const c of crops) {
      await db.runAsync('INSERT INTO crop_profiles (id, version, source, profile_json, updated_at) VALUES (?, ?, ?, ?, ?)', [
        c.id,
        CROP_PROFILE_VERSION,
        CROP_PROFILE_SOURCE,
        JSON.stringify(c),
        now,
      ]);
    }
    await db.execAsync('COMMIT');
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }
}

export async function listCropProfiles(db: SqlDb): Promise<CropProfile[]> {
  const rows = await db.getAllAsync<{ profile_json: string }>('SELECT profile_json FROM crop_profiles ORDER BY id', []);
  return rows.map((r) => JSON.parse(r.profile_json) as CropProfile);
}

/** Scores and stores crops for a saved analysis; null (nothing stored) when land cover doesn't confirm farmland. */
/** A crop result as stored with a recommendation: no month-by-month detail. */
export type StoredCropResult = Omit<CropResult, 'months' | 'irrigatedMonths'>;

/** How many top results a stored recommendation keeps. */
export const STORED_RESULTS = 40;

export async function recommend(db: SqlDb, stored: StoredSummary, crops: CropProfile[], now = Date.now()): Promise<StoredRecommendation | null> {
  if (!landCheck(stored.summary).ok) return null;
  await upsertCropProfiles(db, crops, now);
  const results = rankCrops(stored.summary, crops);
  const id = newId();
  // Every crop is scored, but only the best are kept (without month-by-month detail) as the record.
  const kept: StoredCropResult[] = results.slice(0, STORED_RESULTS).map(({ months: _m, irrigatedMonths: _i, ...r }) => r);
  await db.runAsync('INSERT INTO recommendations (id, summary_id, profile_version, results_json, created_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    stored.id,
    CROP_PROFILE_VERSION,
    JSON.stringify(kept),
    now,
  ]);
  return { id, summaryId: stored.id, profileVersion: CROP_PROFILE_VERSION, results: kept, createdAt: now };
}

export async function listRecommendations(db: SqlDb, summaryId: string): Promise<StoredRecommendation[]> {
  const rows = await db.getAllAsync<{ id: string; summary_id: string; profile_version: number; results_json: string; created_at: number }>(
    'SELECT * FROM recommendations WHERE summary_id = ? ORDER BY created_at DESC',
    [summaryId],
  );
  return rows.map((r) => ({
    id: r.id,
    summaryId: r.summary_id,
    profileVersion: r.profile_version,
    results: JSON.parse(r.results_json) as StoredCropResult[],
    createdAt: r.created_at,
  }));
}
