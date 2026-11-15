/**
 * Unit tests for the environmental analysis.
 *
 * Every number in the fixtures below is SYNTHETIC: chosen to exercise parsing and
 * scoring, shaped like the documented API responses, and never shown in the app.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { deflate } from 'pako';

import { analyzeLocation, type FetchJson } from '../analyze';
import { webUrl } from '../appFetch';
import { CROPS, type CropProfile, cropById, cycleMonths, searchCrops } from '../crops';
import { lastCompleteYear, parseClimatology, parseMonthlyRain, toKwhPerDay } from '../power';
import { demCellSize, demPixel, hornSlope, landCoverTile, pointInRing, runLength, samplePoints, worldCoverTileUrl } from '../rasters';
import { bundledLocalProduction, cellAreaHa, countryProduction, fetchLocalProduction, gaezCodeFor } from '../gaez';
import { plantNow, seasonalAssessment, seasonOf, seasonsFor } from '../seasons';
import { classify, factorScore, landCheck, rankCrops, scoreCrop, siteWarnings } from '../suitability';
import { clearTileCache, decodeSamples, type FetchRange, lzwDecode, openCog, pixelFor, RasterNotFoundError, readPixel } from '../tiff';
import type { EnvSummary } from '../types';
import { clipToRect, zoneAt, zoneCells, zoneKind, zoneSummary } from '../zones';
import { countryAt } from '../../geo/countryAt';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const monthly = (values: number[], ann?: number) => {
  const o: Record<string, number> = {};
  MONTHS.forEach((m, i) => (o[m] = values[i]));
  if (ann !== undefined) o.ANN = ann;
  return o;
};

// ------------------------------------------------------------------ TIFF reader

/** Build a tiny little-endian tiled TIFF in memory (synthetic raster). */
function buildTiff(opts: {
  width: number;
  height: number;
  tile: number;
  bits: 8 | 16;
  signed?: boolean;
  predictor?: 1 | 2;
  compress?: boolean;
  pixels: (x: number, y: number) => number;
  geo?: { originX: number; originY: number; size: number };
  noData?: string;
}): ArrayBuffer {
  const tilesX = Math.ceil(opts.width / opts.tile);
  const tilesY = Math.ceil(opts.height / opts.tile);
  const bytesPer = opts.bits / 8;
  const tiles: Uint8Array[] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const raw = new Uint8Array(opts.tile * opts.tile * bytesPer);
      const dv = new DataView(raw.buffer);
      for (let y = 0; y < opts.tile; y++) {
        let prev = 0;
        for (let x = 0; x < opts.tile; x++) {
          const gx = tx * opts.tile + x;
          const gy = ty * opts.tile + y;
          const v = gx < opts.width && gy < opts.height ? opts.pixels(gx, gy) : 0;
          const stored = opts.predictor === 2 && x > 0 ? v - prev : v;
          prev = v;
          const i = y * opts.tile + x;
          if (opts.bits === 8) raw[i] = stored & 0xff;
          else dv.setInt16(i * 2, ((stored + 0x8000) & 0xffff) - 0x8000, true);
        }
      }
      tiles.push(opts.compress ? deflate(raw) : raw);
    }
  }
  type Entry = [tag: number, type: number, values: number[]];
  const entries: Entry[] = [
    [256, 3, [opts.width]],
    [257, 3, [opts.height]],
    [258, 3, [opts.bits]],
    [259, 3, [opts.compress ? 8 : 1]],
    [317, 3, [opts.predictor ?? 1]],
    [322, 3, [opts.tile]],
    [323, 3, [opts.tile]],
    [324, 4, tiles.map(() => 0)],
    [325, 4, tiles.map((t) => t.length)],
    [339, 3, [opts.signed ? 2 : 1]],
  ];
  if (opts.geo) {
    entries.push([33550, 12, [opts.geo.size, opts.geo.size, 0]]);
    entries.push([33922, 12, [0, 0, 0, opts.geo.originX, opts.geo.originY, 0]]);
  }
  if (opts.noData) entries.push([42113, 2, [...opts.noData].map((c) => c.charCodeAt(0)).concat(0)]);
  const size = (t: number) => ({ 2: 1, 3: 2, 4: 4, 12: 8 })[t]!;

  const ifdAt = 8;
  let extra = ifdAt + 2 + entries.length * 12 + 4;
  const extraAt = entries.map(([, type, v]) => {
    const n = size(type) * v.length;
    if (n <= 4) return -1;
    const at = extra;
    extra += n;
    return at;
  });
  let dataAt = extra;
  const tileOffsets = tiles.map((t) => {
    const at = dataAt;
    dataAt += t.length;
    return at;
  });
  entries[7][2] = tileOffsets;

  const buf = new ArrayBuffer(dataAt);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint16(0, 0x4949, true);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdAt, true);
  dv.setUint16(ifdAt, entries.length, true);
  const write = (at: number, type: number, v: number) => {
    if (type === 3) dv.setUint16(at, v, true);
    else if (type === 4) dv.setUint32(at, v, true);
    else if (type === 12) dv.setFloat64(at, v, true);
    else dv.setUint8(at, v);
  };
  entries.forEach(([tag, type, values], i) => {
    const at = ifdAt + 2 + i * 12;
    dv.setUint16(at, tag, true);
    dv.setUint16(at + 2, type, true);
    dv.setUint32(at + 4, values.length, true);
    if (extraAt[i] < 0) values.forEach((v, k) => write(at + 8 + k * size(type), type, v));
    else {
      dv.setUint32(at + 8, extraAt[i], true);
      values.forEach((v, k) => write(extraAt[i] + k * size(type), type, v));
    }
  });
  tiles.forEach((t, i) => u8.set(t, tileOffsets[i]));
  return buf;
}

