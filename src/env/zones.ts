import type { LatLng } from '../geo/types';
import { landCoverAt, pointInRing, readTerrain } from './rasters';
import { STEEP_DEG } from './suitability';
import { type FetchRange, fetchRange } from './tiff';
import type { Zone, ZoneData, ZoneKind } from './types';

/**
 * Splits the land into a grid of zones and judges each one on its own, because one
 * parcel can hold a pond, a wooded corner, a slope or a low spot next to good fields.
 * Each zone uses only data detailed enough to differ between zones: ESA WorldCover
 * (10 m) and the elevation model (about 30 m). Climate and soil sources are 250 m to
 * 55 km, so they are the same for every zone and are not repeated per zone.
 */

/** Side of the square examined around a single point (no parcel drawn). */
export const POINT_SQUARE_M = 400;
/** Smallest zone side: below about 40 m the 30 m elevation data can't tell zones apart. */
const MIN_CELL_M = 40;
const MAX_CELLS = 6;
/** A zone this much lower than the middle zone is a low spot (water collects, may flood). */
export const LOW_SPOT_M = 2;

const M_PER_DEG = 111320;

function bounds(centre: LatLng, ring: LatLng[] | null): [number, number, number, number] {
  if (ring && ring.length >= 3) {
    const lats = ring.map((p) => p.latitude);
    const lons = ring.map((p) => p.longitude);
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  }
  const dLat = POINT_SQUARE_M / 2 / M_PER_DEG;
  const dLon = dLat / Math.cos((centre.latitude * Math.PI) / 180);
  return [centre.longitude - dLon, centre.latitude - dLat, centre.longitude + dLon, centre.latitude + dLat];
}

const cellsFor = (sideM: number) => Math.max(1, Math.min(MAX_CELLS, Math.floor(sideM / MIN_CELL_M)));

/** Zone kind from its land cover and terrain; `low` is decided once all zones are known. */
export function zoneKind(fractions: { code: number; fraction: number }[], slopeDeg: number | null): ZoneKind {
  const share = (codes: number[]) => fractions.filter((f) => codes.includes(f.code)).reduce((a, f) => a + f.fraction, 0);
  if (!fractions.length) return 'no-data';
  if (share([80]) >= 0.5) return 'water';
  if (share([50]) >= 0.5) return 'built';
  if (share([10, 95]) >= 0.5) return 'tree';
  if (slopeDeg !== null && slopeDeg >= STEEP_DEG) return 'steep';
  if (share([90]) >= 0.5) return 'wet';
  if (share([40]) >= 0.5) return 'cropland';
  return 'open';
}

/** Kinds where crop advice applies (the others need clearing, draining or terracing first, or can't be farmed). */
export const FARMABLE_ZONES = new Set<ZoneKind>(['cropland', 'open', 'low', 'wet']);

export async function readZones(centre: LatLng, ring: LatLng[] | null, get: FetchRange = fetchRange): Promise<ZoneData | null> {
  const [w, s, e, n] = bounds(centre, ring);
  const mPerLon = M_PER_DEG * Math.cos((((s + n) / 2) * Math.PI) / 180);
  const widthM = (e - w) * mPerLon;
  const heightM = (n - s) * M_PER_DEG;
  const cols = cellsFor(widthM);
  const rows = cellsFor(heightM);
  const parcel = ring && ring.length >= 3 ? ring : null;

  const zones: Zone[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 3×3 sample points per zone, kept to those inside the parcel.
      const pts: LatLng[] = [];
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < 3; i++) {
          pts.push({
            longitude: w + ((c + (i + 0.5) / 3) / cols) * (e - w),
            latitude: n - ((r + (j + 0.5) / 3) / rows) * (n - s),
          });
        }
      }
      const inside = parcel ? pts.filter((p) => pointInRing(p, parcel)) : pts;
      if (!inside.length) continue;
      const centreOf = inside[Math.floor(inside.length / 2)];
      const codes = [];
      for (const p of inside) codes.push(await landCoverAt(p, get));
      const valid = codes.filter((v): v is number => v !== null);
      const counts = new Map<number, number>();
      for (const v of valid) counts.set(v, (counts.get(v) ?? 0) + 1);
      const fractions = [...counts.entries()]
        .map(([code, k]) => ({ code, fraction: Number((k / valid.length).toFixed(3)) }))
        .sort((a, b) => b.fraction - a.fraction);
      const terrain = await readTerrain(centreOf, get).catch(() => null);
      zones.push({
        row: r,
        col: c,
        centre: centreOf,
        coverage: Number((inside.length / pts.length).toFixed(2)),
        landCover: fractions,
        elevationM: terrain?.elevationM ?? null,
        slopeDeg: terrain?.slopeDeg ?? null,
        kind: zoneKind(fractions, terrain?.slopeDeg ?? null),
      });
    }
  }
  if (!zones.length) return null;

  // Low spots: clearly below the middle of the land (water collects there in heavy rain).
  const elevations = zones
    .map((z) => z.elevationM)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (elevations.length >= 3) {
    const median = elevations[Math.floor(elevations.length / 2)];
    for (const z of zones) {
      if (z.elevationM !== null && z.elevationM <= median - LOW_SPOT_M && (z.kind === 'cropland' || z.kind === 'open')) z.kind = 'low';
    }
  }
  return {
    bbox: [w, s, e, n],
    rows,
    cols,
    cellWidthM: Math.round(widthM / cols),
    cellHeightM: Math.round(heightM / rows),
    area: parcel ? 'parcel' : 'square',
    zones,
  };
}

