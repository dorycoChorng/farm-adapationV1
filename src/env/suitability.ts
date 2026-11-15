import { byScore, CROPS, type CropProfile, cycleMonths, type FactorKey, type Range } from './crops';
import type { Confidence, EnvSummary } from './types';

export type SuitabilityClass = 'high' | 'moderate' | 'marginal' | 'low' | 'unsuitable' | 'unknown';

export interface FactorResult {
  key: FactorKey;
  /** The site value used, or null when the data is missing (the factor is then not assessed). */
  value: number | null;
  score: number | null;
  range: Range;
  /** Where the value sits relative to the crop's range. */
  position: 'below' | 'low' | 'optimal' | 'high' | 'above' | 'missing';
}

/** The outcome of sowing in one month, from the climate over the crop's growing months. */
export interface MonthOption {
  month: number;
  score: number;
  /** Rain summed and temperature averaged over the growing months. */
  rainMm: number;
  tempC: number;
  limiting: FactorKey | null;
  /** Rain over the cycle is below the crop's preferred range. */
  rainShort: boolean;
}

export interface CropResult {
  cropId: string;
  /** 0–100 at the best sowing month: the limiting (lowest) factor score; null when fewer than two factors could be assessed. */
  score: number | null;
  suitability: SuitabilityClass;
  limiting: FactorKey | null;
  /** Factor values and scores at the best sowing month (or the annual values without monthly data). */
  factors: FactorResult[];
  confidence: Confidence;
  /** Growing months used for the seasonal check. */
  cycleMonths: number;
  /** Best sowing month; null for year-round crops or without monthly climate data. */
  bestMonth: number | null;
  /** Rain-fed result for sowing in each month (January first); empty without monthly climate data. */
  months: (MonthOption | null)[];
  /** Same, with any rain shortfall made up by irrigation. */
  irrigatedMonths: (MonthOption | null)[];
  /** Best irrigated option, only when it beats the rain-fed score by IRRIGATION_GAIN or more. */
  irrigated: MonthOption | null;
}

export interface SiteWarning {
  key: 'mostly-built' | 'mostly-water' | 'mostly-tree' | 'steep';
  /** Share of the area (0–1), or degrees for 'steep'. */
  value: number;
}

/** ECOCROP-style trapezoid membership. */
export function factorScore(v: number, r: Range): number {
  if (v < r.absMin || v > r.absMax) return 0;
  if (v >= r.optMin && v <= r.optMax) return 1;
  if (v < r.optMin) return r.optMin === r.absMin ? 1 : (v - r.absMin) / (r.optMin - r.absMin);
  return r.absMax === r.optMax ? 1 : (r.absMax - v) / (r.absMax - r.optMax);
}

function position(v: number, r: Range): FactorResult['position'] {
  if (v < r.absMin) return 'below';
  if (v > r.absMax) return 'above';
  if (v < r.optMin) return 'low';
  if (v > r.optMax) return 'high';
  return 'optimal';
}

export function classify(score: number | null): SuitabilityClass {
  if (score === null) return 'unknown';
  if (score >= 80) return 'high';
  if (score >= 60) return 'moderate';
  if (score >= 40) return 'marginal';
  if (score > 0) return 'low';
  return 'unsuitable';
}

export interface SiteValues {
  /** Long-term monthly averages, January first; null when the climate section has no data. */
  monthlyRainMm: (number | null)[] | null;
  monthlyTempC: (number | null)[] | null;
  annualRainMm: number | null;
  annualTempC: number | null;
  ph: number | null;
}

/** The site values the scores read, or null where that section has no data. */
export function siteValues(s: EnvSummary): SiteValues {
  const c = s.climate.status === 'ok' ? s.climate.data : null;
  return {
    monthlyRainMm: c ? c.monthlyRainMm : null,
    monthlyTempC: c ? c.monthlyTempC : null,
    annualRainMm: c ? c.annualRainMm : null,
    annualTempC: c ? c.annualTempC : null,
    // The farmer's own test first, then SoilGrids (250 m), then FAO's coarser soil map.
    ph: s.soilTest?.ph ?? (s.soil.status === 'ok' ? s.soil.data.properties.find((p) => p.key === 'phh2o')?.mean : null) ?? (s.hwsd?.status === 'ok' ? s.hwsd.data.ph : null) ?? null,
  };
}

