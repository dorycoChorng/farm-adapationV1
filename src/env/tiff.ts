import { inflate } from 'pako';

/**
 * Minimal reader for tiled, cloud-optimised GeoTIFFs: fetches the header and only
 * the tiles that hold the requested pixels, using HTTP range requests.
 *
 * Supports what the rasters the app reads use: classic TIFF and BigTIFF, one band,
 * 8/16-bit integers or 32-bit floats, no, DEFLATE or LZW compression, and horizontal
 * predictor 2. Kept dependency-light on purpose (only pako) so it runs the same on
 * Hermes and in tests.
 */

export type FetchRange = (url: string, start: number, endInclusive: number) => Promise<ArrayBuffer>;

export class RasterNotFoundError extends Error {
  constructor(url: string) {
    super(`raster not found: ${url}`);
    this.name = 'RasterNotFoundError';
  }
}

export interface CogInfo {
  url: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  bitsPerSample: 8 | 16 | 32;
  signed: boolean;
  /** 32-bit samples are IEEE floats (the only 32-bit kind supported). */
  float: boolean;
  compression: 1 | 5 | 8 | 32946;
  predictor: 1 | 2;
  littleEndian: boolean;
  tileOffsets: number[];
  tileByteCounts: number[];
  /** Upper-left corner and pixel size in the raster's own CRS, when georeferenced. */
  origin: [number, number] | null;
  pixelSize: [number, number] | null;
  noData: number | null;
  /** Lower-resolution copies, finest first (empty when the file has none). */
  overviews: CogInfo[];
}

const HEADER_BYTES = 65536;

const TAG = {
  width: 256,
  height: 257,
  bits: 258,
  compression: 259,
  predictor: 317,
  tileWidth: 322,
  tileHeight: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  sampleFormat: 339,
  pixelScale: 33550,
  tiepoint: 33922,
  noData: 42113,
} as const;

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

/** Default range fetcher using the platform fetch. Missing files (403/404 on S3) raise RasterNotFoundError. */
export const fetchRange: FetchRange = async (url, start, end) => {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status === 404 || res.status === 403) throw new RasterNotFoundError(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  // A server that ignores Range sends the whole file; slice out what was asked for.
  if (res.status === 200 && buf.byteLength > end - start + 1) return buf.slice(start, end + 1);
  return buf;
};

