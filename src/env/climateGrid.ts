import { POWER_BASE } from './power';

/**
 * Rainfall and sunlight map overlays from NASA POWER's regional climatology API: long-term
 * yearly averages on POWER's native 0.5° × 0.625° grid (about 55 × 70 km), the same source and averaging period
 * as the per-place numbers in an analysis. POWER limits a regional request to one
 * parameter and about 4.5° × 4.5°, so the map is filled in 4° blocks, fetched one at a
 * time (POWER allows about 30 climatology requests a minute) and kept for the session.
 */

export type ClimateLayer = 'rainfall' | 'sunlight';
export const CLIMATE_LAYERS: ClimateLayer[] = ['rainfall', 'sunlight'];

/** POWER parameter and how its yearly ("ANN") value becomes the shown unit. */
const PARAM: Record<ClimateLayer, { name: string; toUnit: (annPerDay: number) => number }> = {
  // Corrected precipitation, mm/day averaged over the year → mm per year.
  rainfall: { name: 'PRECTOTCORR', toUnit: (v) => Math.round(v * 365.25) },
  // All-sky surface shortwave radiation, kWh/m²/day.
  sunlight: { name: 'ALLSKY_SFC_SW_DWN', toUnit: (v) => Number(v.toFixed(2)) },
};

export const BLOCK_DEG = 4;
/** Most blocks fetched for one view; zoomed further out, the map asks the user to zoom in. */
export const MAX_BLOCKS = 12;
/** POWER's native grid for these parameters (MERRA-2): 0.5° of latitude by 0.625° of longitude. */
const CELL_LAT = 0.5;
const CELL_LON = 0.625;

export interface GridCell {
  w: number;
  s: number;
  e: number;
  n: number;
  /** mm/year for rainfall, kWh/m²/day for sunlight. */
  v: number;
}

export function regionalUrl(layer: ClimateLayer, bx: number, by: number): string {
  const q = new URLSearchParams({
    'latitude-min': String(by),
    'latitude-max': String(by + BLOCK_DEG),
    'longitude-min': String(bx),
    'longitude-max': String(bx + BLOCK_DEG),
    parameters: PARAM[layer].name,
    community: 'AG',
    format: 'JSON',
  });
  return `${POWER_BASE}/climatology/regional?${q}`;
}

/** South-west corners of the 4° blocks covering [west, south, east, north]; empty past MAX_BLOCKS. */
export function blocksFor([w, s, e, n]: [number, number, number, number]): [number, number][] {
  const lat0 = Math.max(-88, Math.floor(s / BLOCK_DEG) * BLOCK_DEG);
  const lat1 = Math.min(88, Math.floor(n / BLOCK_DEG) * BLOCK_DEG);
  const lon0 = Math.floor(w / BLOCK_DEG) * BLOCK_DEG;
  const lon1 = Math.floor(e / BLOCK_DEG) * BLOCK_DEG;
  const out: [number, number][] = [];
  for (let by = lat0; by <= lat1; by += BLOCK_DEG) {
    for (let bx = lon0; bx <= lon1; bx += BLOCK_DEG) {
      out.push([((((bx + 180) % 360) + 360) % 360) - 180, by]);
      if (out.length > MAX_BLOCKS) return [];
    }
  }
  return out;
}

const cell = (lon: number, lat: number, v: number): GridCell => ({
  w: lon - CELL_LON / 2,
  e: lon + CELL_LON / 2,
  s: lat - CELL_LAT / 2,
  n: lat + CELL_LAT / 2,
  v,
});

/**
 * Reads POWER's regional answer: GeoJSON (one point feature per grid cell, values under
 * properties.parameter.<NAME>.ANN) or CSV (rows of PARAMETER, LAT, LON, JAN…DEC, ANN).
 * POWER marks missing values with -999.
 */
export function parseRegional(body: unknown, layer: ClimateLayer): GridCell[] {
  const { name, toUnit } = PARAM[layer];
  const out: GridCell[] = [];
  if (typeof body === 'string') {
    const lines = body.split(/\r?\n/);
    const start = lines.findIndex((l) => l.includes('-END HEADER-')) + 1;
    const head = lines[start]?.split(',').map((x) => x.trim().toUpperCase()) ?? [];
    const iLat = head.indexOf('LAT');
    const iLon = head.indexOf('LON');
    const iAnn = head.indexOf('ANN');
    if (iLat < 0 || iLon < 0 || iAnn < 0) return out;
    for (const line of lines.slice(start + 1)) {
      const f = line.split(',');
      const v = Number(f[iAnn]);
      if (f.length > iAnn && Number.isFinite(v) && v > -999) out.push(cell(Number(f[iLon]), Number(f[iLat]), toUnit(v)));
    }
    return out;
  }
  const features = (body as { features?: { geometry?: { coordinates?: number[] }; properties?: { parameter?: Record<string, Record<string, number>> } }[] })
    ?.features;
  for (const f of features ?? []) {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const v = f.properties?.parameter?.[name]?.ANN;
    if (Number.isFinite(lon) && Number.isFinite(lat) && typeof v === 'number' && v > -999) out.push(cell(lon, lat, toUnit(v)));
  }
  return out;
}

export type FetchBody = (url: string) => Promise<unknown>;

const blocks = new Map<string, Promise<GridCell[]>>();
let queue: Promise<unknown> = Promise.resolve();

/** One block's cells, fetched once per session; requests go one at a time to respect POWER's rate limit. */
export function climateBlock(layer: ClimateLayer, bx: number, by: number, get: FetchBody): Promise<GridCell[]> {
  const key = `${layer}:${bx}:${by}`;
  let p = blocks.get(key);
  if (!p) {
    const run = queue.then(() => get(regionalUrl(layer, bx, by))).then((body) => parseRegional(body, layer));
    queue = run.catch(() => undefined);
    p = run;
    blocks.set(key, p);
    // A failed block is tried again the next time the map moves.
    p.catch(() => blocks.delete(key));
  }
  return p;
}

/** Colour stops shared by the map page and the legend. */
export const CLIMATE_STOPS: Record<ClimateLayer, [number, string][]> = {
  rainfall: [
    [250, '#f6e8c3'],
    [750, '#dfc27d'],
    [1250, '#a6d96a'],
    [1750, '#4fb3a9'],
    [2500, '#2b83ba'],
    [3500, '#253494'],
  ],
  sunlight: [
    [3, '#6a51a3'],
    [4, '#b07cc6'],
    [4.75, '#f6c344'],
    [5.5, '#f08a24'],
    [6.5, '#c4361b'],
  ],
};
