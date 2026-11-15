import { countryAt } from '../geo/countryAt';
import type { LatLng } from '../geo/types';
import { climatologyUrl, lastCompleteYear, monthlyRainUrl, parseClimatology, parseMonthlyRain } from './power';
import { readLandCover, readTerrain } from './rasters';
import { readLocalProduction } from './gaez';
import { type FetchRange, fetchRange } from './tiff';
import type { EnvSummary, Section, SourceId } from './types';
import { readZones } from './zones';

export type FetchJson = (url: string, signal?: AbortSignal, options?: { timeoutMs?: number }) => Promise<unknown>;

const TIMEOUT_MS = 30000;

/** An HTTP failure, keeping the status the server answered with. */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}
const RAIN_HISTORY_YEARS = 10;

export const fetchJson: FetchJson = async (url, signal, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new HttpError(res.status);
    return await res.json();
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('timed out');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};

export interface AnalyzeDeps {
  fetchJson?: FetchJson;
  fetchRange?: FetchRange;
  now?: () => Date;
  signal?: AbortSignal;
  /** Called as each section finishes, with its result, so the screen can show it straight away. */
  onSection?: (key: SectionKey, section: Section<unknown>) => void;
}

export type SectionKey = 'climate' | 'rainHistory' | 'terrain' | 'landCover' | 'production' | 'zones';

async function section<T>(
  source: SourceId,
  now: () => Date,
  run: () => Promise<T | null>,
  noDataReason: string,
): Promise<Section<T>> {
  try {
    const data = await run();
    const fetchedAt = now().toISOString();
    return data === null ? { status: 'no-data', source, fetchedAt, reason: noDataReason } : { status: 'ok', source, fetchedAt, data };
  } catch (e) {
    return { status: 'error', source, fetchedAt: now().toISOString(), reason: (e as Error).message || String(e) };
  }
}

/**
 * Fetch every indicator for a point (and optional parcel boundary). Each source is
 * independent: one failing leaves the others intact, and the failure is recorded,
 * never replaced by a guess.
 */
export async function analyzeLocation(location: LatLng, ring: LatLng[] | null, deps: AnalyzeDeps = {}): Promise<EnvSummary> {
  const getJson = deps.fetchJson ?? fetchJson;
  const getRange = deps.fetchRange ?? fetchRange;
  const now = deps.now ?? (() => new Date());
  const done = <T extends Section<unknown>>(key: SectionKey) => (s: T) => {
    deps.onSection?.(key, s);
    return s;
  };
  const endYear = lastCompleteYear(now());

  const [climate, rainHistory, terrain, landCover, production, zones] = await Promise.all([
    section('nasa-power', now, async () => parseClimatology(await getJson(climatologyUrl(location), deps.signal)), 'no climate data for this point').then(done('climate')),
    section(
      'nasa-power',
      now,
      async () => {
        const h = parseMonthlyRain(await getJson(monthlyRainUrl(location, endYear - RAIN_HISTORY_YEARS + 1, endYear), deps.signal));
        return h.years.length ? h : null;
      },
      'no complete years returned',
    ).then(done('rainHistory')),
    section('aws-terrain', now, () => readTerrain(location, getRange, getJson), 'no elevation data here').then(done('terrain')),
    section('esa-worldcover', now, () => readLandCover(location, ring, getRange), 'no land cover here (open water or outside coverage)').then(
      done('landCover'),
    ),
    section('gaez', now, () => readLocalProduction(location, countryAt(location), getRange), 'no cropland recorded here').then(done('production')),
    section('esa-worldcover', now, () => readZones(location, ring, getRange, getJson), 'no land cover here').then(done('zones')),
  ]);

  // Soil is not predicted: the farmer enters their own soil test, which is kept across re-analyses.
  return { version: 1, location, ring, createdAt: now().toISOString(), climate, rainHistory, terrain, landCover, production, zones };
}

export function ageInDays(iso: string, now: Date) {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
}