export async function openCog(url: string, get: FetchRange = fetchRange, headerBytes = HEADER_BYTES): Promise<CogInfo> {
  let header = await get(url, 0, headerBytes - 1);
  let view = new DataView(header);
  const order = view.getUint16(0, true);
  if (order !== 0x4949 && order !== 0x4d4d) throw new Error('not a TIFF file');
  const le = order === 0x4949;
  const version = view.getUint16(2, le);
  if (version !== 42 && version !== 43) throw new Error('not a TIFF file');
  // BigTIFF (43) uses 8-byte offsets and counts, and 20-byte directory entries.
  const big = version === 43;
  const u64 = (p: number) =>
    le ? view.getUint32(p, true) + view.getUint32(p + 4, true) * 2 ** 32 : view.getUint32(p, false) * 2 ** 32 + view.getUint32(p + 4, false);
  const offset = (p: number) => (big ? u64(p) : view.getUint32(p, le));
  const ifd = big ? u64(8) : view.getUint32(4, le);

  const ensure = async (end: number) => {
    if (end <= header.byteLength) return;
    header = await get(url, 0, end + 4096);
    view = new DataView(header);
  };

  type Tags = Map<number, { type: number; count: number; at: number }>;
  const [countSize, entrySize, inline] = big ? [8, 20, 8] : [2, 12, 4];
  const readIfd = async (at: number): Promise<{ tags: Tags; next: number }> => {
    await ensure(at + countSize);
    const count = big ? u64(at) : view.getUint16(at, le);
    const first = at + countSize;
    await ensure(first + count * entrySize + inline);
    const tags: Tags = new Map();
    for (let i = 0; i < count; i++) {
      const p = first + i * entrySize;
      const tag = view.getUint16(p, le);
      const type = view.getUint16(p + 2, le);
      const n = big ? u64(p + 4) : view.getUint32(p + 4, le);
      const valueAt = p + (big ? 12 : 8);
      const size = (TYPE_SIZE[type] ?? 1) * n;
      tags.set(tag, { type, count: n, at: size <= inline ? valueAt : offset(valueAt) });
    }
    return { tags, next: offset(first + count * entrySize) };
  };

  const values = async (tags: Tags, tag: number): Promise<number[] | null> => {
    const t = tags.get(tag);
    if (!t) return null;
    const size = TYPE_SIZE[t.type] ?? 1;
    await ensure(t.at + t.count * size);
    const out: number[] = [];
    for (let i = 0; i < t.count; i++) {
      const p = t.at + i * size;
      switch (t.type) {
        case 3: out.push(view.getUint16(p, le)); break;
        case 4: out.push(view.getUint32(p, le)); break;
        case 11: out.push(view.getFloat32(p, le)); break;
        case 12: out.push(view.getFloat64(p, le)); break;
        case 16: out.push(u64(p)); break;
        default: out.push(view.getUint8(p));
      }
    }
    return out;
  };
  const one = async (tags: Tags, tag: number, fallback?: number) => {
    const v = await values(tags, tag);
    if (v && v.length) return v[0];
    if (fallback === undefined) throw new Error(`TIFF tag ${tag} missing`);
    return fallback;
  };

  /** Everything but georeferencing, which only the full-resolution image carries. */
  const image = async (tags: Tags) => {
    const tileWidth = await values(tags, TAG.tileWidth);
    if (!tileWidth) throw new Error('only tiled TIFFs are supported');
    const bits = await one(tags, TAG.bits, 8);
    const sampleFormat = await one(tags, TAG.sampleFormat, 1);
    if (bits !== 8 && bits !== 16 && !(bits === 32 && sampleFormat === 3)) {
      throw new Error(`unsupported samples: ${bits}-bit, format ${sampleFormat}`);
    }
    const compression = await one(tags, TAG.compression, 1);
    if (compression !== 1 && compression !== 5 && compression !== 8 && compression !== 32946) {
      throw new Error(`unsupported compression: ${compression}`);
    }
    const predictor = await one(tags, TAG.predictor, 1);
    if (predictor !== 1 && predictor !== 2) throw new Error(`unsupported predictor: ${predictor}`);
    return {
      url,
      width: await one(tags, TAG.width),
      height: await one(tags, TAG.height),
      tileWidth: tileWidth[0],
      tileHeight: await one(tags, TAG.tileHeight),
      bitsPerSample: bits as 8 | 16 | 32,
      signed: sampleFormat === 2,
      float: sampleFormat === 3,
      compression: compression as CogInfo['compression'],
      predictor: predictor as CogInfo['predictor'],
      littleEndian: le,
      tileOffsets: (await values(tags, TAG.tileOffsets)) ?? [],
      tileByteCounts: (await values(tags, TAG.tileByteCounts)) ?? [],
    };
  };

  const first = await readIfd(ifd);
  const main = await image(first.tags);
  const scale = await values(first.tags, TAG.pixelScale);
  const tie = await values(first.tags, TAG.tiepoint);
  const ndRaw = await values(first.tags, TAG.noData);
  const nd = ndRaw ? String.fromCharCode(...ndRaw.filter((c) => c !== 0)) : null;
  const origin: [number, number] | null =
    tie && tie.length >= 6 ? [tie[3] - tie[0] * (scale?.[0] ?? 0), tie[4] + tie[1] * (scale?.[1] ?? 0)] : null;
  const pixelSize: [number, number] | null = scale && scale.length >= 2 ? [scale[0], scale[1]] : null;
  const noData = nd && nd.trim() !== '' && Number.isFinite(Number(nd)) ? Number(nd) : null;

  // Reduced-resolution copies (overviews) follow as further images covering the same area.
  const overviews: CogInfo[] = [];
  let next = first.next;
  while (next && overviews.length < 16) {
    const ov = await readIfd(next);
    const img = await image(ov.tags);
    overviews.push({
      ...img,
      origin,
      pixelSize: pixelSize ? [(pixelSize[0] * main.width) / img.width, (pixelSize[1] * main.height) / img.height] : null,
      noData,
      overviews: [],
    });
    next = ov.next;
  }

  return { ...main, origin, pixelSize, noData, overviews };
}