const rangeOver = (files: Record<string, ArrayBuffer>, log: string[] = []): FetchRange => async (url, start, end) => {
  const f = files[url];
  if (!f) throw new Error(`no file ${url}`);
  log.push(`${url}:${start}-${end}`);
  return f.slice(start, Math.min(end + 1, f.byteLength));
};

beforeEach(() => clearTileCache());

describe('GeoTIFF reader', () => {
  it('reads 8-bit deflate tiles with georeferencing and no-data', async () => {
    const file = buildTiff({
      width: 40,
      height: 30,
      tile: 16,
      bits: 8,
      compress: true,
      pixels: (x, y) => (x === 5 && y === 5 ? 0 : (x + y) % 100),
      geo: { originX: 100, originY: 20, size: 0.5 },
      noData: '0',
    });
    const get = rangeOver({ f: file });
    const cog = await openCog('f', get);
    expect(cog).toMatchObject({ width: 40, height: 30, tileWidth: 16, bitsPerSample: 8, compression: 8, noData: 0 });
    expect(await readPixel(cog, 33, 21, get)).toBe(54);
    expect(await readPixel(cog, 5, 5, get)).toBeNull();
    expect(await readPixel(cog, 40, 0, get)).toBeNull();
    // Lon 103.2 / lat 17.6 → column 6, row 4.
    expect(pixelFor(cog, 103.2, 17.6)).toEqual([6, 4]);
  });

  it('undoes the horizontal predictor for signed 16-bit data', async () => {
    const elevation = (x: number, y: number) => -50 + x * 37 - y * 11;
    const file = buildTiff({ width: 32, height: 32, tile: 16, bits: 16, signed: true, predictor: 2, compress: true, pixels: elevation });
    const get = rangeOver({ dem: file });
    const cog = await openCog('dem', get);
    for (const [x, y] of [
      [0, 0],
      [15, 3],
      [16, 16],
      [31, 31],
      [20, 7],
    ]) {
      expect(await readPixel(cog, x, y, get)).toBe(elevation(x, y));
    }
  });

  it('fetches only the header and the one tile it needs', async () => {
    const file = buildTiff({ width: 64, height: 64, tile: 16, bits: 8, pixels: () => 7 });
    const log: string[] = [];
    const get = rangeOver({ f: file }, log);
    const cog = await openCog('f', get);
    log.length = 0;
    await readPixel(cog, 40, 40, get);
    await readPixel(cog, 41, 41, get); // same tile: served from cache
    expect(log).toHaveLength(1);
  });

  it('decodes uncompressed 8-bit samples with predictor', () => {
    const out = decodeSamples(new Uint8Array([1, 1, 1, 1]), {
      tileWidth: 4,
      tileHeight: 1,
      bitsPerSample: 8,
      signed: false,
      predictor: 2,
      littleEndian: true,
    });
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });

  it('rejects files that are not TIFFs', async () => {
    await expect(openCog('x', async () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).rejects.toThrow('not a TIFF');
  });
});

// ------------------------------------------------------------------ raster helpers

describe('raster helpers', () => {
  it('names WorldCover tiles by their south-west 3° corner', () => {
    expect(worldCoverTileUrl({ latitude: 11.5, longitude: 104.9 })).toMatch(/_N09E102_Map\.tif$/);
    expect(worldCoverTileUrl({ latitude: -0.5, longitude: -60.2 })).toMatch(/_S03W063_Map\.tif$/);
    expect(worldCoverTileUrl({ latitude: 0, longitude: 0 })).toMatch(/_N00E000_Map\.tif$/);
  });

  it('computes Web Mercator DEM pixels and cell size', () => {
    expect(demPixel({ latitude: 0, longitude: 0 })).toEqual([1048576, 1048576]);
    expect(demPixel({ latitude: 0, longitude: -180 })[0]).toBe(0);
    expect(demCellSize(0)).toBeCloseTo(19.11, 1);
    expect(demCellSize(60)).toBeCloseTo(9.55, 1);
  });

  it('gets zero slope on flat ground and 45° on a 1:1 ramp', () => {
    expect(hornSlope([5, 5, 5, 5, 5, 5, 5, 5, 5], 10)).toBe(0);
    const ramp = [0, 10, 20, 0, 10, 20, 0, 10, 20];
    expect(hornSlope(ramp, 10)).toBeCloseTo(45, 6);
  });

  it('samples points only inside the parcel', () => {
    const triangle = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.01 },
      { latitude: 0.01, longitude: 0 },
    ];
    const pts = samplePoints(triangle);
    expect(pts.length).toBeGreaterThan(50);
    expect(pts.length).toBeLessThanOrEqual(225);
    expect(pts.every((p) => pointInRing(p, triangle))).toBe(true);
    // A tiny parcel still gets at least one sample and never more than one per ~10 m.
    const tiny = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.0001 },
      { latitude: 0.0001, longitude: 0.0001 },
      { latitude: 0.0001, longitude: 0 },
    ];
    expect(samplePoints(tiny).length).toBe(1);
  });
});

