import type { LatLng } from '../geo/types';
import type { FetchJson } from './analyze';
import { cog, demAt, demPixel, pointInRing } from './rasters';
import { type FetchRange, fetchRange, pixelFor, readPixel } from './tiff';

/**
 * Where rain water runs over the land and where it pools, worked out from the shape of
 * the ground. Elevation comes from NASADEM (NASA/JPL, 1 arc-second ≈ 30 m), read from
 * Microsoft Planetary Computer; if that can't be reached it falls back to the AWS
 * Terrain Tiles the rest of the app uses (SRTM, also NASA, in Cambodia).
 *
 * Method: fill pits (priority-flood), send each cell's water to its steepest downhill
 * neighbour (D8), then count how many cells drain through each cell. This is a model of
 * the bare ground only: it does not know about canals, dikes, drains or paddy bunds.
 */

// ---------------------------------------------------------------- NASADEM on Planetary Computer

/** NASADEM cloud-optimised GeoTIFFs: 1°×1° tiles named by their south-west corner. */
export const NASADEM_BASE = 'https://nasademeuwest.blob.core.windows.net/nasadem-cog/v001/';
/** Planetary Computer hands out short-lived read tokens (SAS) for each storage container. */
export const PC_SAS_URL = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/nasademeuwest/nasadem-cog';

export function nasademTileName(lat: number, lon: number) {
  const la = Math.floor(lat);
  const lo = Math.floor(lon);
  const ns = (la < 0 ? 's' : 'n') + String(Math.abs(la)).padStart(2, '0');
  const ew = (lo < 0 ? 'w' : 'e') + String(Math.abs(lo)).padStart(3, '0');
  return `NASADEM_HGT_${ns}${ew}.tif`;
}

let token: { value: string; expires: number } | null = null;

/** A Planetary Computer read token, reused until five minutes before it expires. */
export async function planetaryToken(getJson: FetchJson): Promise<string> {
  if (token && token.expires - Date.now() > 5 * 60_000) return token.value;
  const body = (await getJson(PC_SAS_URL, undefined, { timeoutMs: 15000 })) as { token?: string; 'msft:expiry'?: string };
  if (!body?.token) throw new Error('no Planetary Computer token');
  const expires = Date.parse(body['msft:expiry'] ?? '') || Date.now() + 30 * 60_000;
  token = { value: body.token, expires };
  return body.token;
}

// ---------------------------------------------------------------- elevation grid

export interface ElevationGrid {
  cols: number;
  rows: number;
  /** Cell edges: longitudes west→east (cols + 1), latitudes north→south (rows + 1). */
  lonEdges: number[];
  latEdges: number[];
  /** Metres, row-major from the north-west cell; NaN where there is no data. */
  z: Float32Array;
  source: 'nasadem' | 'aws';
}

/** Extra ground around the land, so water running in from uphill neighbours is counted. */
export const FLOW_BUFFER_M = 300;
/** Keeps the work small enough for a phone; big areas are sampled more coarsely. */
const MAX_CELLS = 180 * 180;
const M_PER_DEG = 111320;
const ARCSEC = 1 / 3600;

function buffered([w, s, e, n]: [number, number, number, number]): [number, number, number, number] {
  const dLat = FLOW_BUFFER_M / M_PER_DEG;
  const dLon = dLat / Math.cos((((s + n) / 2) * Math.PI) / 180);
  return [w - dLon, s - dLat, e + dLon, n + dLat];
}

async function nasademGrid(bbox: [number, number, number, number], get: FetchRange, sas: string): Promise<ElevationGrid> {
  const [w, s, e, n] = buffered(bbox);
  // NASADEM pixel centres sit on whole arc-seconds.
  const gx0 = Math.floor(w / ARCSEC);
  const gx1 = Math.ceil(e / ARCSEC);
  const gy0 = Math.ceil(n / ARCSEC);
  const gy1 = Math.floor(s / ARCSEC);
  const stride = Math.max(1, Math.ceil(Math.sqrt(((gx1 - gx0 + 1) * (gy0 - gy1 + 1)) / MAX_CELLS)));
  const cols = Math.floor((gx1 - gx0) / stride) + 1;
  const rows = Math.floor((gy0 - gy1) / stride) + 1;
  const half = (stride * ARCSEC) / 2;
  const lonEdges = Array.from({ length: cols + 1 }, (_, c) => (gx0 + c * stride) * ARCSEC - half);
  const latEdges = Array.from({ length: rows + 1 }, (_, r) => (gy0 - r * stride) * ARCSEC + half);
  const z = new Float32Array(cols * rows).fill(NaN);
  let got = 0;
  for (let r = 0; r < rows; r++) {
    const lat = (gy0 - r * stride) * ARCSEC;
    for (let c = 0; c < cols; c++) {
      const lon = (gx0 + c * stride) * ARCSEC;
      const info = await cog(`${NASADEM_BASE}${nasademTileName(lat, lon)}?${sas}`, get);
      const px = pixelFor(info, lon, lat);
      const v = px ? await readPixel(info, px[0], px[1], get) : null;
      // NASADEM marks voids with large negative values.
      if (v !== null && v > -500) {
        z[r * cols + c] = v;
        got++;
      }
    }
  }
  if (!got) throw new Error('no NASADEM data here');
  return { cols, rows, lonEdges, latEdges, z, source: 'nasadem' };
}