const MIN_FACTORS = 2;
/** Minimum gain before the app suggests irrigation, so small differences don't clutter the screen. */
export const IRRIGATION_GAIN = 20;

function factorsFor(crop: CropProfile, values: Record<FactorKey, number | null>): FactorResult[] {
  return (['rain', 'temp', 'ph'] as FactorKey[]).map((key) => {
    const value = values[key];
    const range = crop.needs[key];
    if (value === null) return { key, value, score: null, range, position: 'missing' };
    return { key, value, score: Math.round(factorScore(value, range) * 100), range, position: position(value, range) };
  });
}

function limitingOf(factors: FactorResult[], skip?: (f: FactorResult) => boolean) {
  const assessed = factors.filter((f) => f.score !== null && !skip?.(f));
  if (assessed.length < MIN_FACTORS - (skip ? 1 : 0) || assessed.length === 0) return null;
  const worst = assessed.reduce((a, b) => ((b.score as number) < (a.score as number) ? b : a));
  return { score: worst.score as number, limiting: worst.score! < 100 ? worst.key : null };
}

const complete = (xs: (number | null)[] | null): xs is number[] => !!xs && xs.length === 12 && xs.every((x) => x !== null);

function monthOption(crop: CropProfile, site: SiteValues, month: number, length: number, irrigated: boolean): MonthOption | null {
  const months = Array.from({ length }, (_, k) => (month + k) % 12);
  const rain = months.reduce((a, m) => a + (site.monthlyRainMm as number[])[m], 0);
  const temp = months.reduce((a, m) => a + (site.monthlyTempC as number[])[m], 0) / length;
  const factors = factorsFor(crop, { rain, temp, ph: site.ph });
  const rainShort = rain < crop.needs.rain.optMin;
  // Irrigation can make up a shortfall in rain, not an excess.
  const r = limitingOf(factors, irrigated && rainShort ? (f) => f.key === 'rain' : undefined);
  if (!r) return null;
  return { month, score: r.score, rainMm: Math.round(rain), tempC: Number(temp.toFixed(1)), limiting: r.limiting, rainShort };
}

const best = (options: (MonthOption | null)[]) =>
  options.reduce<MonthOption | null>((a, b) => (b && (!a || b.score > a.score) ? b : a), null);

/**
 * Score a crop for a site. With monthly climate data, every sowing month is tried: rain
 * is summed and temperature averaged over the crop's growing months, and the best month
 * wins, as in Hijmans' ECOCROP model. Without it, annual values are used.
 */
export function scoreCrop(crop: CropProfile, site: SiteValues): CropResult {
  const length = cycleMonths(crop);
  const monthly = complete(site.monthlyRainMm) && complete(site.monthlyTempC);
  const months = monthly ? [...Array(12).keys()].map((m) => monthOption(crop, site, m, length, false)) : [];
  const irrigatedMonths = monthly ? [...Array(12).keys()].map((m) => monthOption(crop, site, m, length, true)) : [];
  const top = best(months);

  const factors = top
    ? factorsFor(crop, { rain: top.rainMm, temp: top.tempC, ph: site.ph })
    : factorsFor(crop, { rain: monthly ? null : site.annualRainMm, temp: monthly ? null : site.annualTempC, ph: site.ph });
  const overall = limitingOf(factors);
  const score = overall ? overall.score : null;
  let irrigated = best(irrigatedMonths);
  if (!irrigated || score === null || irrigated.score < score + IRRIGATION_GAIN) irrigated = null;
  const assessed = factors.filter((f) => f.score !== null).length;
  return {
    cropId: crop.id,
    score,
    suitability: classify(score),
    limiting: overall ? overall.limiting : null,
    factors,
    // Every input is modelled or coarse, so confidence never reaches "high".
    confidence: assessed === factors.length ? 'medium' : 'low',
    cycleMonths: length,
    bestMonth: top && length < 12 ? top.month : null,
    months,
    irrigatedMonths,
    irrigated,
  };
}