// ------------------------------------------------------------------ NASA POWER

const powerClimatology = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [104.9, 11.5, 10] },
  properties: {
    parameter: {
      PRECTOTCORR: monthly([1, 1, 2, 3, 6, 7, 7, 8, 9, 8, 4, 1], 4.75),
      ALLSKY_SFC_SW_DWN: monthly([18, 19, 20, 20, 19, 17, 16, 16, 16, 16, 17, 18], 17.67),
      T2M: monthly([26, 27, 28, 29, 29, 28, 28, 28, 27, 27, 26, 25], 27.33),
      T2M_MAX: monthly(new Array(12).fill(33), 33.5),
      T2M_MIN: monthly(new Array(12).fill(22), 22.1),
    },
  },
  header: { fill_value: -999, start: '20010101', end: '20201231' },
  parameters: {
    PRECTOTCORR: { units: 'mm/day' },
    ALLSKY_SFC_SW_DWN: { units: 'MJ/m^2/day' },
    T2M: { units: 'C' },
  },
};

describe('NASA POWER parsing', () => {
  it('converts climatology units and totals rainfall by month', () => {
    const c = parseClimatology(powerClimatology);
    expect(c.monthlyRainMm[0]).toBe(31);
    expect(c.monthlyRainMm[1]).toBe(28); // 1 mm/day × 28.25 days
    expect(c.annualRainMm).toBe(Math.round([1, 1, 2, 3, 6, 7, 7, 8, 9, 8, 4, 1].reduce((a, v, i) => a + v * [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i], 0)));
    expect(c.monthlySolarKwhM2Day[0]).toBe(5); // 18 MJ ÷ 3.6
    expect(c.annualSolarKwhM2Day).toBeCloseTo(17.67 / 3.6, 2);
    expect(c.annualTempC).toBe(27.3);
    expect(c.period).toBe('2001–2020');
  });

  it('keeps fill values as missing, never as numbers', () => {
    const r = structuredClone(powerClimatology);
    r.properties.parameter.PRECTOTCORR.JUL = -999;
    const c = parseClimatology(r);
    expect(c.monthlyRainMm[6]).toBeNull();
    expect(c.annualRainMm).toBeNull();
  });

  it('reports POWER error messages', () => {
    expect(() => parseClimatology({ messages: ['Latitude out of range'] })).toThrow('Latitude out of range');
  });

  it('builds yearly totals and drops incomplete years', () => {
    const values: Record<string, number> = {};
    for (let m = 1; m <= 13; m++) values[`2023${String(m).padStart(2, '0')}`] = 2;
    for (let m = 1; m <= 12; m++) values[`2024${String(m).padStart(2, '0')}`] = m === 5 ? -999 : 1;
    const h = parseMonthlyRain({ properties: { parameter: { PRECTOTCORR: values } }, parameters: { PRECTOTCORR: { units: 'mm/day' } } });
    expect(h.years).toEqual([{ year: 2023, totalMm: 730 }]);
  });

  it('leaves kWh values alone and picks the last complete year', () => {
    expect(toKwhPerDay(5, 'kW-hr/m^2/day')).toBe(5);
    expect(lastCompleteYear(new Date('2026-10-18'))).toBe(2025);
    expect(lastCompleteYear(new Date('2026-02-01'))).toBe(2024);
  });
});

// ------------------------------------------------------------------ suitability

// A made-up crop for testing the arithmetic; real profiles come from ECOCROP.
const crop: CropProfile = {
  id: 'test',
  scientific: 'Testus',
  category: 'cereals',
  en: 'Test crop',
  km: null,
  known: true,
  commonNames: [],
  needs: {
    rain: { absMin: 400, optMin: 600, optMax: 1200, absMax: 1800 },
    temp: { absMin: 10, optMin: 18, optMax: 33, absMax: 45 },
    ph: { absMin: 4.5, optMin: 5.5, optMax: 7, absMax: 8.5 },
  },
  cycleDays: [100, 140],
  ecocropId: 0,
};
const annualSite = (rain: number | null, temp: number | null, ph: number | null) => ({
  monthlyRainMm: null,
  monthlyTempC: null,
  annualRainMm: rain,
  annualTempC: temp,
  ph,
});