/** Fallback: AWS Terrain Tiles at zoom 13 (≈19 m cells over 30 m SRTM data). */
const AWS_ZOOM = 13;
const DEM_TILE = 512;

async function awsGrid(bbox: [number, number, number, number], get: FetchRange): Promise<ElevationGrid> {
  const [w, s, e, n] = buffered(bbox);
  const [x0, y0] = demPixel({ longitude: w, latitude: n }, AWS_ZOOM);
  const [x1, y1] = demPixel({ longitude: e, latitude: s }, AWS_ZOOM);
  const stride = Math.max(1, Math.ceil(Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / MAX_CELLS)));
  const cols = Math.floor((x1 - x0) / stride) + 1;
  const rows = Math.floor((y1 - y0) / stride) + 1;
  const size = DEM_TILE * 2 ** AWS_ZOOM;
  const lonOf = (gx: number) => (gx / size) * 360 - 180;
  const latOf = (gy: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / size))) * 180) / Math.PI;
  const lonEdges = Array.from({ length: cols + 1 }, (_, c) => lonOf(x0 + c * stride));
  const latEdges = Array.from({ length: rows + 1 }, (_, r) => latOf(y0 + r * stride));
  const z = new Float32Array(cols * rows).fill(NaN);
  let got = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = await demAt(x0 + c * stride, y0 + r * stride, AWS_ZOOM, get);
      if (v !== null) {
        z[r * cols + c] = v;
        got++;
      }
    }
  }
  if (!got) throw new Error('no elevation data here');
  return { cols, rows, lonEdges, latEdges, z, source: 'aws' };
}

/** Elevation around the land: NASADEM from Planetary Computer first, AWS terrain if that fails. */
export async function readElevationGrid(
  bbox: [number, number, number, number],
  getJson: FetchJson,
  get: FetchRange = fetchRange,
): Promise<ElevationGrid> {
  try {
    return await nasademGrid(bbox, get, await planetaryToken(getJson));
  } catch {
    return awsGrid(bbox, get);
  }
}

// ---------------------------------------------------------------- flow model

export interface FlowResult {
  /** Index of the cell each cell drains into, or -1 where water leaves the grid. */
  down: Int32Array;
  /** Number of cells (including itself) whose water passes through each cell. */
  acc: Float64Array;
  /** Metres of water that would stand in a pit before it overflows (0 on slopes). */
  pondDepth: Float32Array;
}

/** Small binary min-heap keyed by elevation, for the priority-flood fill. */
class Heap {
  private ids: number[] = [];
  private key: Float64Array;
  constructor(key: Float64Array) {
    this.key = key;
  }
  get size() {
    return this.ids.length;
  }
  push(i: number) {
    const a = this.ids;
    a.push(i);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.key[a[p]] <= this.key[a[k]]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): number {
    const a = this.ids;
    const top = a[0];
    const last = a.pop() as number;
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && this.key[a[l]] < this.key[a[m]]) m = l;
        if (r < a.length && this.key[a[r]] < this.key[a[m]]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

const NEIGHBOURS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/**
 * Fills pits so every cell has a way out, then routes water downhill (D8) and accumulates it.
 * `cellW`/`cellH` are the cell size in metres, used to weigh diagonal against straight drops.
 */
export function flowModel(grid: Pick<ElevationGrid, 'cols' | 'rows' | 'z'>, cellW: number, cellH: number): FlowResult {
  const { cols, rows, z } = grid;
  const n = cols * rows;
  const filled = new Float64Array(n);
  const done = new Uint8Array(n);
  const heap = new Heap(filled);
  const EPS = 1e-3; // gives flat filled areas a slight slope so water still crosses them

  // Water leaves at the grid edge and wherever there is no data.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const v = z[i];
      if (Number.isNaN(v)) {
        filled[i] = -Infinity;
        done[i] = 1;
      } else if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) {
        filled[i] = v;
        done[i] = 1;
        heap.push(i);
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (done[i] || Number.isNaN(z[i])) continue;
    const r = Math.floor(i / cols);
    const c = i % cols;
    if (NEIGHBOURS.some(([dc, dr]) => Number.isNaN(z[(r + dr) * cols + c + dc]))) {
      filled[i] = z[i];
      done[i] = 1;
      heap.push(i);
    }
  }
  while (heap.size) {
    const i = heap.pop();
    const r = Math.floor(i / cols);
    const c = i % cols;
    for (const [dc, dr] of NEIGHBOURS) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const j = rr * cols + cc;
      if (done[j]) continue;
      done[j] = 1;
      filled[j] = Math.max(z[j], filled[i] + EPS);
      heap.push(j);
    }
  }

