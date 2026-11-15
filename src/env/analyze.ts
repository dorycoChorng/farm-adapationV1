import { countryAt } from '../geo/countryAt';
import type { LatLng } from '../geo/types';
import { climatologyUrl, lastCompleteYear, monthlyRainUrl, parseClimatology, parseMonthlyRain } from './power';
import { readLandCover, readTerrain } from './rasters';
import { readLocalProduction } from './gaez';
import { hwsdCovers, readHwsd } from './hwsd';
import { fetchSoilFromMaps, parseSoilGrids, soilGridsUrl } from './soilgrids';
import { type FetchRange, fetchRange } from './tiff';
import type { EnvSummary, Section, SourceId } from './types';
import { readZones } from './zones';

export type FetchJson = (url: string, signal?: AbortSignal, options?: { timeoutMs?: number }) => Promise<unknown>;

const TIMEOUT_MS = 30000;
/**
 * The SoilGrids REST API often takes 20–60 s and is sometimes down. Past this, the app
 * reads the same maps from ISRIC's map service instead (means only, no 5–95 % range).
 */
const SOIL_TIMEOUT_MS = 30000;

/** An HTTP failure, keeping the status so busy or broken servers can be retried. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterS: number | null,
  ) {
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
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new HttpError(res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
    }
    return await res.json();
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('timed out');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};

/**
 * Retry a request when the server is busy or briefly failing (429, 5xx, dropped
 * connections). SoilGrids in particular rate-limits and has short outages.
 */
export async function withRetry<T>(
  run: () => Promise<T>,
  { attempts = 3, delaysMs = [3000, 8000], signal, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) }: {
    attempts?: number;
    delaysMs?: number[];
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<unknown>;
  } = {},
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await run();
    } catch (e) {
      // A TypeError is fetch's dropped-connection error; timeouts are not retried (they already waited long).
      const retryable = e instanceof HttpError ? e.status === 429 || e.status >= 500 : e instanceof TypeError;
      if (!retryable || i >= attempts - 1 || signal?.aborted) throw e;
      const wait = e instanceof HttpError && e.retryAfterS !== null ? Math.min(e.retryAfterS * 1000, 30000) : (delaysMs[i] ?? delaysMs.at(-1) ?? 0);
      await sleep(wait);
    }
  }
}

export interface AnalyzeDeps {
  fetchJson?: FetchJson;
  fetchRange?: FetchRange;
  now?: () => Date;
  signal?: AbortSignal;
  /** Pause between retries; replaced in tests. */
  sleep?: (ms: number) => Promise<unknown>;
  /** Called as each section finishes, with its result, so the screen can show it straight away. */
  onSection?: (key: SectionKey, section: Section<unknown>) => void;
}

export type SectionKey = 'climate' | 'rainHistory' | 'soil' | 'terrain' | 'landCover' | 'hwsd' | 'production' | 'zones';

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

  const [climate, rainHistory, soil, terrain, landCover, production, zones, hwsd] = await Promise.all([
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
    section(
      'soilgrids',
      now,
      async () => {
        let body: unknown;
        try {
          body = await withRetry(() => getJson(soilGridsUrl(location), deps.signal, { timeoutMs: SOIL_TIMEOUT_MS }), {
            attempts: 2,
            signal: deps.signal,
            sleep: deps.sleep,
          });
        } catch (e) {
          if (deps.signal?.aborted) throw e;
          body = await fetchSoilFromMaps(location, getRange);
        }
        const s = parseSoilGrids(body);
        // SoilGrids returns nulls for water, built-up areas and gaps in the model.
        return s.properties.every((p) => p.mean === null) ? null : s;
      },
      'no soil estimate here (water, built-up area or outside the model)',
    ).then(done('soil')),
    section('aws-terrain', now, () => readTerrain(location, getRange, getJson), 'no elevation data here').then(done('terrain')),
    section('esa-worldcover', now, () => readLandCover(location, ring, getRange), 'no land cover here (open water or outside coverage)').then(
      done('landCover'),
    ),
    section('gaez', now, () => readLocalProduction(location, countryAt(location), getRange), 'no cropland recorded here').then(done('production')),
    section('esa-worldcover', now, () => readZones(location, ring, getRange, getJson), 'no land cover here').then(done('zones')),
    // Offline table, parsed last so every download above has already started.
    section(
      'hwsd',
      now,
      async () => readHwsd(location),
      hwsdCovers(location) ? 'no soil data here (water or town)' : 'outside the bundled area (Cambodia and its borders)',
    ).then(done('hwsd')),
  ]);

  return { version: 1, location, ring, createdAt: now().toISOString(), climate, rainHistory, soil, terrain, landCover, hwsd, production, zones };
}

export function ageInDays(iso: string, now: Date) {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
}
