import type { LatLng } from '../geo/types';
import { byScore } from './crops';
import { classify, type CropResult, IRRIGATION_GAIN, type MonthOption, type SuitabilityClass } from './suitability';
import type { ClimateData, EnvSummary } from './types';

/**
 * Seasons and season-by-season crop checks, computed from the long-term monthly
 * climate averages already saved with an analysis (so this works offline).
 *
 * In the tropics, seasons come from the rainfall itself: a month with at least
 * WET_MONTH_MM of average rain is a wet month, and each run of wet or dry months is a
 * season. Outside the tropics, the four meteorological seasons for the hemisphere are used.
 */

export const WET_MONTH_MM = 100;
const TROPIC_LAT = 23.44;

export type SeasonKind = 'wet' | 'dry' | 'spring' | 'summer' | 'autumn' | 'winter';

export interface Season {
  /** Stable id, e.g. "wet-4" for a wet season starting in May. */
  id: string;
  kind: SeasonKind;
  /** Month indexes (0 = January) in calendar order through the season. */
  months: number[];
  rainMm: number | null;
  meanTempC: number | null;
}

const sum = (xs: (number | null)[]) => (xs.some((x) => x === null) ? null : (xs as number[]).reduce((a, b) => a + b, 0));
const mean = (xs: (number | null)[]) => {
  const s = sum(xs);
  return s === null ? null : s / xs.length;
};
const pick = <T,>(arr: T[], months: number[]) => months.map((m) => arr[m]);

function season(kind: SeasonKind, months: number[], c: ClimateData): Season {
  const rain = sum(pick(c.monthlyRainMm, months));
  const temp = mean(pick(c.monthlyTempC, months));
  return {
    id: `${kind}-${months[0]}`,
    kind,
    months,
    rainMm: rain === null ? null : Math.round(rain),
    meanTempC: temp === null ? null : Number(temp.toFixed(1)),
  };
}

/** Wet/dry runs from monthly rain. Returns [] when any month is missing. */
function wetDrySeasons(c: ClimateData): Season[] {
  const rain = c.monthlyRainMm;
  if (rain.length !== 12 || rain.some((r) => r === null)) return [];
  const wet = rain.map((r) => (r as number) >= WET_MONTH_MM);
  if (wet.every((w) => w === wet[0])) return [season(wet[0] ? 'wet' : 'dry', [...Array(12).keys()], c)];
  // Start at a month where the wet/dry state changes so no run wraps around the year.
  const start = wet.findIndex((w, i) => w !== wet[(i + 11) % 12]);
  const out: Season[] = [];
  let run: number[] = [];
  for (let k = 0; k < 12; k++) {
    const m = (start + k) % 12;
    if (run.length && wet[m] !== wet[run[0]]) {
      out.push(season(wet[run[0]] ? 'wet' : 'dry', run, c));
      run = [];
    }
    run.push(m);
  }
  out.push(season(wet[run[0]] ? 'wet' : 'dry', run, c));
  return out.sort((a, b) => a.months[0] - b.months[0]);
}

function temperateSeasons(lat: number, c: ClimateData): Season[] {
  const north: [SeasonKind, number[]][] = [
    ['winter', [11, 0, 1]],
    ['spring', [2, 3, 4]],
    ['summer', [5, 6, 7]],
    ['autumn', [8, 9, 10]],
  ];
  const flip: Record<string, SeasonKind> = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' };
  return north
    .map(([kind, months]) => season(lat >= 0 ? kind : flip[kind], months, c))
    .sort((a, b) => a.months[0] - b.months[0]);
}

export function seasonsFor(location: LatLng, climate: ClimateData): Season[] {
  return Math.abs(location.latitude) < TROPIC_LAT ? wetDrySeasons(climate) : temperateSeasons(location.latitude, climate);
}

// ------------------------------------------------------------ crops per season