/**
 * Decoded tile cache shared by all readers, keyed by url, image size and tile index.
 * Tiles are up to 1 MB each; the map overlay touches up to four per map tile.
 */
const tileCache = new Map<string, Promise<ArrayLike<number>>>();
const TILE_CACHE_SIZE = 16;

export function clearTileCache() {
  tileCache.clear();
}

async function loadTile(cog: CogInfo, index: number, get: FetchRange): Promise<ArrayLike<number>> {
  const key = `${cog.url}@${cog.width}#${index}`;
  const hit = tileCache.get(key);
  if (hit) {
    tileCache.delete(key);
    tileCache.set(key, hit);
    return hit;
  }
  const promise = decodeTile(cog, index, get);
  tileCache.set(key, promise);
  promise.catch(() => tileCache.delete(key));
  while (tileCache.size > TILE_CACHE_SIZE) tileCache.delete(tileCache.keys().next().value as string);
  return promise;
}

async function decodeTile(cog: CogInfo, index: number, get: FetchRange): Promise<ArrayLike<number>> {
  const offset = cog.tileOffsets[index];
  const length = cog.tileByteCounts[index];
  const n = cog.tileWidth * cog.tileHeight;
  if (!length) return new Array<number>(n).fill(cog.noData ?? 0);
  const raw = await get(cog.url, offset, offset + length - 1);
  const bytes =
    cog.compression === 1 ? new Uint8Array(raw) : cog.compression === 5 ? lzwDecode(new Uint8Array(raw)) : inflate(new Uint8Array(raw));
  return decodeSamples(bytes, cog);
}

/** Turn a decompressed tile into sample values, undoing the horizontal predictor. Exported for tests. */
export function decodeSamples(
  bytes: Uint8Array,
  cog: Pick<CogInfo, 'tileWidth' | 'tileHeight' | 'bitsPerSample' | 'signed' | 'predictor' | 'littleEndian'> & { float?: boolean },
): ArrayLike<number> {
  const n = cog.tileWidth * cog.tileHeight;
  if (cog.bitsPerSample === 32) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const floats = new Float32Array(n);
    for (let i = 0; i < n; i++) floats[i] = v.getFloat32(i * 4, cog.littleEndian);
    return floats;
  }
  let out: Uint8Array | Int8Array | Uint16Array | Int16Array;
  if (cog.bitsPerSample === 8) {
    out = cog.signed ? new Int8Array(n) : new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = bytes[i];
  } else {
    out = cog.signed ? new Int16Array(n) : new Uint16Array(n);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < n; i++) out[i] = cog.signed ? v.getInt16(i * 2, cog.littleEndian) : v.getUint16(i * 2, cog.littleEndian);
  }
  if (cog.predictor === 2) {
    // Typed arrays wrap on overflow, which is exactly the modular sum the predictor needs.
    for (let row = 0; row < cog.tileHeight; row++) {
      const base = row * cog.tileWidth;
      for (let col = 1; col < cog.tileWidth; col++) out[base + col] += out[base + col - 1];
    }
  }
  return out;
}

/**
 * TIFF LZW decompression (codes written most significant bit first, code width
 * growing one code early, as libtiff writes them). Exported for tests.
 */