function summaryWith(over: Partial<{ rain: number | null; temp: number | null; ph: number | null; slope: number | null; land: { code: number; fraction: number }[] }>): EnvSummary {
  const at = '2026-01-01T00:00:00.000Z';
  const v = { rain: 900, temp: 27, ph: 6, slope: 2, land: [{ code: 40, fraction: 1 }], ...over };
  return {
    version: 1,
    location: { latitude: 0, longitude: 0 },
    ring: null,
    createdAt: at,
    climate:
      v.rain === null && v.temp === null
        ? { status: 'error', source: 'nasa-power', fetchedAt: at, reason: 'offline' }
        : {
            status: 'ok',
            source: 'nasa-power',
            fetchedAt: at,
            data: {
              monthlyRainMm: [],
              annualRainMm: v.rain,
              monthlySolarKwhM2Day: [],
              annualSolarKwhM2Day: 5,
              monthlyTempC: [],
              annualTempC: v.temp,
              annualTempMaxC: null,
              annualTempMinC: null,
              period: 'test',
            },
          },
    rainHistory: { status: 'no-data', source: 'nasa-power', fetchedAt: at, reason: 'test' },
    // pH comes only from the farmer's own soil test.
    ...(v.ph === null ? {} : { soilTest: { ph: v.ph, organicMatterPct: null, waterEcDsM: null, texture: null, enteredAt: at } }),
    terrain:
      v.slope === null
        ? { status: 'error', source: 'aws-terrain', fetchedAt: at, reason: 'test' }
        : { status: 'ok', source: 'aws-terrain', fetchedAt: at, data: { elevationM: 10, slopeDeg: v.slope, cellSizeM: 19 } },
    landCover: { status: 'ok', source: 'esa-worldcover', fetchedAt: at, data: { classAtPoint: v.land[0].code, fractions: v.land, samples: 10 } },
  };
}

describe('crop suitability', () => {
  it('scores trapezoid factors', () => {
    const r = crop.needs.rain;
    expect(factorScore(900, r)).toBe(1);
    expect(factorScore(500, r)).toBeCloseTo(0.5);
    expect(factorScore(1500, r)).toBeCloseTo(0.5);
    expect(factorScore(300, r)).toBe(0);
    expect(factorScore(0, { absMin: 0, optMin: 0, optMax: 8, absMax: 20 })).toBe(1); // optMin == absMin
  });

  it('uses the limiting factor as the overall score', () => {
    const res = scoreCrop(crop, annualSite(500, 27, 6));
    expect(res.score).toBe(50);
    expect(res.limiting).toBe('rain');
    expect(res.suitability).toBe('marginal');
    expect(res.confidence).toBe('medium');
    expect(res.factors.find((f) => f.key === 'rain')?.position).toBe('low');
  });

  it('scores on rain and temperature when there is no soil pH test', () => {
    const res = scoreCrop(crop, annualSite(900, 27, null));
    expect(res.score).toBe(100);
    expect(res.limiting).toBeNull();
    // A missing pH test doesn't lower confidence; missing climate data does.
    expect(res.confidence).toBe('medium');
    expect(scoreCrop(crop, annualSite(900, null, 6)).confidence).toBe('low');
    expect(res.factors.find((f) => f.key === 'ph')?.position).toBe('missing');
    // With fewer than two factors there is no overall score at all.
    expect(scoreCrop(crop, annualSite(null, null, 6)).score).toBeNull();
  });

  it('classifies scores', () => {
    expect([classify(null), classify(0), classify(20), classify(45), classify(70), classify(90)]).toEqual([
      'unknown',
      'unsuitable',
      'low',
      'marginal',
      'moderate',
      'high',
    ]);
  });

  it('ranks crops from a saved summary, best first, unscored last', () => {
    const ranked = rankCrops(summaryWith({ rain: 1700, temp: 28, ph: 5.8, slope: 1 }));
    expect(ranked).toHaveLength(CROPS.length);
    expect(ranked.find((r) => r.cropId === 'rice')?.score).toBe(100);
    const scores = ranked.map((r) => r.score ?? -1);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const none = rankCrops(summaryWith({ rain: null, temp: null, ph: null }));
    expect(none.every((r) => r.score === null && r.suitability === 'unknown')).toBe(true);
  });

  it('warns when part of the place is built-up or water, or the land is steep', () => {
    expect(siteWarnings(summaryWith({ land: [{ code: 50, fraction: 0.3 }, { code: 40, fraction: 0.7 }] }))).toEqual([
      { key: 'mostly-built', value: 0.3 },
    ]);
    expect(siteWarnings(summaryWith({ slope: 12 }))).toEqual([{ key: 'steep', value: 12 }]);
    expect(siteWarnings(summaryWith({}))).toEqual([]);
  });

  it('only allows crop advice where land cover shows farmable land', () => {
    expect(landCheck(summaryWith({}))).toEqual({ ok: true, farmlandShare: 1 });
    expect(landCheck(summaryWith({ land: [{ code: 80, fraction: 1 }] }))).toEqual({ ok: false, reason: 'not-farmland', code: 80, farmlandShare: 0 });
    expect(landCheck(summaryWith({ land: [{ code: 50, fraction: 0.6 }, { code: 40, fraction: 0.4 }] }))).toMatchObject({ ok: false, code: 50 });
    expect(landCheck(summaryWith({ land: [{ code: 50, fraction: 0.4 }, { code: 40, fraction: 0.6 }] }))).toMatchObject({ ok: true });
    const base = summaryWith({});
    const at = base.createdAt;
    expect(landCheck({ ...base, landCover: { status: 'error', source: 'esa-worldcover', fetchedAt: at, reason: 'offline' } })).toEqual({ ok: false, reason: 'unchecked' });
    expect(landCheck({ ...base, landCover: { status: 'no-data', source: 'esa-worldcover', fetchedAt: at, reason: 'sea' } })).toEqual({ ok: false, reason: 'no-land' });
  });
});

