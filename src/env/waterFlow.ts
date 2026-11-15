import type { LatLng } from '../geo/types';
import type { FetchJson } from './analyze';
import { NASADEM_LAT, nasademUrl, planetaryToken } from './planetary';
import { cog, demAt, demPixel, pointInRing } from './rasters';
import { type FetchRange, fetchRange, pixelFor, readPixel } from './tiff';
import { pathKind, type WaterPathKind } from './waterStyle';

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
      const info = await cog(nasademUrl(lat, lon, sas), get);
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
    const midLat = (bbox[1] + bbox[3]) / 2;
    if (midLat < NASADEM_LAT[0] || midLat > NASADEM_LAT[1]) throw new Error('outside NASADEM');
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
/** One stretch of a water path, running downhill from its first point to its last. */
export interface WaterFlowPath {
  coords: [number, number][];
  kind: WaterPathKind;
}
export interface WaterFlowMap {
  /** Pooling spots only (cells where water stands before it overflows). */
  cells: WaterFlowCell[];
  /** Connected, smoothed water paths across the land, split where they grow bigger. */
  paths: WaterFlowPath[];
  source: ElevationGrid['source'];
  /** Share of the land's cells with running water (level ≥ 2) and with pooling water. */
  runShare: number;
  pondShare: number;
  /** The biggest kind of path on the land, or null when no path forms. */
  biggest: WaterPathKind | null;
}

/** Rounds off the 45° zig-zags of D8 paths (Chaikin), keeping both ends where they are. */
function smooth(line: [number, number][], rounds = 2): [number, number][] {
  let pts = line;
  for (let k = 0; k < rounds && pts.length > 2; k++) {
    const out: [number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      if (i > 0) out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      if (i < pts.length - 2) out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** Water paths and pooling spots for the land (the parcel, or the bbox when there is none). */
export function waterFlowMap(grid: ElevationGrid, landBbox: [number, number, number, number], ring: LatLng[] | null): WaterFlowMap {
  const { cols, rows, lonEdges, latEdges } = grid;
  const n = cols * rows;
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
  const [w, s, e, nn] = landBbox;
  const inside = new Uint8Array(n);
  const level = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(grid.z[i])) continue;
    const p = centre(i);
    const isIn =
      ring && ring.length >= 3 ? pointInRing({ longitude: p[0], latitude: p[1] }, ring) : p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= nn;
    if (isIn) inside[i] = 1;
    level[i] = flowLevel(acc[i] * cellArea);
  }

  const cells: WaterFlowCell[] = [];
  let land = 0;
  let run = 0;
  let pooled = 0;
  let top = 0;
  for (let i = 0; i < n; i++) {
    if (!inside[i]) continue;
    land++;
    if (level[i] >= 2) run++;
    if (level[i] > top) top = level[i];
    if (pondDepth[i] < POND_M) continue;
    pooled++;
    const r = Math.floor(i / cols);
    const c = i % cols;
    cells.push({
      ring: [
        [lonEdges[c], latEdges[r]],
        [lonEdges[c + 1], latEdges[r]],
        [lonEdges[c + 1], latEdges[r + 1]],
        [lonEdges[c], latEdges[r + 1]],
      ],
      level: level[i],
      pond: true,
    });
  }

  // Which cells get a path. Run-off forms on every slope, and drawing all of it hides the
  // paths that matter, so only these are drawn:
  //  - streams and main water paths (level 3 and up);
  //  - the biggest run-off on the land (a quarter or more of the largest flow);
  //  - and, going uphill from each of those, the run-off that feeds it most, so each path
  //    is drawn up to where it starts.
  // Run-off means level 2 and up; on small or flat land where nothing reaches level 2, level 1.
  const minLevel = top >= 2 ? 2 : 1;
  let maxAcc = 0;
  for (let i = 0; i < n; i++) if (inside[i] && acc[i] > maxAcc) maxAcc = acc[i];
  const show = new Uint8Array(n);
  const mainUp = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const j = down[i];
    if (!inside[i] || j < 0 || !inside[j]) continue;
    if (mainUp[j] < 0 || acc[i] > acc[mainUp[j]]) mainUp[j] = i;
  }
  const seeds: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inside[i] && level[i] >= minLevel && (level[i] >= 3 || acc[i] >= maxAcc / 4)) {
      show[i] = 1;
      seeds.push(i);
    }
  }
  for (const i0 of seeds) {
    for (let u = mainUp[i0]; u >= 0 && !show[u] && level[u] >= minLevel; u = mainUp[u]) show[u] = 1;
  }
  const onPath = (i: number) => show[i] === 1;
  const fed = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (onPath(i) && down[i] >= 0) fed[down[i]] = 1;
  const seen = new Uint8Array(n);
  const raw: { coords: [number, number][]; level: number }[] = [];
  // Start at the top of each path; a path that joins one already drawn stops at the join.
  for (let i0 = 0; i0 < n; i0++) {
    if (!onPath(i0) || fed[i0]) continue;
    let cur = i0;
    let lvl = level[cur];
    let coords: [number, number][] = [centre(cur)];
    for (;;) {
      seen[cur] = 1;
      const next = down[cur];
      if (next < 0) break;
      const a = centre(cur);
      const b = centre(next);
      if (!inside[next]) {
        // Run on to about the edge of the land, then stop.
        coords.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        break;
      }
      coords.push(b);
      if (seen[next]) break;
      if (level[next] !== lvl) {
        raw.push({ coords, level: lvl });
        coords = [b];
        lvl = level[next];
      }
      cur = next;
    }
    if (coords.length >= 2) raw.push({ coords, level: lvl });
  }
  const paths: WaterFlowPath[] = raw.map((p) => ({ coords: smooth(p.coords), kind: pathKind(p.level) }));

  return {
    cells,
    paths,
    source: grid.source,
    runShare: land ? run / land : 0,
    pondShare: land ? pooled / land : 0,
    biggest: top >= minLevel && paths.length ? pathKind(top) : null,
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
