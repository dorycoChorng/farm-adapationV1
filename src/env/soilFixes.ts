import { saltRisk, type SaltRisk } from './salinity';
import { STEEP_DEG } from './suitability';
import type { EnvSummary } from './types';

/**
 * What is holding the land back and what a farmer can do about it, from the soil and
 * terrain numbers already in the analysis (SoilGrids first, FAO HWSD where SoilGrids has
 * nothing), the land zones and the salt-risk rating.
 *
 * Amounts are common starting points from extension guides for tropical soils, not a
 * prescription: soil maps are modelled at 250 m–1 km, so the advice always says to
 * confirm with a soil test before spending money.
 */

export type ProblemId =
  | 'very-acid'
  | 'acid'
  | 'alkaline'
  | 'low-organic'
  | 'sandy'
  | 'heavy-clay'
  | 'poor-drainage'
  | 'low-nutrients'
  | 'low-nitrogen'
  | 'steep'
  | 'low-spots'
  | 'salt-high'
  | 'salt-medium';

/** blocker: most crops fail until it is fixed. major: big yield loss. minor: worth fixing over time. */
export type Severity = 'blocker' | 'major' | 'minor';

export interface SoilProblem {
  id: ProblemId;
  severity: Severity;
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
  'poor-drainage': ['rice', 'taro'],
  'low-nutrients': ['cassava', 'cashew', 'mungbean', 'cowpea'],
  'low-nitrogen': ['mungbean', 'cowpea', 'groundnut', 'soybean', 'black-gram'],
  steep: ['cashew', 'mango', 'black-pepper', 'jackfruit'],
  'low-spots': ['rice', 'taro'],
  'salt-high': ['coconut', 'sorghum', 'cowpea'],
  'salt-medium': ['sorghum', 'cowpea', 'soybean', 'coconut'],
};

function soilValue(s: EnvSummary, key: 'phh2o' | 'soc' | 'clay' | 'sand' | 'nitrogen' | 'cec'): number | null {
  const sg = s.soil.status === 'ok' ? s.soil.data.properties.find((p) => p.key === key)?.mean ?? null : null;
  if (sg !== null) return sg;
  if (s.hwsd?.status !== 'ok') return null;
  const h = s.hwsd.data;
  switch (key) {
    case 'phh2o':
      return h.ph;
    case 'soc':
      return h.organicCarbonPct === null ? null : h.organicCarbonPct * 10; // % → g/kg
    case 'clay':
      return h.clayPct;
    case 'sand':
      return h.sandPct;
    case 'nitrogen':
      return h.nitrogenGKg;
    case 'cec':
      return h.cec;
  }
}

/** Thresholds, common in tropical soil fertility guides. */
export const LIMITS = {
  veryAcidPh: 5.0,
  acidPh: 5.5,
  alkalinePh: 8.0,
  /** Soil organic carbon, g/kg (1 % = 10 g/kg). */
  lowSoc: 10,
  sandyPct: 70,
  heavyClayPct: 50,
  /** Cation exchange capacity, cmol(+)/kg. */
  lowCec: 10,
  /** Total nitrogen, g/kg. */
  lowN: 1,
} as const;

export function soilFixPlan(summary: EnvSummary): SoilFixPlan {
  const problems: SoilProblem[] = [];
  const add = (id: ProblemId, severity: Severity, value: number | null) => problems.push({ id, severity, value, crops: COPING_CROPS[id] });

  const ph = soilValue(summary, 'phh2o');
  if (ph !== null) {
    if (ph < LIMITS.veryAcidPh) add('very-acid', 'blocker', ph);
    else if (ph < LIMITS.acidPh) add('acid', 'major', ph);
    else if (ph > LIMITS.alkalinePh) add('alkaline', 'major', ph);
  }
  const soc = soilValue(summary, 'soc');
  if (soc !== null && soc < LIMITS.lowSoc) add('low-organic', 'major', soc);
  const sand = soilValue(summary, 'sand');
  const clay = soilValue(summary, 'clay');
  if (sand !== null && sand >= LIMITS.sandyPct) add('sandy', 'major', sand);
  else if (clay !== null && clay >= LIMITS.heavyClayPct) add('heavy-clay', 'minor', clay);
  const drainage = summary.hwsd?.status === 'ok' ? summary.hwsd.data.drainage : null;
  if (drainage === 'P' || drainage === 'VP') add('poor-drainage', 'major', null);
  const cec = soilValue(summary, 'cec');
  if (cec !== null && cec < LIMITS.lowCec) add('low-nutrients', 'minor', cec);
  const n = soilValue(summary, 'nitrogen');
  if (n !== null && n < LIMITS.lowN) add('low-nitrogen', 'minor', n);

  const slope = summary.terrain.status === 'ok' ? summary.terrain.data.slopeDeg : null;
  if (slope !== null && slope >= STEEP_DEG) add('steep', slope >= 2 * STEEP_DEG ? 'blocker' : 'major', slope);
  if (summary.zones?.status === 'ok') {
    const zs = summary.zones.data.zones;
    const wet = zs.filter((z) => z.kind === 'low' || z.kind === 'wet').length / Math.max(1, zs.length);
    if (wet >= 0.25) add('low-spots', wet >= 0.6 ? 'major' : 'minor', wet);
  }

  const salt = saltRisk(summary);
  if (salt.level === 'high') add('salt-high', 'blocker', null);
  else if (salt.level === 'medium') add('salt-medium', 'major', null);

  problems.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const notSuitable = problems.some((p) => p.severity === 'blocker');
  return { problems, notSuitable, salt };
}