describe('land-cover map tiles', () => {
  it('run-length encodes class rows', () => {
    expect(runLength([40, 40, 40, 10, 0, 0])).toEqual([40, 3, 10, 1, 0, 2]);
    expect(runLength([])).toEqual([]);
  });

  it('skips zooms that would read too many files', async () => {
    const get = jest.fn();
    expect(await landCoverTile(4, 12, 7, get)).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('the web proxy', () => {
  it('maps hosts without browser access to same-origin proxy paths', () => {
    expect(webUrl('https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/x.tif')).toBe('/worldcover/v200/x.tif');
    expect(webUrl('https://power.larc.nasa.gov/api')).toBe('https://power.larc.nasa.gov/api');
  });
});

// ------------------------------------------------------------------ seasons

describe('seasons', () => {
  // Synthetic monsoon-shaped averages, made up for the test (not a real place's data).
  const rain = [10, 15, 40, 80, 150, 170, 180, 200, 250, 220, 90, 25];
  const temp = [26, 27, 29, 30, 29, 28, 28, 28, 28, 27, 26, 25];
  const withMonthly = (lat: number, r: (number | null)[] = rain): EnvSummary => {
    const s = summaryWith({ ph: 6, slope: 1 });
    if (s.climate.status !== 'ok') throw new Error('fixture');
    return { ...s, location: { latitude: lat, longitude: 0 }, climate: { ...s.climate, data: { ...s.climate.data, monthlyRainMm: r, monthlyTempC: temp } } };
  };
  const climateOf = (s: EnvSummary) => (s.climate.status === 'ok' ? s.climate.data : null)!;

  it('splits the tropical year into wet and dry runs from monthly rain', () => {
    const s = withMonthly(12);
    const seasons = seasonsFor(s.location, climateOf(s));
    expect(seasons.map((x) => [x.kind, x.months])).toEqual([
      ['wet', [4, 5, 6, 7, 8, 9]],
      ['dry', [10, 11, 0, 1, 2, 3]],
    ]);
    expect(seasons[0].rainMm).toBe(1170);
    expect(seasons[1].rainMm).toBe(260);
  });

  it('handles one-season climates, bimodal rain and missing months', () => {
    const wet = withMonthly(0, new Array(12).fill(200));
    expect(seasonsFor(wet.location, climateOf(wet)).map((x) => [x.kind, x.months.length])).toEqual([['wet', 12]]);
    const twoRains = withMonthly(0, [20, 30, 150, 200, 120, 40, 20, 20, 30, 140, 160, 50]);
    expect(seasonsFor(twoRains.location, climateOf(twoRains)).map((x) => x.kind)).toEqual(['wet', 'dry', 'wet', 'dry']);
    const gap = withMonthly(0, [...rain.slice(0, 11), null]);
    expect(seasonsFor(gap.location, climateOf(gap))).toEqual([]);
  });

  it('uses the meteorological seasons outside the tropics, flipped in the south', () => {
    const north = withMonthly(45);
    expect(seasonsFor(north.location, climateOf(north)).map((x) => x.kind)).toEqual(['spring', 'summer', 'autumn', 'winter']);
    const south = withMonthly(-35);
    expect(seasonsFor(south.location, climateOf(south)).map((x) => x.kind)).toEqual(['autumn', 'winter', 'spring', 'summer']);
  });

  // Test crop needing 800–1500 mm over a four-month cycle (rain 0 below 400 mm).
  const thirsty: CropProfile = { ...crop, id: 'thirsty', needs: { ...crop.needs, rain: { absMin: 400, optMin: 800, optMax: 1500, absMax: 2500 } } };

  it('tries every sowing month over the growing cycle and keeps the best', () => {
    const summary = withMonthly(12);
    const [r] = rankCrops(summary, [thirsty]);
    expect(r.cycleMonths).toBe(4);
    // Sown in June the cycle gets 170+180+200+250 = 800 mm, the start of the preferred range.
    expect(r).toMatchObject({ score: 100, bestMonth: 5, limiting: null, irrigated: null });
    expect(r.factors.find((f) => f.key === 'rain')?.value).toBe(800);
    // April: 80+150+170+180 = 580 mm, (580-400)/(800-400) = 45.
    expect(r.months[3]).toMatchObject({ score: 45, rainMm: 580, limiting: 'rain', rainShort: true });
    expect(r.months[0]?.score).toBe(0);
  });

  it('finds the best sowing month per season and when irrigation would help', () => {
    const summary = withMonthly(12);
    const result = seasonalAssessment(summary, rankCrops(summary, [thirsty]));
    const wet = result.find((x) => x.season.kind === 'wet')!.crops[0];
    const dry = result.find((x) => x.season.kind === 'dry')!.crops[0];
    expect(wet.rainfed).toMatchObject({ month: 5, score: 100 });
    expect(wet.irrigated).toBeNull();
    // In the dry season the best rain-only start is April (45); with irrigation November reaches 100.
    expect(dry.rainfed).toMatchObject({ month: 3, score: 45 });
    expect(dry.irrigated).toMatchObject({ month: 10, score: 100 });
    expect(dry.suitability).toBe('marginal');
  });

  it('judges long-lived crops on the whole year', () => {
    const summary = withMonthly(12);
    const [r] = rankCrops(summary, [{ ...thirsty, cycleDays: null }]);
    expect(r.cycleMonths).toBe(12);
    expect(r.bestMonth).toBeNull();
    expect(r.factors.find((f) => f.key === 'rain')?.value).toBe(1430);
    expect(seasonalAssessment(summary, [r])[0].crops[0].yearRound).toBe(true);
  });

  it('suggests what to sow this month or next, best suited first, then by value', () => {
    const summary = withMonthly(12);
    const early = { ...thirsty, id: 'early', needs: { ...thirsty.needs, rain: { absMin: 100, optMin: 300, optMax: 1500, absMax: 2500 } } };
    const results = rankCrops(summary, [thirsty, early]);
    const seasons = seasonsFor(summary.location, climateOf(summary));
    // May is in the wet season (May–October).
    expect(seasonOf(seasons, 4)?.kind).toBe('wet');
    expect(seasonOf(seasons, 0)?.kind).toBe('dry');
    // May or June: thirsty is best sown in June (100); early scores 100 in May already.
    const may = plantNow(results, 4, (id) => (id === 'early' ? 1000 : 500));
    expect(may.map((c) => [c.cropId, c.option.month, c.option.score, c.irrigated])).toEqual([
      ['early', 4, 100, false],
      ['thirsty', 5, 100, false],
    ]);
    // Equal scores: the higher value comes first.
    expect(plantNow(results, 4, (id) => (id === 'early' ? 1 : 2))[0].cropId).toBe('thirsty');
    // January (dry): rain alone fails for thirsty; irrigation brings it up and it is flagged.
    const jan = plantNow(results, 0).find((c) => c.cropId === 'thirsty')!;
    expect(jan.irrigated).toBe(true);
    expect(jan.bestMonth).toBe(5);
    // Rain-fed crops sort before ones that need irrigation.
    expect(plantNow(results, 0).map((c) => c.irrigated)).toEqual([...plantNow(results, 0).map((c) => c.irrigated)].sort());
    // Below the threshold nothing is suggested.
    expect(plantNow(results, 0, undefined, 101)).toEqual([]);
  });

  it('suggests nothing without monthly climate data', () => {
    expect(plantNow(rankCrops(summaryWith({ ph: 6 }), [thirsty]), 4)).toEqual([]);
  });

  it('returns nothing without climate data', () => {
    expect(seasonalAssessment(summaryWith({ rain: null, temp: null }), [])).toEqual([]);
  });
});

describe('crop catalogue', () => {
  it('holds the ECOCROP food crops with their database ranges', () => {
    expect(CROPS.length).toBeGreaterThan(700);
    const rice = cropById('rice')!;
    expect(rice.scientific).toBe('Oryza sativa');
    expect(rice.needs.rain).toEqual({ absMin: 1000, optMin: 1500, optMax: 2000, absMax: 4000 });
    expect(cycleMonths(rice)).toBe(4); // 80–180 days
    for (const c of CROPS) {
      for (const r of Object.values(c.needs)) expect(r.absMin <= r.optMin && r.optMin <= r.optMax && r.optMax <= r.absMax).toBe(true);
    }
    expect(new Set(CROPS.map((c) => c.id)).size).toBe(CROPS.length);
  });

  it('finds crops by English, Khmer, scientific and local names', () => {
    expect(searchCrops('okra')[0].crop.id).toBe('okra');
    expect(searchCrops('ស្វាយ')[0].crop.id).toBe('mango');
    expect(searchCrops('oryza')[0].crop.id).toBe('rice');
    const bhindi = searchCrops('bhindi')[0];
    expect(bhindi.crop.id).toBe('okra');
    expect(bhindi.matched?.toLowerCase()).toBe('bhindi');
    expect(searchCrops('  ')).toEqual([]);
    expect(searchCrops('zzzz')).toEqual([]);
  });
});

// ------------------------------------------------------------------ BigTIFF, LZW, floats

describe('GeoTIFF reader: BigTIFF, LZW and 32-bit floats', () => {
  // Written by GDAL (rasterio): 32×32 float32, 16×16 LZW tiles, BigTIFF, value = index × 0.25 + 1.5, nodata 0 at (0,0).
  const bytes = Buffer.from(readFileSync(join(__dirname, 'fixtures/float-lzw-bigtiff.b64'), 'utf8'), 'base64');
  const get: FetchRange = async (_url, start, end) => {
    const b = bytes.subarray(start, Math.min(end + 1, bytes.length));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };

  it('reads pixels across tiles exactly', async () => {
    clearTileCache();
    const cog = await openCog('fixture://float', get);
    expect(cog).toMatchObject({ width: 32, height: 32, tileWidth: 16, bitsPerSample: 32, float: true, compression: 5, noData: 0 });
    expect(cog.origin).toEqual([100, 20]);
    expect(await readPixel(cog, 20, 5, get)).toBe(46.5);
    expect(await readPixel(cog, 31, 31, get)).toBe(257.25);
    expect(await readPixel(cog, 3, 17, get)).toBe(138.25);
    expect(await readPixel(cog, 0, 0, get)).toBeNull();
    expect(pixelFor(cog, 110.2, 17.4)).toEqual([20, 5]);
  });

  it('decodes LZW with the code table reset and the "code not yet defined" case', () => {
    // "ABABABA" is the classic case where a code is used in the step that defines it.
    // Codes (9-bit, MSB first): CLEAR, 65, 66, 258, 260, EOI.
    const codes = [256, 65, 66, 258, 260, 257];
    let bits = '';
    for (const c of codes) bits += c.toString(2).padStart(9, '0');
    while (bits.length % 8) bits += '0';
    const input = Uint8Array.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
    expect(Buffer.from(lzwDecode(input)).toString('latin1')).toBe('ABABABA');
  });
});

// ------------------------------------------------------------------ GAEZ crops and values

describe('FAO GAEZ production tables', () => {
  it('has country totals matching FAOSTAT-scale figures for Cambodia', () => {
    const kh = countryProduction('KHM')!;
    // Rice is Cambodia's biggest crop by far: about 3.3 million ha and 11 million t (FAOSTAT 2019–2021).
    expect(kh.crops[0].code).toBe('RCW');
    expect(kh.crops[0].areaHa).toBeGreaterThan(3.0e6);
    expect(kh.crops[0].areaHa).toBeLessThan(3.6e6);
    expect(kh.crops[0].yieldT).toBeGreaterThan(3);
    expect(kh.crops[0].yieldT).toBeLessThan(4);
    // Value = yield × GAEZ price for rice (391.07 I$/t).
    expect(kh.crops[0].valuePerHa).toBeCloseTo(kh.crops[0].yieldT * 391.07, 6);
    expect(countryProduction('XXX')).toBeNull();
  });

  it('answers Cambodian places from the bundled grid, with no download', () => {
    // Battambang: cross-checked with GDAL on FAO's files, the rice cell holds 3,438 ha at 3.60 t/ha.
    const b = bundledLocalProduction({ latitude: 13.1, longitude: 103.2 })!;
    const rice = b.crops.find((c) => c.code === 'RCW')!;
    expect(rice.harvestedHa).toBeGreaterThan(3400);
    expect(rice.harvestedHa).toBeLessThan(3480);
    expect(rice.yieldT).toBeCloseTo(3.6, 1);
    expect(b.crops[0].share).toBeGreaterThanOrEqual(b.crops[1].share);
    // Outside the bundled cells (Bangkok) the app reads FAO's files instead.
    expect(bundledLocalProduction({ latitude: 13.75, longitude: 100.5 })).toBeUndefined();
  });

  it('reads FAO files in one round, not one round per step', async () => {
    // Every read waits until all reads of the current round have started, so a read that
    // depended on an earlier answer would show up as a second round.
    let round = 0;
    const rounds: number[] = [];
    let pending: (() => void)[] = [];
    const get: FetchRange = (url) => {
      rounds.push(round);
      return new Promise((_, reject) => {
        pending.push(() => reject(new RasterNotFoundError(url)));
        if (pending.length === 1)
          setTimeout(() => {
            round++;
            const now = pending;
            pending = [];
            now.forEach((f) => f());
          }, 0);
      });
    };
    await expect(fetchLocalProduction({ latitude: 13.75, longitude: 100.5 }, 'THA', get)).rejects.toThrow();
    // Total, ten crop areas and five likely yields all start in the first round.
    expect(rounds.filter((r) => r === 0)).toHaveLength(16);
  });

  it('links catalogue crops to GAEZ crops or groups', () => {
    expect(gaezCodeFor(cropById('rice')!)).toBe('RCW');
    expect(gaezCodeFor(cropById('mango')!)).toBe('FRT');
    expect(gaezCodeFor(cropById('mungbean')!)).toBe('PLS');
    expect(gaezCodeFor(cropById('okra')!)).toBe('OVG');
  });

  it('computes the area of a 5 arc-minute cell', () => {
    expect(cellAreaHa(0)).toBeCloseTo(8587, -1); // 9.27 km × 9.27 km at the equator
    expect(cellAreaHa(60)).toBeCloseTo(cellAreaHa(0) / 2, 0);
  });

  it('finds the country of a point from the bundled outline', () => {
    expect(countryAt({ latitude: 12.5, longitude: 104.5 })).toBe('KHM');
    expect(countryAt({ latitude: 15.0, longitude: 100.5 })).toBe('THA');
    expect(countryAt({ latitude: 0, longitude: -30 })).toBeNull(); // Atlantic
  });
});

// ------------------------------------------------------------------ zones

describe('land zones', () => {
  it('classes a zone by its land cover and slope', () => {
    expect(zoneKind([{ code: 40, fraction: 1 }], 1)).toBe('cropland');
    expect(zoneKind([{ code: 80, fraction: 0.6 }, { code: 40, fraction: 0.4 }], 0)).toBe('water');
    expect(zoneKind([{ code: 10, fraction: 0.7 }, { code: 40, fraction: 0.3 }], 2)).toBe('tree');
    expect(zoneKind([{ code: 40, fraction: 1 }], 12)).toBe('steep');
    expect(zoneKind([{ code: 30, fraction: 1 }], 2)).toBe('open');
    expect(zoneKind([], 2)).toBe('no-data');
  });

  it('summarises zones by share of the land', () => {
    const z = (kind: 'cropland' | 'water', coverage = 1) => ({ row: 0, col: 0, centre: { latitude: 0, longitude: 0 }, coverage, landCover: [], elevationM: null, slopeDeg: null, kind });
    const summary = zoneSummary({ bbox: [0, 0, 1, 1], rows: 2, cols: 2, cellWidthM: 50, cellHeightM: 50, area: 'square', zones: [z('cropland'), z('cropland'), z('cropland'), z('water')] });
    expect(summary).toEqual([
      { kind: 'cropland', count: 3, share: 0.75 },
      { kind: 'water', count: 1, share: 0.25 },
    ]);
  });
  it('clips grid cells to the parcel and finds the one tapped', () => {
    const square = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 2 },
      { latitude: 2, longitude: 2 },
      { latitude: 2, longitude: 0 },
    ];
    // A triangle over the bottom-left half of the square.
    const tri = [square[0], square[1], square[3]];
    const clipped = clipToRect(tri, [1, 0, 2, 1]);
    expect(clipped).toHaveLength(3);
    expect(clipped).toEqual(expect.arrayContaining([{ latitude: 0, longitude: 1 }, { latitude: 0, longitude: 2 }, { latitude: 1, longitude: 1 }]));
    expect(clipToRect(tri, [1.5, 1.5, 2, 2])).toEqual([]);

    const z = (row: number, col: number) => ({ row, col, centre: { latitude: 0, longitude: 0 }, coverage: 1, landCover: [], elevationM: null, slopeDeg: null, kind: 'cropland' as const });
    const data = { bbox: [0, 0, 2, 2] as [number, number, number, number], rows: 2, cols: 2, cellWidthM: 1, cellHeightM: 1, area: 'parcel' as const, zones: [z(0, 0), z(0, 1), z(1, 0), z(1, 1)] };
    const cells = zoneCells(data, tri);
    // Row 0 is the north row: its right cell lies outside the triangle.
    expect(cells.map((c) => c.length)).toEqual([3, 0, 4, 3]);
    expect(zoneAt(cells, { latitude: 0.5, longitude: 0.5 })).toBe(2);
    expect(zoneAt(cells, { latitude: 1.6, longitude: 1.6 })).toBeNull();
    // Without a parcel every cell is the full rectangle.
    expect(zoneCells(data, null).every((c) => c.length === 4)).toBe(true);
  });
});

// ------------------------------------------------------------------ orchestration

describe('analyzeLocation', () => {
  const now = () => new Date('2026-10-18T00:00:00Z');

  it('keeps each source independent and records failures instead of guessing', async () => {
    const fetchJson: FetchJson = async (url) => {
      if (url.includes('/climatology/')) return powerClimatology;
      if (url.includes('/monthly/')) throw new Error('HTTP 503');
      throw new Error(`unexpected ${url}`);
    };
    const fetchRange: FetchRange = async () => {
      throw new Error('offline');
    };
    const seen: string[] = [];
    const s = await analyzeLocation({ latitude: 11.5, longitude: 104.9 }, null, { fetchJson, fetchRange, now, onSection: (k) => seen.push(k) });
    expect(s.climate.status).toBe('ok');
    expect(s.rainHistory).toMatchObject({ status: 'error', reason: 'HTTP 503' });
    // Soil is not predicted: only the farmer's own test is used.
    expect('soil' in s).toBe(false);
    expect(s.terrain).toMatchObject({ status: 'error', reason: 'offline' });
    expect(s.landCover).toMatchObject({ status: 'error', reason: 'offline' });
    expect(s.createdAt).toBe('2026-10-18T00:00:00.000Z');
    // Crops grown nearby are bundled for Cambodia too.
    expect(s.production).toMatchObject({ status: 'ok', source: 'gaez' });
    expect(s.zones).toMatchObject({ status: 'error', reason: 'offline' });
    expect(seen.sort()).toEqual(['climate', 'landCover', 'production', 'rainHistory', 'terrain', 'zones']);
  });

  it('requests the last ten complete years of rainfall', async () => {
    const urls: string[] = [];
    await analyzeLocation({ latitude: 1, longitude: 2 }, null, {
      fetchJson: async (u) => {
        urls.push(u);
        throw new Error('x');
      },
      fetchRange: async () => {
        throw new Error('x');
      },
      now,
    });
    const monthlyUrl = new URL(urls.find((u) => u.includes('/monthly/'))!);
    expect([monthlyUrl.searchParams.get('start'), monthlyUrl.searchParams.get('end')]).toEqual(['2016', '2025']);
  });
});