export function lzwDecode(input: Uint8Array): Uint8Array {
  const CLEAR = 256;
  const EOI = 257;
  // Dictionary entries as (prefix code, last byte, length); strings are rebuilt on output.
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Int32Array(4096);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    length[i] = 1;
  }
  let out = new Uint8Array(Math.max(1024, input.length * 4));
  let outLen = 0;
  const ensureOut = (extra: number) => {
    if (outLen + extra <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, outLen + extra));
    bigger.set(out.subarray(0, outLen));
    out = bigger;
  };
  const write = (code: number) => {
    const len = length[code];
    ensureOut(len);
    let c = code;
    for (let i = len - 1; i >= 0; i--) {
      out[outLen + i] = suffix[c];
      c = prefix[c];
    }
    outLen += len;
  };
  const firstByte = (code: number) => {
    let c = code;
    while (prefix[c] !== -1) c = prefix[c];
    return suffix[c];
  };

  let bitPos = 0;
  const totalBits = input.length * 8;
  let width = 9;
  let next = 258;
  let old = -1;
  while (bitPos + width <= totalBits) {
    // Read `width` bits, most significant first.
    let code = 0;
    for (let i = 0; i < width; i++) {
      const bit = (input[(bitPos + i) >> 3] >> (7 - ((bitPos + i) & 7))) & 1;
      code = (code << 1) | bit;
    }
    bitPos += width;
    if (code === EOI) break;
    if (code === CLEAR) {
      width = 9;
      next = 258;
      old = -1;
      continue;
    }
    if (old === -1) {
      write(code);
      old = code;
      continue;
    }
    if (code < next) {
      write(code);
      if (next < 4096) {
        prefix[next] = old;
        suffix[next] = firstByte(code);
        length[next] = length[old] + 1;
        next++;
      }
    } else {
      // The code being defined right now: old string plus its own first byte.
      if (next < 4096) {
        prefix[next] = old;
        suffix[next] = firstByte(old);
        length[next] = length[old] + 1;
        next++;
      }
      write(code);
    }
    old = code;
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return out.subarray(0, outLen);
}

/** One decoded tile by its column and row in the tile grid. */
export function readTile(cog: CogInfo, tx: number, ty: number, get: FetchRange = fetchRange): Promise<ArrayLike<number>> {
  return loadTile(cog, ty * Math.ceil(cog.width / cog.tileWidth) + tx, get);
}

/**
 * Read one pixel by column/row. Returns null for no-data or out-of-range pixels.
 * `cache: false` skips the shared tile cache, for one-off files that would only push useful tiles out.
 */
export async function readPixel(
  cog: CogInfo,
  col: number,
  row: number,
  get: FetchRange = fetchRange,
  { cache = true }: { cache?: boolean } = {},
): Promise<number | null> {
  if (col < 0 || row < 0 || col >= cog.width || row >= cog.height) return null;
  const tilesAcross = Math.ceil(cog.width / cog.tileWidth);
  const tx = Math.floor(col / cog.tileWidth);
  const ty = Math.floor(row / cog.tileHeight);
  const index = ty * tilesAcross + tx;
  const tile = await (cache ? loadTile(cog, index, get) : decodeTile(cog, index, get));
  const value = tile[(row - ty * cog.tileHeight) * cog.tileWidth + (col - tx * cog.tileWidth)];
  return cog.noData !== null && value === cog.noData ? null : value;
}

/** Pixel column/row for a coordinate in the raster's own CRS (degrees for EPSG:4326 rasters). */
export function pixelFor(cog: CogInfo, x: number, y: number): [number, number] | null {
  if (!cog.origin || !cog.pixelSize) return null;
  return [Math.floor((x - cog.origin[0]) / cog.pixelSize[0]), Math.floor((cog.origin[1] - y) / cog.pixelSize[1])];
}
