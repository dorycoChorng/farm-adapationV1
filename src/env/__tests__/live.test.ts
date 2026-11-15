/**
 * @jest-environment node
 */
/**
 * Reads real rasters over the network. Skipped unless LIVE_DATA=1, because CI and
 * offline machines cannot reach the hosts:  LIVE_DATA=1 npx jest src/env/__tests__/live
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bundledLocalProduction, fetchLocalProduction } from '../gaez';
import { landCoverTile, readLandCover, readTerrain, runLength } from '../rasters';
import { LAND_COVER_CLASSES } from '../sources';
import { type FetchRange, RasterNotFoundError } from '../tiff';
import { readZones, zoneSummary } from '../zones';

// jest-expo replaces global fetch with a mock, so range requests go through curl here.
const dir = mkdtempSync(join(tmpdir(), 'live-'));
const curlRange: FetchRange = async (url, start, end) => {
  const out = join(dir, 'part');
  const status = execFileSync('curl', ['-sS', '-r', `${start}-${end}`, '-o', out, '-w', '%{http_code}', url]).toString();
  if (status === '404' || status === '403') throw new RasterNotFoundError(url);
  if (status !== '206' && status !== '200') throw new Error(`HTTP ${status}`);
  const b = readFileSync(out);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

const live = process.env.LIVE_DATA === '1' ? describe : describe.skip;
// A point in Phnom Penh and a small rectangle of farmland south of it. These are test
// inputs; the assertions only check that real values come back in plausible ranges.
const phnomPenh = { latitude: 11.5564, longitude: 104.9282 };

live('live rasters', () => {
  jest.setTimeout(60000);

  it('reads ESA WorldCover at a point and over a parcel', async () => {
    const point = await readLandCover(phnomPenh, null, curlRange);
    expect(point).not.toBeNull();
    expect(Object.keys(LAND_COVER_CLASSES).map(Number)).toContain(point!.classAtPoint);

    const ring = [
      { latitude: 11.3, longitude: 104.8 },
      { latitude: 11.3, longitude: 104.803 },
      { latitude: 11.303, longitude: 104.803 },
      { latitude: 11.303, longitude: 104.8 },
    ];
    const parcel = await readLandCover(ring[0], ring, curlRange);
    expect(parcel!.samples).toBeGreaterThan(50);
    expect(parcel!.fractions.reduce((a, f) => a + f.fraction, 0)).toBeCloseTo(1, 2);
    console.log('live land cover', JSON.stringify({ point: point!.classAtPoint, parcel: parcel!.fractions }));
  });

  it('renders land-cover map tiles from the full image and its overviews', async () => {
    const z = 14;
    const n = 2 ** z;
    const x = Math.floor(((phnomPenh.longitude + 180) / 360) * n);
    const latRad = (phnomPenh.latitude * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
    const tile = await landCoverTile(z, x, y, curlRange);
    expect(tile).not.toBeNull();
    const codes = new Set(tile!);
    for (const c of codes) expect([0, ...Object.keys(LAND_COVER_CLASSES).map(Number)]).toContain(c);
    const built = tile!.filter((v) => v === 50).length / tile!.length;
    expect(built).toBeGreaterThan(0.5); // central Phnom Penh

    // The tile's middle pixel matches a direct point read at the same spot.
    const lon = ((x + 128.5 / 256) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 128.5 / 256)) / n))) * 180) / Math.PI;
    const point = await readLandCover({ latitude: lat, longitude: lon }, null, curlRange);
    expect(tile![128 * 256 + 128]).toBe(point!.classAtPoint);

    // Zoomed out, the overview images are used; still real classes, and it compresses well.
    const coarse = await landCoverTile(9, Math.floor(x / 32), Math.floor(y / 32), curlRange);
    expect(coarse).not.toBeNull();
    expect(runLength(coarse!).length).toBeLessThan(coarse!.length);
    console.log('live land-cover tile', JSON.stringify({ built, codes: [...codes] }));
  });

  it('returns no land cover for open ocean (no WorldCover file)', async () => {
    expect(await landCoverTile(9, 100, 300, curlRange)).toBeNull();
    expect(await readLandCover({ latitude: -30, longitude: -120 }, null, curlRange)).toBeNull();
  });

  it('reads elevation and slope from AWS terrain tiles', async () => {
    const t = await readTerrain(phnomPenh, curlRange);
    expect(t).not.toBeNull();
    expect(t!.elevationM).toBeGreaterThan(-20);
    expect(t!.elevationM).toBeLessThan(100);
    expect(t!.slopeDeg).not.toBeNull();
    const everest = await readTerrain({ latitude: 27.9881, longitude: 86.925 }, curlRange);
    expect(everest!.elevationM).toBeGreaterThan(8000);
    console.log('live terrain', JSON.stringify({ phnomPenh: t, everest }));
  });

  it('reads crops grown around Battambang from FAO GAEZ v5', async () => {
    // Cross-checked with GDAL: the rice cell at 13.1 N, 103.2 E holds 3,438 ha at 3.60 t/ha.
    const at = { latitude: 13.1, longitude: 103.2 };
    let requests = 0;
    const counted: FetchRange = (url, s, e) => {
      requests++;
      return curlRange(url, s, e);
    };
    const local = await fetchLocalProduction(at, 'KHM', counted);
    // One header and one tile per file: total, ten areas, and yields for the five main crops.
    expect(requests).toBe(2 * (1 + 10 + 5));
    // The bundled Cambodian copy gives the same numbers without any download.
    const bundled = bundledLocalProduction(at)!;
    expect(bundled.harvestedHa).toBe(local!.harvestedHa);
    for (const c of local!.crops) {
      const b = bundled.crops.find((x) => x.code === c.code)!;
      expect(Math.abs(b.harvestedHa - c.harvestedHa)).toBeLessThanOrEqual(1);
      if (c.yieldT !== null) expect(b.yieldT).toBeCloseTo(c.yieldT, 1);
    }
    expect(local).not.toBeNull();
    const rice = local!.crops.find((c) => c.code === 'RCW')!;
    expect(rice.harvestedHa).toBeGreaterThan(3400);
    expect(rice.harvestedHa).toBeLessThan(3480);
    expect(rice.yieldT).toBeCloseTo(3.6, 1);
    expect(Math.abs(rice.valuePerHa! - rice.yieldT! * 391.07)).toBeLessThan(5);
    console.log('live GAEZ', JSON.stringify(local));
  });

  it('splits farmland into zones from WorldCover and terrain', async () => {
    const ring = [
      { latitude: 11.3, longitude: 104.8 },
      { latitude: 11.3, longitude: 104.803 },
      { latitude: 11.303, longitude: 104.803 },
      { latitude: 11.303, longitude: 104.8 },
    ];
    const zones = await readZones(ring[0], ring, curlRange);
    expect(zones!.rows * zones!.cols).toBeGreaterThan(4);
    expect(zones!.zones.every((z) => z.landCover.length > 0 && z.elevationM !== null)).toBe(true);
    console.log('live zones', JSON.stringify(zoneSummary(zones!)));
  });
});