  const diag = Math.hypot(cellW, cellH);
  const down = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(z[i])) continue;
    const r = Math.floor(i / cols);
    const c = i % cols;
    let best = 0;
    for (const [dc, dr] of NEIGHBOURS) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const j = rr * cols + cc;
      if (filled[j] === -Infinity) continue;
      const dist = dc && dr ? diag : dc ? cellW : cellH;
      const drop = (filled[i] - filled[j]) / dist;
      if (drop > best) {
        best = drop;
        down[i] = j;
      }
    }
  }

  const order = Array.from({ length: n }, (_, i) => i)
    .filter((i) => !Number.isNaN(z[i]))
    .sort((a, b) => filled[b] - filled[a]);
  const acc = new Float64Array(n);
  for (const i of order) acc[i] += 1;
  for (const i of order) if (down[i] >= 0) acc[down[i]] += acc[i];

  const pondDepth = new Float32Array(n);
  for (let i = 0; i < n; i++) if (!Number.isNaN(z[i])) pondDepth[i] = Math.max(0, filled[i] - z[i]);
  return { down, acc, pondDepth };
}

// ---------------------------------------------------------------- map shading

/** Water standing at least this deep before overflowing counts as a pooling spot. */
export const POND_M = 0.5;

/** Shade 1–4 from the land draining through a cell (m²): light = a little run-off, dark = a stream. */
export function flowLevel(drainsM2: number): 0 | 1 | 2 | 3 | 4 {
  if (drainsM2 >= 200_000) return 4; // 20 ha or more
  if (drainsM2 >= 50_000) return 3;
  if (drainsM2 >= 12_000) return 2;
  if (drainsM2 >= 3_000) return 1;
  return 0;
}

export interface WaterFlowCell {
  ring: [number, number][];
  level: number;
  pond: boolean;
}
export interface WaterFlowLine {
  from: [number, number];
  to: [number, number];
  level: number;
}
export interface WaterFlowMap {
  cells: WaterFlowCell[];
  lines: WaterFlowLine[];
  source: ElevationGrid['source'];
  /** Share of the land's cells with running water (level ≥ 2) and with pooling water. */
  runShare: number;
  pondShare: number;
}

/** Flow shading for the cells inside the land (the parcel, or the bbox when there is none). */
export function waterFlowMap(grid: ElevationGrid, landBbox: [number, number, number, number], ring: LatLng[] | null): WaterFlowMap {
  const { cols, rows, lonEdges, latEdges } = grid;
  const midLat = (latEdges[0] + latEdges[rows]) / 2;
  const cellW = (Math.abs(lonEdges[cols] - lonEdges[0]) / cols) * M_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  const cellH = (Math.abs(latEdges[0] - latEdges[rows]) / rows) * M_PER_DEG;
  const { down, acc, pondDepth } = flowModel(grid, cellW, cellH);
  const cellArea = cellW * cellH;
  const centre = (i: number): [number, number] => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return [(lonEdges[c] + lonEdges[c + 1]) / 2, (latEdges[r] + latEdges[r + 1]) / 2];
  };
  const [w, s, e, n] = landBbox;
  const inside = (p: [number, number]) =>
    ring && ring.length >= 3 ? pointInRing({ longitude: p[0], latitude: p[1] }, ring) : p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;

  const cells: WaterFlowCell[] = [];
  const lines: WaterFlowLine[] = [];
  let land = 0;
  let run = 0;
  let pooled = 0;
  for (let i = 0; i < cols * rows; i++) {
    if (Number.isNaN(grid.z[i])) continue;
    const p = centre(i);
    if (!inside(p)) continue;
    land++;
    const level = flowLevel(acc[i] * cellArea);
    const pond = pondDepth[i] >= POND_M;
    if (level >= 2) run++;
    if (pond) pooled++;
    if (!level && !pond) continue;
    const r = Math.floor(i / cols);
    const c = i % cols;
    cells.push({
      ring: [
        [lonEdges[c], latEdges[r]],
        [lonEdges[c + 1], latEdges[r]],
        [lonEdges[c + 1], latEdges[r + 1]],
        [lonEdges[c], latEdges[r + 1]],
      ],
      level,
      pond,
    });
    if (level && down[i] >= 0) lines.push({ from: p, to: centre(down[i]), level });
  }
  return {
    cells,
    lines,
    source: grid.source,
    runShare: land ? run / land : 0,
    pondShare: land ? pooled / land : 0,
  };
}

/** Reads elevation and builds the flow shading for one piece of land. */
export async function readWaterFlow(
  landBbox: [number, number, number, number],
  ring: LatLng[] | null,
  getJson: FetchJson,
  get: FetchRange = fetchRange,
): Promise<WaterFlowMap> {
  const grid = await readElevationGrid(landBbox, getJson, get);
  return waterFlowMap(grid, landBbox, ring);
}