/** Zone counts by kind, biggest first. */
export function zoneSummary(data: ZoneData): { kind: ZoneKind; count: number; share: number }[] {
  const weight = data.zones.reduce((a, z) => a + z.coverage, 0);
  const by = new Map<ZoneKind, number>();
  for (const z of data.zones) by.set(z.kind, (by.get(z.kind) ?? 0) + z.coverage);
  return [...by.entries()]
    .map(([kind, wsum]) => ({ kind, count: data.zones.filter((z) => z.kind === kind).length, share: wsum / weight }))
    .sort((a, b) => b.share - a.share);
}

/** Clips a polygon to an axis-aligned rectangle (Sutherland–Hodgman; the rectangle is the convex clip window). */
export function clipToRect(ring: LatLng[], [w, s, e, n]: [number, number, number, number]): LatLng[] {
  type Edge = { inside: (p: LatLng) => boolean; cut: (a: LatLng, b: LatLng) => LatLng };
  const atLon = (x: number) => (a: LatLng, b: LatLng) => ({ longitude: x, latitude: a.latitude + ((x - a.longitude) * (b.latitude - a.latitude)) / (b.longitude - a.longitude) });
  const atLat = (y: number) => (a: LatLng, b: LatLng) => ({ latitude: y, longitude: a.longitude + ((y - a.latitude) * (b.longitude - a.longitude)) / (b.latitude - a.latitude) });
  const edges: Edge[] = [
    { inside: (p) => p.longitude >= w, cut: atLon(w) },
    { inside: (p) => p.longitude <= e, cut: atLon(e) },
    { inside: (p) => p.latitude >= s, cut: atLat(s) },
    { inside: (p) => p.latitude <= n, cut: atLat(n) },
  ];
  let out = ring;
  for (const edge of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (edge.inside(cur)) {
        if (!edge.inside(prev)) out.push(edge.cut(prev, cur));
        out.push(cur);
      } else if (edge.inside(prev)) out.push(edge.cut(prev, cur));
    }
    if (!out.length) break;
  }
  // A parcel edge running through a cell corner repeats points; a cell it only touches has no area.
  const same = (a: LatLng, b: LatLng) => Math.abs(a.latitude - b.latitude) < 1e-12 && Math.abs(a.longitude - b.longitude) < 1e-12;
  const clean = out.filter((p, i) => !same(p, out[(i + out.length - 1) % out.length]));
  let area2 = 0;
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i];
    const b = clean[(i + 1) % clean.length];
    area2 += a.longitude * b.latitude - b.longitude * a.latitude;
  }
  const cellArea = (e - w) * (n - s);
  return clean.length >= 3 && Math.abs(area2) / 2 > cellArea * 1e-9 ? clean : [];
}

/** Each zone's outline on the ground: its grid cell, cut to the parcel when there is one. */
export function zoneCells(data: ZoneData, ring: LatLng[] | null): LatLng[][] {
  const [w, s, e, n] = data.bbox;
  return data.zones.map((z) => {
    const rect: [number, number, number, number] = [
      w + (z.col / data.cols) * (e - w),
      n - ((z.row + 1) / data.rows) * (n - s),
      w + ((z.col + 1) / data.cols) * (e - w),
      n - (z.row / data.rows) * (n - s),
    ];
    if (ring && ring.length >= 3) return clipToRect(ring, rect);
    return [
      { longitude: rect[0], latitude: rect[1] },
      { longitude: rect[2], latitude: rect[1] },
      { longitude: rect[2], latitude: rect[3] },
      { longitude: rect[0], latitude: rect[3] },
    ];
  });
}

/** The zone a tapped point falls in, if any. */
export function zoneAt(cells: LatLng[][], p: LatLng): number | null {
  const i = cells.findIndex((c) => c.length >= 3 && pointInRing(p, c));
  return i < 0 ? null : i;
}