export interface SeasonCropResult {
  cropId: string;
  seasonId: string;
  /** Best sowing month within the season relying on rain alone; null when it can't be scored. */
  rainfed: MonthOption | null;
  /** Best sowing month in the season with irrigation, only when it clearly beats rain alone. */
  irrigated: MonthOption | null;
  suitability: SuitabilityClass;
  /** True for crops judged on the whole year (perennials): the season doesn't change them. */
  yearRound: boolean;
}

export interface SeasonalAssessment {
  season: Season;
  /** Best first by rain-fed score. */
  crops: SeasonCropResult[];
}

const best = (options: (MonthOption | null)[]) =>
  options.reduce<MonthOption | null>((a, b) => (b && (!a || b.score > a.score) ? b : a), null);

/** A crop's best sowing month within one season, from its month-by-month results. */
export function cropInSeason(result: CropResult, season: Season): SeasonCropResult {
  const rainfed = best(season.months.map((m) => result.months[m] ?? null));
  let irrigated = best(season.months.map((m) => result.irrigatedMonths[m] ?? null));
  if (!rainfed || !irrigated || irrigated.score < rainfed.score + IRRIGATION_GAIN) irrigated = null;
  return {
    cropId: result.cropId,
    seasonId: season.id,
    rainfed,
    irrigated,
    suitability: classify(rainfed ? rainfed.score : null),
    yearRound: result.cycleMonths >= 12,
  };
}

/** Every season with each crop's best sowing month in it; [] when the climate section has no monthly data. */
export function seasonalAssessment(summary: EnvSummary, results: CropResult[]): SeasonalAssessment[] {
  if (summary.climate.status !== 'ok') return [];
  return seasonsFor(summary.location, summary.climate.data).map((season) => ({
    season,
    crops: results
      .map((r) => cropInSeason(r, season))
      .sort((a, b) => byScore({ cropId: a.cropId, score: a.rainfed?.score ?? null }, { cropId: b.cropId, score: b.rainfed?.score ?? null })),
  }));
}

// ------------------------------------------------------------ what to plant now

export interface PlantNowCrop {
  cropId: string;
  /** Sowing this month or next: the better of the two. */
  option: MonthOption;
  /** The score needs irrigation to make up for too little rain. */
  irrigated: boolean;
  /** Perennials: the sowing month doesn't change the score. */
  yearRound: boolean;
  /** The crop's score at its best month of the year; shows whether waiting would pay. */
  bestScore: number;
  bestMonth: number | null;
}

/** A crop scoring this many points below its best month is better sown later. */
export const WAIT_GAP = 10;

/**
 * Crops worth sowing this month or next at this site, best first. Uses the same
 * month-by-month results as the yearly ranking. A crop only shows when sowing now
 * (rain-fed, or with irrigation when it clearly helps) reaches `minScore`;
 * `value` (per hectare) breaks ties so that, of equally suited crops, the one
 * that usually earns more comes first.
 */
export function plantNow(results: CropResult[], month: number, value: (cropId: string) => number | null = () => null, minScore = 50): PlantNowCrop[] {
  const out: PlantNowCrop[] = [];
  for (const r of results) {
    if (r.months.length !== 12 || r.score === null) continue;
    const yearRound = r.cycleMonths >= 12;
    const window = yearRound ? [month] : [month, (month + 1) % 12];
    const rainfed = best(window.map((m) => r.months[m]));
    const watered = best(window.map((m) => r.irrigatedMonths[m]));
    const useWater = !!watered && (!rainfed || watered.score >= rainfed.score + IRRIGATION_GAIN);
    const option = useWater ? watered : rainfed;
    if (!option || option.score < minScore) continue;
    out.push({ cropId: r.cropId, option, irrigated: useWater, yearRound, bestScore: r.score, bestMonth: r.bestMonth });
  }
  return out.sort(
    (a, b) =>
      Number(a.irrigated) - Number(b.irrigated) ||
      b.option.score - a.option.score ||
      (value(b.cropId) ?? -1) - (value(a.cropId) ?? -1) ||
      a.cropId.localeCompare(b.cropId),
  );
}
