import type { LatLng } from '../geo/types';
import world from '../map/web/world-110m.json';
import type { EnvSummary } from './types';

/**
 * Chance that water and topsoil at a place are salty, from the clues the app already has.
 * No free source measures salt in farm water or soil at field scale, so this is a
 * risk rating, not a measurement, and it always ends with "test it".
 *
 * Clues:
 * - Sea water creeping inland: distance to the coast (Natural Earth 1:110m outline,
 *   bundled) and height above sea (NASADEM elevation already in the analysis).
 * - Mangroves on the land (ESA WorldCover class 95) grow only in brackish water.
 * - Salt left behind by evaporation: months when NASA POWER rain is well below
 *   reference evapotranspiration (Hargreaves–Samani, from NASA POWER temperature and
 *   sunlight), worse where water pools (the land's low zones).
 */

export type SaltLevel = 'low' | 'medium' | 'high';
export type SaltReason = 'measured' | 'coast-near-low' | 'coast-near' | 'coast-low' | 'mangrove' | 'dry-months' | 'arid' | 'low-spots' | 'inland';

export interface SaltRisk {
  level: SaltLevel;
  reasons: SaltReason[];
  /** Kilometres to the nearest sea coast (approximate: 1:110m outline, off by up to ~10 km). */
  coastKm: number | null;
  elevationM: number | null;
  /** Months with rain below half the reference evapotranspiration. */
  dryMonths: number | null;
  /** Yearly rain ÷ yearly reference evapotranspiration (below 0.5 is semi-arid). */
  aridity: number | null;
  /** The farmer's own water test (dS/m); when given it decides the level. */
  measuredEc: number | null;
}

// ---------------------------------------------------------------- coastline

type Ring = [number, number][];
type Polygon = Ring[];
interface Feature {
  geometry: { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: Polygon[] };
}

let coast: Float64Array | null = null;

/**
 * Coast segments: edges of the country outlines that no neighbouring country shares.
 * Shared edges are land borders; the rest face the sea.
 */
function coastSegments(): Float64Array {
  if (coast) return coast;
  const key = (a: number[], b: number[]) => `${a[0]},${a[1]}|${b[0]},${b[1]}`;
  const count = new Map<string, number>();
  const edges: [number[], number[]][] = [];
  for (const f of world.features as unknown as Feature[]) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0; i + 1 < ring.length; i++) {
          const a = ring[i];
          const b = ring[i + 1];
          edges.push([a, b]);
          const k = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? key(a, b) : key(b, a);
          count.set(k, (count.get(k) ?? 0) + 1);
        }
      }
    }
  }
  const out: number[] = [];
  for (const [a, b] of edges) {
    const k = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? key(a, b) : key(b, a);
    // Edges on the antimeridian cut are not coast.
    if (count.get(k) === 1 && !(Math.abs(a[0]) === 180 && a[0] === b[0])) out.push(a[0], a[1], b[0], b[1]);
  }
  coast = Float64Array.from(out);
  return coast;
}

const KM_PER_DEG = 111.32;

