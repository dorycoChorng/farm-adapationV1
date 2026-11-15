import { CROPS } from '../../env/crops';
import type { EnvSummary } from '../../env/types';
import {
  STORED_RESULTS,
  getSummary,
  latestSummaryForParcel,
  latestSummaryNear,
  listCropProfiles,
  listRecommendations,
  recommend,
  saveSummary,
} from '../envRepository';
import { migrate } from '../migrations';
import { clearUserData, deleteParcel, saveParcel, storageStats } from '../repositories';
import { openTestDb } from '../__testutils__/sqljsAdapter';

// Synthetic summary: values exist only to exercise storage and offline scoring.
const at = '2026-01-01T00:00:00.000Z';
const summary: EnvSummary = {
  version: 1,
  location: { latitude: 0.0005, longitude: 0.0005 },
  ring: null,
  createdAt: at,
  climate: {
    status: 'ok',
    source: 'nasa-power',
    fetchedAt: at,
    data: {
      monthlyRainMm: new Array(12).fill(100),
      annualRainMm: 1200,
      monthlySolarKwhM2Day: new Array(12).fill(5),
      annualSolarKwhM2Day: 5,
      monthlyTempC: new Array(12).fill(26),
      annualTempC: 26,
      annualTempMaxC: 31,
      annualTempMinC: 21,
      period: 'synthetic',
    },
  },
  rainHistory: { status: 'error', source: 'nasa-power', fetchedAt: at, reason: 'offline' },
  terrain: { status: 'ok', source: 'aws-terrain', fetchedAt: at, data: { elevationM: 5, slopeDeg: 1, cellSizeM: 19 } },
  landCover: { status: 'ok', source: 'esa-worldcover', fetchedAt: at, data: { classAtPoint: 40, fractions: [{ code: 40, fraction: 1 }], samples: 1 } },
};
const square = [
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

describe('environment storage', () => {
  it('stores summaries and finds the latest per parcel and per point', async () => {
    const db = await freshDb();
    const parcel = await saveParcel(db, { name: 'Field', ring: square });
    await saveSummary(db, summary, parcel.id, 1000);
    const newer = await saveSummary(db, summary, parcel.id, 2000);
    const loose = await saveSummary(db, summary, null, 3000);
    expect((await latestSummaryForParcel(db, parcel.id))?.id).toBe(newer.id);
    expect((await latestSummaryNear(db, 0.0006, 0.0004))?.id).toBe(loose.id);
    expect(await latestSummaryNear(db, 1, 1)).toBeNull();
    expect((await getSummary(db, newer.id))?.summary).toEqual(summary);
    expect((await storageStats(db)).analyses).toBe(3);
  });

  it('scores crops offline from a stored summary and keeps the result', async () => {
    const db = await freshDb();
    const stored = await saveSummary(db, summary, null);
    const rec = (await recommend(db, stored, CROPS, 5000))!;
    expect(rec.results).toHaveLength(Math.min(STORED_RESULTS, CROPS.length));
    expect(rec.results.every((r) => r.confidence === 'low')).toBe(true); // soil missing
    expect((await listRecommendations(db, stored.id))[0]).toEqual(rec);
    expect((await listCropProfiles(db)).map((c) => c.id).sort()).toEqual(CROPS.map((c) => c.id).sort());
  });

  it('stores no recommendation when land cover does not confirm farmland', async () => {
    const db = await freshDb();
    const unseen = await saveSummary(db, { ...summary, landCover: { status: 'error', source: 'esa-worldcover', fetchedAt: at, reason: 'offline' } }, null);
    expect(await recommend(db, unseen, CROPS)).toBeNull();
    const sea = await saveSummary(db, { ...summary, landCover: { status: 'no-data', source: 'esa-worldcover', fetchedAt: at, reason: 'none' } }, null);
    expect(await recommend(db, sea, CROPS)).toBeNull();
    expect(await listRecommendations(db, unseen.id)).toEqual([]);
  });

  it('removes analyses with their parcel and when clearing data', async () => {
    const db = await freshDb();
    const parcel = await saveParcel(db, { name: 'Field', ring: square });
    const s = await saveSummary(db, summary, parcel.id);
    await recommend(db, s, CROPS);
    await deleteParcel(db, parcel.id);
    expect(await getSummary(db, s.id)).toBeNull();
    expect(await listRecommendations(db, s.id)).toEqual([]);
    await saveSummary(db, summary, null);
    await clearUserData(db);
    expect((await storageStats(db)).analyses).toBe(0);
  });
});
