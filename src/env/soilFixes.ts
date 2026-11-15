import { saltRisk, type SaltRisk } from './salinity';
import { STEEP_DEG } from './suitability';
import type { EnvSummary } from './types';

/**
 * What is holding the land back and what a farmer can do about it. Soil problems come
 * only from the farmer's own soil test (the app no longer predicts soil); terrain
 * problems come from the elevation model and land zones, and salt from the salt-risk rating.
 *
 * Amounts are common starting points from extension guides for tropical soils, not a
 * prescription.
 */

export type ProblemId =
  | 'very-acid'
  | 'acid'
  | 'alkaline'
  | 'low-organic'
  | 'sandy'
  | 'heavy-clay'
  | 'steep'
  | 'high-ground'
  | 'low-spots'
  | 'salt-high'
  | 'salt-medium';

/** blocker: most crops fail until it is fixed. major: big yield loss. minor: worth fixing over time. */
export type Severity = 'blocker' | 'major' | 'minor';

export interface SoilProblem {
  id: ProblemId;
  severity: Severity;
  /** True when the problem comes from the farmer's own soil or water test. */
  measured?: boolean;
  /** The number behind it, for the sentence that explains it (pH, %, g/kg, degrees, share). */
  value: number | null;
  /** Catalogue crops that cope with this problem better than most. */
  crops: string[];
}

export interface SoilFixPlan {
  problems: SoilProblem[];
  /** True when a problem stops most crops until it is fixed: the fixes are shown first. */
  notSuitable: boolean;
  salt: SaltRisk;
}

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, major: 1, minor: 2 };

/** Crops listed under each problem; ids from the bundled ECOCROP catalogue. */
export const COPING_CROPS: Record<ProblemId, string[]> = {
  'very-acid': ['cassava', 'pineapple', 'cashew', 'tea', 'sweet-potato'],
  acid: ['cassava', 'pineapple', 'cashew', 'sweet-potato', 'groundnut'],
  alkaline: ['sorghum', 'coconut', 'tamarind'],
  'low-organic': ['mungbean', 'cowpea', 'groundnut', 'soybean'],
  sandy: ['groundnut', 'cassava', 'watermelon', 'sweet-potato', 'cashew'],
  'heavy-clay': ['rice', 'taro', 'sugarcane'],
  steep: ['cashew', 'mango', 'black-pepper', 'jackfruit'],
  'high-ground': ['tea', 'coffee-arabica', 'potato', 'cabbage', 'carrot', 'avocado'],
  'low-spots': ['rice', 'taro'],
  'salt-high': ['coconut', 'sorghum', 'cowpea'],
  'salt-medium': ['sorghum', 'cowpea', 'soybean', 'coconut'],
};

/** Organic matter to organic carbon (Van Bemmelen factor), as g/kg. */
const omToSocGKg = (omPct: number) => (omPct / 1.724) * 10;

/** A value from the farmer's own test, where one was entered. */
function testValue(s: EnvSummary, key: 'phh2o' | 'soc'): number | null {
  const t = s.soilTest;
  if (!t) return null;
  if (key === 'phh2o') return t.ph;
  return t.organicMatterPct === null ? null : omToSocGKg(t.organicMatterPct);
}

/** Thresholds, common in tropical soil fertility guides. */
export const LIMITS = {
  veryAcidPh: 5.0,
  acidPh: 5.5,
  alkalinePh: 8.0,
  /** Soil organic carbon, g/kg (1 % = 10 g/kg). */
  lowSoc: 10,
  /** Elevation, m: above this the tropics get noticeably cooler (about 0.6 °C less per 100 m). */
  highGroundM: 800,
  veryHighGroundM: 1500,
} as const;

export function soilFixPlan(summary: EnvSummary): SoilFixPlan {
  const problems: SoilProblem[] = [];
  const add = (id: ProblemId, severity: Severity, value: number | null, measured = false) =>
    problems.push({ id, severity, value, crops: COPING_CROPS[id], ...(measured ? { measured } : {}) });
  const test = summary.soilTest;

  // Soil problems only from the farmer's test, so every one of them is measured.
  const ph = testValue(summary, 'phh2o');
  if (ph !== null) {
    if (ph < LIMITS.veryAcidPh) add('very-acid', 'blocker', ph, true);
    else if (ph < LIMITS.acidPh) add('acid', 'major', ph, true);
    else if (ph > LIMITS.alkalinePh) add('alkaline', 'major', ph, true);
  }
  const soc = testValue(summary, 'soc');
  if (soc !== null && soc < LIMITS.lowSoc) add('low-organic', 'major', soc, true);
  if (test?.texture === 'sandy') add('sandy', 'major', null, true);
  else if (test?.texture === 'clay') add('heavy-clay', 'minor', null, true);

  const slope = summary.terrain.status === 'ok' ? summary.terrain.data.slopeDeg : null;
  if (slope !== null && slope >= STEEP_DEG) add('steep', slope >= 2 * STEEP_DEG ? 'blocker' : 'major', slope);
  const elevation = summary.terrain.status === 'ok' ? summary.terrain.data.elevationM : null;
  if (elevation !== null && elevation >= LIMITS.highGroundM) add('high-ground', elevation >= LIMITS.veryHighGroundM ? 'major' : 'minor', elevation);
  if (summary.zones?.status === 'ok') {
    const zs = summary.zones.data.zones;
    const wet = zs.filter((z) => z.kind === 'low' || z.kind === 'wet').length / Math.max(1, zs.length);
    if (wet >= 0.25) add('low-spots', wet >= 0.6 ? 'major' : 'minor', wet);
  }

  const salt = saltRisk(summary);
  if (salt.level === 'high') add('salt-high', 'blocker', null, salt.measuredEc !== null);
  else if (salt.level === 'medium') add('salt-medium', 'major', null, salt.measuredEc !== null);

  problems.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const notSuitable = problems.some((p) => p.severity === 'blocker');
  return { problems, notSuitable, salt };
}