/** Kilometres from a point to the nearest sea coast in the bundled outline. */
export function coastDistanceKm(p: LatLng): number {
  const seg = coastSegments();
  const k = Math.cos((p.latitude * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i < seg.length; i += 4) {
    // Skip segments more than 6° (≈ 670 km) north or south.
    if (Math.abs(seg[i + 1] - p.latitude) > 6 && Math.abs(seg[i + 3] - p.latitude) > 6) continue;
    const ax = (seg[i] - p.longitude) * k;
    const ay = seg[i + 1] - p.latitude;
    const bx = (seg[i + 2] - p.longitude) * k;
    const by = seg[i + 3] - p.latitude;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best * KM_PER_DEG;
}

// ---------------------------------------------------------------- climate

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Monthly reference evapotranspiration (mm) by Hargreaves–Samani in its radiation form:
 * ET0 = 0.0135 × (T + 17.8) × Rs / λ, with Rs in MJ/m²/day and λ = 2.45 MJ/kg.
 */
export function monthlyEt0(tempC: number, solarKwhM2Day: number, month: number): number {
  const rs = solarKwhM2Day * 3.6;
  return Math.max(0, (0.0135 * (tempC + 17.8) * rs) / 2.45) * DAYS[month];
}

// ---------------------------------------------------------------- rating

/** Sea water reaches rivers and wells this far inland on low coastal plains (Mekong delta, Kampot). */
const COAST_NEAR_KM = 15;
const COAST_ZONE_KM = 40;
/** In river deltas, dry-season sea water travels far up the channels over very flat, low land. */
const DELTA_KM = 80;
const DELTA_M = 3;
const LOW_M = 5;
const PLAIN_M = 10;

export function saltRisk(summary: EnvSummary): SaltRisk {
  const reasons: SaltReason[] = [];
  let score = 0;
  const p = summary.location;
  const coastKm = Number(coastDistanceKm(p).toFixed(1));
  const elevationM = summary.terrain.status === 'ok' ? summary.terrain.data.elevationM : null;

  // Sea water.
  if (coastKm <= COAST_NEAR_KM && (elevationM === null || elevationM <= LOW_M)) {
    reasons.push('coast-near-low');
    score += 3;
  } else if (coastKm <= COAST_NEAR_KM) {
    reasons.push('coast-near');
    score += 1;
  } else if (
    elevationM !== null &&
    ((coastKm <= COAST_ZONE_KM && elevationM <= PLAIN_M) || (coastKm <= DELTA_KM && elevationM <= DELTA_M))
  ) {
    reasons.push('coast-low');
    score += 2;
  }

  // Mangroves only grow in brackish water.
  if (summary.landCover.status === 'ok') {
    const mangrove = summary.landCover.data.fractions.find((f) => f.code === 95)?.fraction ?? 0;
    if (mangrove >= 0.05) {
      reasons.push('mangrove');
      score += 3;
    }
  }

  // Salt left behind as water evaporates.
  let dryMonths: number | null = null;
  let aridity: number | null = null;
  if (summary.climate.status === 'ok') {
    const { monthlyRainMm: rain, monthlyTempC: temp, monthlySolarKwhM2Day: sun } = summary.climate.data;
    if (rain.every((v) => v !== null) && temp.every((v) => v !== null) && sun.every((v) => v !== null)) {
      const et0 = temp.map((tc, m) => monthlyEt0(tc as number, sun[m] as number, m));
      dryMonths = rain.filter((r, m) => (r as number) < 0.5 * et0[m]).length;
      const rainYear = rain.reduce((a: number, r) => a + (r as number), 0);
      const etYear = et0.reduce((a, e) => a + e, 0);
      aridity = etYear ? Number((rainYear / etYear).toFixed(2)) : null;
      if (aridity !== null && aridity < 0.5) {
        reasons.push('arid');
        score += 2;
      } else if (dryMonths >= 6) {
        reasons.push('dry-months');
        score += 1;
      }
    }
  }

  // Low spots collect water that then dries out, leaving its salt.
  if (summary.zones?.status === 'ok' && (reasons.includes('arid') || reasons.includes('dry-months') || score > 0)) {
    const low = summary.zones.data.zones.filter((z) => z.kind === 'low' || z.kind === 'wet').length;
    if (low > 0) {
      reasons.push('low-spots');
      score += 1;
    }
  }

  if (!reasons.length) reasons.push('inland');
  let level: SaltLevel = score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';
  // A measurement beats every clue: the FAO bands decide, and the clues stay as background.
  const measuredEc = summary.soilTest?.waterEcDsM ?? null;
  if (measuredEc !== null) {
    level = measuredEc > EC_BANDS.severe ? 'high' : measuredEc >= EC_BANDS.fine ? 'medium' : 'low';
    reasons.unshift('measured');
  }
  return { level, reasons, coastKm, elevationM, dryMonths, aridity, measuredEc };
}

/**
 * Water salt bands for irrigation by electrical conductivity (dS/m), after FAO
 * Irrigation and Drainage Paper 29: below 0.7 no restriction, 0.7–3 slight to
 * moderate, above 3 severe.
 */
export const EC_BANDS = { fine: 0.7, severe: 3 } as const;