/** Months (0–11) in which sowing scores at least `min` without irrigation, in calendar order. */
export function goodSowMonths(result: Pick<CropResult, 'months'>, min = 50): number[] {
  return result.months.filter((o): o is MonthOption => !!o && o.score >= min).map((o) => o.month);
}

/** Months grouped into runs, wrapping over the new year: [10, 11, 0, 1, 5] → [[10, 1], [5, 5]]. */
export function monthRuns(months: number[]): [number, number][] {
  if (!months.length) return [];
  const set = new Set(months);
  if (set.size === 12) return [[0, 11]];
  // Start each run at a month whose previous month is not in the set.
  const starts = [...set].filter((m) => !set.has((m + 11) % 12)).sort((a, b) => a - b);
  return starts.map((start) => {
    let end = start;
    while (set.has((end + 1) % 12)) end = (end + 1) % 12;
    return [start, end] as [number, number];
  });
}

/** Score every crop, best first; crops that could not be scored go last. */
export function rankCrops(summary: EnvSummary, crops: CropProfile[] = CROPS): CropResult[] {
  const site = siteValues(summary);
  return crops
    .map((c) => scoreCrop(c, site))
    .sort(byScore);
}

/** Slope at which the app warns about erosion; ECOCROP has no slope limits, so slope is not scored. */
export const STEEP_DEG = 8;

/** Land-cover facts worth a warning even when crops are scored (e.g. clearing forest). */
export function siteWarnings(summary: EnvSummary): SiteWarning[] {
  const out: SiteWarning[] = [];
  if (summary.terrain.status === 'ok' && summary.terrain.data.slopeDeg !== null && summary.terrain.data.slopeDeg >= STEEP_DEG) {
    out.push({ key: 'steep', value: summary.terrain.data.slopeDeg });
  }
  if (summary.landCover.status !== 'ok') return out;
  const share = (code: number) => summary.landCover.status === 'ok' ? (summary.landCover.data.fractions.find((f) => f.code === code)?.fraction ?? 0) : 0;
  if (share(50) >= 0.2 && share(50) < 0.5) out.push({ key: 'mostly-built', value: share(50) });
  if (share(80) >= 0.2 && share(80) < 0.5) out.push({ key: 'mostly-water', value: share(80) });
  if (share(10) >= 0.5) out.push({ key: 'mostly-tree', value: share(10) });
  return out;
}

/** WorldCover classes that are not land a crop can be grown on: built-up, snow and ice, water, mangroves. */
export const NOT_FARMLAND = new Set([50, 70, 80, 95]);

export type LandCheck =
  | { ok: true; farmlandShare: number }
  | {
      ok: false;
      /**
       * unchecked: land cover could not be loaded, so the app can't see the land.
       * no-land: the source has no land here (open sea).
       * not-farmland: the place is mostly water, built-up, snow or mangrove.
       */
      reason: 'unchecked' | 'no-land' | 'not-farmland';
      /** The main non-farmland class, for not-farmland. */
      code?: number;
      farmlandShare?: number;
    };

/**
 * Crops are only recommended where land cover confirms there is land that could be
 * farmed. Without that check (offline at analysis time, a failed request, or open sea)
 * the app shows no crop advice at all rather than scores for a place it hasn't seen.
 */
export function landCheck(summary: EnvSummary): LandCheck {
  const lc = summary.landCover;
  if (lc.status === 'error') return { ok: false, reason: 'unchecked' };
  if (lc.status === 'no-data') return { ok: false, reason: 'no-land' };
  const farmland = lc.data.fractions.filter((f) => !NOT_FARMLAND.has(f.code)).reduce((a, f) => a + f.fraction, 0);
  const share = Number(farmland.toFixed(3));
  if (share >= 0.5) return { ok: true, farmlandShare: share };
  const main = lc.data.fractions.filter((f) => NOT_FARMLAND.has(f.code)).sort((a, b) => b.fraction - a.fraction)[0];
  return { ok: false, reason: 'not-farmland', code: main?.code, farmlandShare: share };
}
