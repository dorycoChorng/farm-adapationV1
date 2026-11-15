import type { LatLng } from '../geo/types';
import { type CogInfo, type FetchRange, fetchRange, openCog, pixelFor, RasterNotFoundError, readPixel, readTile } from './tiff';
import type { LandCoverData, TerrainData } from './types';

const cogCache = new Map<string, Promise<CogInfo>>();

/** Opens a cloud-optimised GeoTIFF once and keeps its header for later reads. */
export function cog(url: string, get: FetchRange, headerBytes?: number) {
  let p = cogCache.get(url);
  if (!p) {
    p = openCog(url, get, headerBytes);
    cogCache.set(url, p);
    // Remember missing files (open sea has none) so the map overlay doesn't ask again.
    p.catch((e) => {
      if (!(e instanceof RasterNotFoundError)) cogCache.delete(url);
    });
    if (cogCache.size > 48) cogCache.delete(cogCache.keys().next().value as string);
  }
  return p;
}

// ---------------------------------------------------------------- terrain

/** AWS Terrain Tiles as GeoTIFF: 512 px Web Mercator tiles of signed 16-bit metres. */
export const DEM_ZOOM = 12;
const DEM_TILE = 512;
const EARTH_RADIUS = 6378137;

export const demTileUrl = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/geotiff/${z}/${x}/${y}.tif`;

/** Global Web Mercator pixel for a coordinate at the DEM zoom. */
export function demPixel(p: LatLng, z = DEM_ZOOM): [number, number] {
  const size = DEM_TILE * 2 ** z;
  const lat = Math.max(-85.0511, Math.min(85.0511, p.latitude));
  const x = ((p.longitude + 180) / 360) * size;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size;
  return [Math.floor(x), Math.floor(y)];
}

/** Ground size of one DEM cell at a latitude, in metres. */
export const demCellSize = (latitude: number, z = DEM_ZOOM) =>
  (2 * Math.PI * EARTH_RADIUS * Math.cos((latitude * Math.PI) / 180)) / (DEM_TILE * 2 ** z);

export async function demAt(gx: number, gy: number, z: number, get: FetchRange) {
  const n = 2 ** z;
  const tx = Math.floor(gx / DEM_TILE);
  const ty = Math.floor(gy / DEM_TILE);
  if (ty < 0 || ty >= n) return null;
  const wrapped = ((tx % n) + n) % n;
  const info = await cog(demTileUrl(z, wrapped, ty), get);
  return readPixel(info, gx - tx * DEM_TILE, gy - ty * DEM_TILE, get);
}

/** Horn's method slope in degrees from a 3×3 window of elevations (row-major, a..i). */
export function hornSlope(w: number[], cellSize: number) {
  const [a, b, c, d, , f, g, h, i] = w;
  const dx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cellSize);
  const dy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * cellSize);
  return (Math.atan(Math.sqrt(dx * dx + dy * dy)) * 180) / Math.PI;
}

export async function readTerrain(p: LatLng, get: FetchRange = fetchRange): Promise<TerrainData | null> {
  const [gx, gy] = demPixel(p);
  const window: (number | null)[] = await Promise.all(
    [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => demAt(gx + dx, gy + dy, DEM_ZOOM, get))),
  );
  const centre = window[4];
  if (centre === null) return null;
  const cellSizeM = demCellSize(p.latitude);
  const slopeDeg = window.every((v) => v !== null) ? Number(hornSlope(window as number[], cellSizeM).toFixed(1)) : null;
  return { elevationM: centre, slopeDeg, cellSizeM: Number(cellSizeM.toFixed(1)) };
}

// ---------------------------------------------------------------- land cover

/** ESA WorldCover 2021 v200 3°×3° tiles, named by their south-west corner. */
export function worldCoverTileUrl(p: LatLng) {
  const lat = Math.floor(p.latitude / 3) * 3;
  const lon = Math.floor(p.longitude / 3) * 3;
  const ns = `${lat < 0 ? 'S' : 'N'}${String(Math.abs(lat)).padStart(2, '0')}`;
  const ew = `${lon < 0 ? 'W' : 'E'}${String(Math.abs(lon)).padStart(3, '0')}`;
  return `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${ns}${ew}_Map.tif`;
}

export async function landCoverAt(p: LatLng, get: FetchRange): Promise<number | null> {
  try {
    const info = await cog(worldCoverTileUrl(p), get);
    const px = pixelFor(info, p.longitude, p.latitude);
    if (!px) return null;
    const v = await readPixel(info, px[0], px[1], get);
    return v === 0 ? null : v;
  } catch (e) {
    // WorldCover has no files for open ocean.
    if (e instanceof RasterNotFoundError) return null;
    throw e;
  }
}

export function pointInRing(p: LatLng, ring: LatLng[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.latitude > p.latitude !== b.latitude > p.latitude) {
      const x = ((b.longitude - a.longitude) * (p.latitude - a.latitude)) / (b.latitude - a.latitude) + a.longitude;
      if (p.longitude < x) inside = !inside;
    }
  }
  return inside;
}

/** Up to `max` grid points inside the ring, no closer than ~10 m (the WorldCover pixel size). */
export function samplePoints(ring: LatLng[], max = 225): LatLng[] {
  const lats = ring.map((p) => p.latitude);
  const lngs = ring.map((p) => p.longitude);
  const [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const minStep = 10 / 111320; // about 10 m in degrees of latitude
  const side = Math.max(1, Math.floor(Math.sqrt(max)));
  const stepLat = Math.max((n - s) / side, minStep);
  const stepLng = Math.max((e - w) / side, minStep / Math.max(0.1, Math.cos((((s + n) / 2) * Math.PI) / 180)));
  const out: LatLng[] = [];
  for (let lat = s + stepLat / 2; lat < n; lat += stepLat) {
    for (let lng = w + stepLng / 2; lng < e; lng += stepLng) {
      const p = { latitude: lat, longitude: lng };
      if (pointInRing(p, ring)) out.push(p);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export async function readLandCover(centre: LatLng, ring: LatLng[] | null, get: FetchRange = fetchRange): Promise<LandCoverData | null> {
  const points = ring && ring.length >= 3 ? samplePoints(ring) : [];
  if (points.length === 0) points.push(centre);
  const values: (number | null)[] = [];
  // Sequential keeps memory flat; points share a handful of cached tiles.
  for (const p of points) values.push(await landCoverAt(p, get));
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of valid) counts.set(v, (counts.get(v) ?? 0) + 1);
  const fractions = [...counts.entries()]
    .map(([code, n]) => ({ code, fraction: Number((n / valid.length).toFixed(3)) }))
    .sort((a, b) => b.fraction - a.fraction);
  return {
    classAtPoint: ring ? fractions[0].code : valid[0],
    fractions,
    samples: valid.length,
  };
}

// ------------------------------------------------------- land-cover map tiles

export const LAND_COVER_TILE_SIZE = 256;
/** Below this zoom a map tile spans too many 3° files to read on a phone. */
export const LAND_COVER_MIN_ZOOM = 7;

const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** The coarsest image (full resolution or overview) still at least as detailed as the map tile. */
function levelFor(info: CogInfo, degPerPixel: number): CogInfo {
  let best = info;
  for (const ov of info.overviews) if (ov.pixelSize && ov.pixelSize[0] <= degPerPixel) best = ov;
  return best;
}

/**
 * WorldCover class codes for one Web Mercator map tile (row-major, 0 = no data),
 * sampled from ESA's files at the nearest suitable resolution. Null when nothing in
 * the tile has data (open sea) or the zoom is below LAND_COVER_MIN_ZOOM.
 */
export async function landCoverTile(z: number, x: number, y: number, get: FetchRange = fetchRange): Promise<Uint8Array | null> {
  if (z < LAND_COVER_MIN_ZOOM) return null;
  const size = LAND_COVER_TILE_SIZE;
  const [w, e] = [tileLon(x, z), tileLon(x + 1, z)];
  const [n, s] = [tileLat(y, z), tileLat(y + 1, z)];
  const lons = Array.from({ length: size }, (_, i) => w + ((i + 0.5) / size) * (e - w));
  const lats = Array.from({ length: size }, (_, j) => tileLat(y + (j + 0.5) / size, z));
  const degPerPixel = (e - w) / size;
  const out = new Uint8Array(size * size);
  let any = false;

  const files: LatLng[] = [];
  for (let lat = Math.floor(s / 3) * 3; lat < n; lat += 3) {
    for (let lon = Math.floor(w / 3) * 3; lon < e; lon += 3) files.push({ latitude: lat + 1.5, longitude: lon + 1.5 });
  }

  await Promise.all(
    files.map(async (centre) => {
      let info: CogInfo;
      try {
        info = await cog(worldCoverTileUrl(centre), get);
      } catch (err) {
        if (err instanceof RasterNotFoundError) return;
        throw err;
      }
      const img = levelFor(info, degPerPixel);
      if (!img.origin || !img.pixelSize) return;
      const cols = lons.map((lon) => Math.floor((lon - img.origin![0]) / img.pixelSize![0]));
      const rows = lats.map((lat) => Math.floor((img.origin![1] - lat) / img.pixelSize![1]));
      const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < img.width && r < img.height;
      // Load each needed tile of this file once, then sample synchronously.
      const needed = new Map<string, [number, number]>();
      for (const r of rows) {
        for (const c of cols) {
          if (!inside(c, r)) continue;
          const tx = Math.floor(c / img.tileWidth);
          const ty = Math.floor(r / img.tileHeight);
          needed.set(`${tx},${ty}`, [tx, ty]);
        }
      }
      const tiles = new Map<string, ArrayLike<number>>();
      await Promise.all([...needed].map(async ([k, [tx, ty]]) => tiles.set(k, await readTile(img, tx, ty, get))));
      for (let j = 0; j < size; j++) {
        const r = rows[j];
        for (let i = 0; i < size; i++) {
          const c = cols[i];
          if (!inside(c, r)) continue;
          const tx = Math.floor(c / img.tileWidth);
          const ty = Math.floor(r / img.tileHeight);
          const v = tiles.get(`${tx},${ty}`)![(r - ty * img.tileHeight) * img.tileWidth + (c - tx * img.tileWidth)];
          if (v && v !== img.noData) {
            out[j * size + i] = v;
            any = true;
          }
        }
      }
    }),
  );
  return any ? out : null;
}

/** Run-length encode as [value, count, value, count, ...]; class maps compress well this way. */
export function runLength(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; ) {
    let j = i + 1;
    while (j < values.length && values[j] === values[i]) j++;
    out.push(values[i], j - i);
    i = j;
  }
  return out;
}
