// End-to-end checks of the app's screens using the web build in headless Chromium.
// The web build shares all screen, storage, geometry and map code with Android;
// only the WebView is swapped for an iframe. Run `npx expo export --platform web` first
// (or `npm run test:web`, which does both).
//
// GPS positions below are synthetic test inputs given to the browser, not real locations.
import assert from 'node:assert/strict';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

import geographiclib from 'geographiclib-geodesic';
import { chromium } from 'playwright-core';

const { Geodesic } = geographiclib;

const DIST = resolve(process.env.APP_WEB_DIR || 'dist');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
};

const PROXIES = {
  '/worldcover/': 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/',
  '/gaez/': 'https://storage.googleapis.com/fao-gismgr-gaez-v5-data/',
};

let server;
let baseUrl;
let browser;

before(async () => {
  assert.ok(existsSync(join(DIST, 'index.html')), `web build not found in ${DIST}`);
  server = createServer(async (req, res) => {
    // Same proxies as vercel.json, so land cover and crop statistics are read from the real files.
    const proxied = Object.entries(PROXIES).find(([p]) => req.url.startsWith(p));
    if (proxied) {
      try {
        const up = await fetch(proxied[1] + req.url.slice(proxied[0].length), {
          headers: req.headers.range ? { Range: req.headers.range } : {},
        });
        res.writeHead(up.status, { 'content-type': 'application/octet-stream', ...(up.headers.get('content-range') ? { 'content-range': up.headers.get('content-range') } : {}) });
        res.end(Buffer.from(await up.arrayBuffer()));
      } catch {
        res.writeHead(502);
        res.end();
      }
      return;
    }
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(DIST, path);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'credentialless',
    });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function openApp({ geolocation, permissions = [] } = {}) {
  const context = await browser.newContext({
    viewport: { width: 420, height: 860 },
    geolocation,
    permissions,
    locale: 'en-US',
  });
  // Imagery servers are not reachable from the test machine; fail them fast.
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort('internetdisconnected'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baseUrl);
  const { frame: map } = await mapFrame(page);
  // External tiles are blocked in tests, so the imagery warning appears; wait for it so the layout is stable.
  await page.getByText(/Some map imagery could not load/).waitFor({ timeout: 30000 });
  return { context, page, map, errors };
}

/** The most recently mounted map (screens stack, so earlier maps stay in the DOM). */
async function mapFrame(page, count = 1) {
  await page.waitForFunction((n) => document.querySelectorAll('iframe[title="map"]').length >= n, count, {
    timeout: 30000,
  });
  const handles = await page.$$('iframe[title="map"]');
  const handle = handles[handles.length - 1];
  const frame = await handle.contentFrame();
  await frame.waitForFunction(() => window.__farmMapLoaded === true, null, { timeout: 30000 });
  return { frame, handle };
}

async function settle(frame) {
  await frame.evaluate(
    () =>
      new Promise((resolve) => {
        const m = window.__map;
        const done = () => (m.isMoving() ? m.once('moveend', done) : resolve());
        setTimeout(done, 200);
      }),
  );
}

async function clickMap(page, frame, lngLat) {
  const xy = await frame.evaluate((ll) => window.__map.project(ll), lngLat);
  const box = await (await frame.frameElement()).boundingBox();
  await page.mouse.click(box.x + xy.x, box.y + xy.y);
}

const button = (page, name) => page.getByRole('button', { name, exact: true });

// Optional screenshots for reviewing the UI: SHOTS_DIR=/some/dir npm run test:web
const shot = (page, name) => (process.env.SHOTS_DIR ? page.screenshot({ path: join(process.env.SHOTS_DIR, `${name}.png`), fullPage: false }) : null);


describe('globe screen', () => {
  it('selects a tapped location and shows its coordinates', async () => {
    const { page, map, context, errors } = await openApp();
    await page.getByText('Tap the map to select a location.').waitFor();
    // Wait for the opening camera move to finish, or the point moves under the tap.
    await map.evaluate(() => new Promise((done) => (window.__map.isMoving() ? window.__map.once('idle', done) : done())));
    const target = await map.evaluate(() => window.__map.unproject([210, 200]).toArray());
    await clickMap(page, map, target);
    await page.getByText('Selected location').waitFor();
    const lat = target[1];
    const latText = `${Math.abs(lat).toFixed(6)}° ${lat >= 0 ? 'N' : 'S'}`;
    await page.getByText(latText).waitFor();
    assert.equal(await map.evaluate(() => document.querySelectorAll('.maplibregl-marker').length), 1);
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('flies to Cambodia from the shortcut', async () => {
    const { page, map, context } = await openApp();
    // The shortcut sits in the lower part of the bottom panel; pull the panel up first, as a user would.
    await page.getByTestId('sheet-handle').click();
    await page.waitForTimeout(600);
    await button(page, 'Go to Cambodia').click();
    await page.getByTestId('sheet-handle').click();
    await page.getByTestId('place-title').getByText('Cambodia', { exact: true }).waitFor();
    await map.waitForTimeout(2500);
    await settle(map);
    await shot(page, 'globe-cambodia');
    const c = await map.evaluate(() => window.__map.getCenter().toArray());
    assert.ok(c[0] > 102.3 && c[0] < 107.7 && c[1] > 10.4 && c[1] < 14.6, `centre ${c}`);
    await context.close();
  });

  it('shows the real ESA land-cover map when the overlay is on', async () => {
    const { page, map, context, errors } = await openApp();
    await page.getByTestId('open-layers').click();
    await page.getByTestId('overlay-landcover').click();
    await page.getByText('Built-up', { exact: true }).waitFor(); // legend
    await shot(page, 'layers-landcover');
    await button(page, 'Close').last().click();
    await page.getByTestId('landcover-zoom-hint').waitFor();
    // Central Phnom Penh, where ESA's map is mostly built-up (red).
    await map.evaluate(() => window.farmMap.receive({ type: 'flyTo', center: [104.9282, 11.5564], zoom: 13, duration: 0 }));
    await page.getByTestId('landcover-zoom-hint').waitFor({ state: 'detached' });
    // Tiles arrive after the app has read ESA's files, so poll the rendered pixel.
    const readPixel = () =>
      map.evaluate(
        () =>
          new Promise((resolve) => {
            const m = window.__map;
            m.once('render', () => {
              const c = m.getCanvas();
              const copy = document.createElement('canvas');
              copy.width = c.width;
              copy.height = c.height;
              const ctx = copy.getContext('2d');
              ctx.drawImage(c, 0, 0);
              const p = m.project([104.9282, 11.5564]);
              const r = window.devicePixelRatio || 1;
              resolve(Array.from(ctx.getImageData(Math.round(p.x * r), Math.round(p.y * r), 1, 1).data));
            });
            m.triggerRepaint();
          }),
      );
    const isRed = (p) => p[0] > 150 && p[1] < 120 && p[2] < 120;
    let pixel = await readPixel();
    for (let i = 0; i < 120 && !isRed(pixel); i++) {
      await page.waitForTimeout(500);
      pixel = await readPixel();
    }
    assert.ok(isRed(pixel), `expected built-up red, got ${pixel}`);
    await shot(page, 'map-landcover');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('switches the interface to Khmer and back', async () => {
    const { page, context } = await openApp();
    await button(page, 'Language').first().click();
    await page.getByTestId('go-cambodia').getByText('កម្ពុជា', { exact: true }).waitFor();
    await button(page, 'ភាសា').first().click();
    await page.getByTestId('go-cambodia').getByText('Cambodia', { exact: true }).waitFor();
    await page.getByTestId('measure-land').getByText('Measure land').waitFor();
    await context.close();
  });
});

describe('my location', () => {
  it('explains first, then shows the position and accuracy after permission', async () => {
    const fake = { latitude: -1.2345, longitude: 36.789, accuracy: 8 };
    const { page, map, context } = await openApp({ geolocation: fake, permissions: ['geolocation'] });
    await button(page, 'My Location').click();
    await page.getByText('Why the app asks for your location').waitFor();
    // Nothing is requested until the user continues.
    await button(page, 'Continue').click();
    await page.getByText('1.234500° S').waitFor();
    await page.getByText('36.789000° E').waitFor();
    await page.getByText('± 8 m (reported by the device)').waitFor();
    await button(page, 'Show on map').click();
    await settle(map);
    await map.waitForTimeout(3500);
    await settle(map);
    const state = await map.evaluate(() => ({
      c: window.__map.getCenter().toArray(),
      dots: document.querySelectorAll('.user-dot').length,
    }));
    assert.equal(state.dots, 1);
    assert.ok(Math.abs(state.c[0] - 36.789) < 0.01 && Math.abs(state.c[1] + 1.2345) < 0.01, `centre ${state.c}`);
    await context.close();
  });

  it('warns when the reported accuracy is low', async () => {
    const { page, context } = await openApp({
      geolocation: { latitude: 10, longitude: 10, accuracy: 120 },
      permissions: ['geolocation'],
    });
    await button(page, 'My Location').click();
    await button(page, 'Continue').click();
    await page.getByText(/Accuracy is low/).waitFor();
    await context.close();
  });

  it('handles a denied permission without crashing', async () => {
    const { page, context } = await openApp();
    await button(page, 'My Location').click();
    await button(page, 'Continue').click();
    await page.getByText(/Location permission (was not granted|is turned off)/).waitFor({ timeout: 30000 });
    await button(page, 'Try again').first().waitFor();
    await context.close();
  });
});

describe('search', () => {
  it('finds countries offline and explains that wider search needs internet', async () => {
    const { page, context } = await openApp();
    await page.getByTestId('globe-search').click();
    await page.getByTestId('search-input').waitFor();
    await context.setOffline(true);
    await page.getByText(/You are offline/).filter({ visible: true }).first().waitFor();
    await page.getByTestId('search-input').fill('camb');
    await button(page, 'Search').click();
    await page.getByText('Country (offline list)', { exact: false }).first().waitFor();
    await page.getByText('Searching provinces, districts', { exact: false }).waitFor();
    await page.getByRole('button', { name: /Cambodia/ }).last().click();
    await page.getByTestId('place-title').getByText('Cambodia', { exact: true }).waitFor();
    await context.close();
  });

  it('accepts typed coordinates', async () => {
    const { page, context } = await openApp();
    await page.getByTestId('globe-search').click();
    await page.getByTestId('search-input').waitFor();
    await context.setOffline(true);
    await page.getByTestId('search-input').fill('45.5, -73.6');
    await button(page, 'Search').click();
    await page.getByText('Coordinates you typed', { exact: false }).first().click();
    await page.getByText('45.500000° N').waitFor();
    await context.close();
  });
});

describe('draw, measure and save a parcel', () => {
  it('measures a drawn boundary, saves it to SQLite and keeps it after reload', async () => {
    const { page, map, context } = await openApp();
    // Pick a start point on the globe, then open the measuring screen.
    await clickMap(page, map, [0.0005, 0.0005]);
    await button(page, 'Measure farmland here').click();
    const { frame: draw } = await mapFrame(page, 2);
    await draw.waitForFunction(() => window.__map.getZoom() > 16);
    // A ~100 m square around wherever the drawing map opened.
    const [cx, cy] = await draw.evaluate(() => window.__map.getCenter().toArray());
    const ring = [
      [cx - 0.0005, cy - 0.0005],
      [cx + 0.0005, cy - 0.0005],
      [cx + 0.0005, cy + 0.0005],
      [cx - 0.0005, cy + 0.0005],
    ];
    for (const p of ring) await clickMap(page, draw, p);
    await page.getByText('Points', { exact: true }).waitFor();
    await button(page, 'Close shape').click();

    // Read back the exact vertices the map placed and compute the expected area independently.
    const placed = await draw.evaluate(async () =>
      (await window.__map.getSource('ring').getData()).features
        .filter((f) => f.geometry.type === 'Point')
        .map((f) => f.geometry.coordinates),
    );
    assert.equal(placed.length, 4);
    const poly = Geodesic.WGS84.Polygon(false);
    for (const [lng, lat] of placed) poly.AddPoint(lat, lng);
    const expectedM2 = Math.abs(poly.Compute(false, true).area);
    const expectedText = `${Math.round(expectedM2).toLocaleString('en-US')} m²`;
    await page.getByText(expectedText, { exact: false }).waitFor();
    await page.getByText(/not an official cadastral survey/).waitFor();
    await shot(page, 'draw-measure');
    // Edge labels on the map.
    assert.equal(await draw.evaluate(() => document.querySelectorAll('.seg-label').length), 4);
    // Land zones are checked for the closed boundary. This test point is open sea, so the
    // honest answer is that there is no land-cover data inside it.
    await page.getByTestId('parcel-zones').getByText(/No land-cover data inside this boundary|Zones need internet/).waitFor({ timeout: 60000 });

    await page.getByTestId('parcel-save').click();
    const nameBox = page.getByLabel('Name');
    await nameBox.fill('Test plot');
    await button(page, 'Save').last().click();
    await page.getByText('Parcel saved on this device.').waitFor();

    await page.goto(`${baseUrl}/saved`);
    await page.getByText('Test plot').waitFor({ timeout: 30000 });
    await page.getByText(`${(expectedM2 / 10_000).toFixed(3)} ha`).waitFor();

    // Edit the saved boundary: drag one corner inwards and save again.
    const mapsBefore = await page.locator('iframe[title="map"]').count();
    await button(page, 'Edit boundary').click();
    const { frame: edit } = await mapFrame(page, mapsBefore + 1);
    await edit.waitForFunction(
      () =>
        window.__map.queryRenderedFeatures({ layers: ['ring-vertices'] }).length === 4 && !window.__map.isMoving(),
    );
    // The screen fits the map to the stored boundary; let that animation finish.
    await page.waitForTimeout(2500);
    await settle(edit);
    // The map is fitted to the parcel, so move the top-left corner 80 px towards the centre.
    const from = await edit.evaluate((ll) => window.__map.project(ll), placed[3]);
    const to = { x: from.x + 80, y: from.y + 80 };
    const box = await (await edit.frameElement()).boundingBox();
    await page.mouse.move(box.x + from.x, box.y + from.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(box.x + from.x + ((to.x - from.x) * i) / 10, box.y + from.y + ((to.y - from.y) * i) / 10);
    }
    await page.mouse.up();
    const edited = await edit.evaluate(async () =>
      (await window.__map.getSource('ring').getData()).features
        .filter((f) => f.geometry.type === 'Point')
        .map((f) => f.geometry.coordinates),
    );
    const poly2 = Geodesic.WGS84.Polygon(false);
    for (const [lng, lat] of edited) poly2.AddPoint(lat, lng);
    const editedM2 = Math.abs(poly2.Compute(false, true).area);
    assert.ok(editedM2 < expectedM2 * 0.95, `area shrank: ${expectedM2} -> ${editedM2}`);
    await page.getByText(`${Math.round(editedM2).toLocaleString('en-US')} m²`, { exact: false }).waitFor();
    await page.getByTestId('parcel-save').click();
    await button(page, 'Save').last().click();
    await page.getByText('Parcel saved on this device.').waitFor();
    await page.goto(`${baseUrl}/saved`);
    await page.getByText(`${(editedM2 / 10_000).toFixed(3)} ha`).waitFor({ timeout: 30000 });
    assert.equal(await page.getByText('Test plot').count(), 1, 'edited in place, not duplicated');
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Environmental analysis. The open-data services are not reachable from the test
// machine, so their responses are replaced with SYNTHETIC fixtures shaped like the
// documented APIs. The numbers are made up for the test and are never real readings.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const synthRainMmPerDay = [1, 1, 2, 3, 6, 7, 7, 8, 9, 8, 4, 1];
const monthly = (values) => Object.fromEntries(MONTHS.map((m, i) => [m, values[i]]));
const climatologyFixture = {
  properties: {
    parameter: {
      PRECTOTCORR: monthly(synthRainMmPerDay),
      ALLSKY_SFC_SW_DWN: { ...monthly(new Array(12).fill(5)), ANN: 5 },
      T2M: { ...monthly(new Array(12).fill(27)), ANN: 27 },
      T2M_MAX: { ANN: 32 },
      T2M_MIN: { ANN: 22 },
    },
  },
  header: { fill_value: -999, start: '20010101', end: '20201231' },
  parameters: { PRECTOTCORR: { units: 'mm/day' }, ALLSKY_SFC_SW_DWN: { units: 'kW-hr/m^2/day' } },
};
const monthlyFixture = (start, end) => {
  const values = {};
  for (let y = start; y <= end; y++) for (let m = 1; m <= 12; m++) values[`${y}${String(m).padStart(2, '0')}`] = 4 + (y % 3);
  return { properties: { parameter: { PRECTOTCORR: values } }, parameters: { PRECTOTCORR: { units: 'mm/day' } } };
};
const soilLayer = (name, d, v) => ({
  name,
  unit_measure: { d_factor: d },
  depths: ['0-5cm', '5-15cm', '15-30cm'].map((label) => ({ label, values: { mean: v, 'Q0.05': v - 5, 'Q0.95': v + 5 } })),
});
const soilFixture = {
  properties: {
    layers: [
      soilLayer('phh2o', 10, 58),
      soilLayer('soc', 10, 120),
      soilLayer('clay', 10, 250),
      soilLayer('sand', 10, 400),
      soilLayer('silt', 10, 350),
      soilLayer('nitrogen', 100, 110),
      soilLayer('cec', 10, 90),
    ],
  },
};

async function routeEnvFixtures(context) {
  const json = (route, body) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await context.route(/power\.larc\.nasa\.gov\/api\/temporal\/climatology/, (r) => json(r, climatologyFixture));
  await context.route(/power\.larc\.nasa\.gov\/api\/temporal\/monthly/, (r) => {
    const u = new URL(r.request().url());
    return json(r, monthlyFixture(Number(u.searchParams.get('start')), Number(u.searchParams.get('end'))));
  });
  // The web build reads SoilGrids through the site's /soilgrids/ proxy. The first request
  // gets a "busy" answer, as the real API often gives, to check the app retries.
  let soilCalls = 0;
  await context.route(/\/soilgrids\/soilgrids\/v2\.0\/properties\/query/, (r) =>
    ++soilCalls === 1 ? r.fulfill({ status: 503, body: 'busy' }) : json(r, soilFixture),
  );
}

describe('environmental analysis and crop suitability', () => {
  it('fetches, labels and saves indicators, then scores crops offline', async () => {
    const { page, context, errors } = await openApp();
    await routeEnvFixtures(context);
    await button(page, 'Go to Cambodia').click();
    await page.getByTestId('place-title').getByText('Cambodia', { exact: true }).waitFor();
    await page.getByTestId('analyse').click();
    await page.getByText('What this analysis does').waitFor();
    await page.getByTestId('run-analysis').click();

    // Annual rainfall is the sum of monthly mm/day × days (Feb counted as 28.25 in climatology).
    const days = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const annual = Math.round(synthRainMmPerDay.reduce((a, v, i) => a + Math.round(v * days[i]), 0));
    await page.getByTestId('card-rainfall').getByText(annual.toLocaleString('en-US'), { exact: false }).waitFor({ timeout: 30000 });

    // Every indicator carries its source details.
    await shot(page, 'analysis-climate');
    await page.getByTestId('card-rainfall').getByRole('button', { name: 'About this data' }).click();
    await page.getByTestId('card-rainfall').getByText('NASA POWER', { exact: true }).waitFor();
    await page.getByTestId('card-rainfall').getByText('Average 2001–2020').waitFor();

    // Soil tab: modelled pH with the "not a measurement" caveat.
    await page.getByRole('tab', { name: 'Soil' }).click();
    await page.getByTestId('card-soil').getByText(/^5\.8 pH/).waitFor();
    await page.getByText(/not a test of your field/).waitFor();
    await page.getByText('Loam', { exact: true }).waitFor();
    await shot(page, 'analysis-soil');

    // Seasons come from the monthly averages: with this synthetic rain, May–November are wet (≥ 100 mm).
    await page.getByRole('tab', { name: 'Climate' }).click();
    await page.getByTestId('card-seasons').getByText(/^Wet season/).waitFor();
    await page.getByTestId('card-seasons').getByText('May – November').waitFor();
    await page.getByTestId('card-seasons').getByText(/^Dry season/).waitFor();
    // Which season it is now, from the device's date.
    await page.getByTestId('season-now').getByText(/^Now \((January|February|March|April|May|June|July|August|September|October|November|December)\): (wet|dry) season\./).waitFor();
    await shot(page, 'analysis-seasons');

    // Land tab: land cover is read from ESA's real WorldCover file through the site's proxy.
    // Terrain tiles were unreachable, which is shown, not filled in.
    await page.getByRole('tab', { name: 'Land' }).click();
    // (ESA's 2021 map has tree cover at the country's label point.)
    await page.getByTestId('card-landcover').getByText('Tree cover').first().waitFor({ timeout: 60000 });
    await page.getByTestId('card-terrain').getByText(/Could not load this data/).waitFor();
    // The land is split into zones, each judged on its own land cover.
    const zones = page.getByTestId('card-zones');
    await zones.getByTestId('zones-usable').waitFor();
    await zones.getByText(/A 400 m square around the point is split into/).waitFor();
    // Zones are drawn on the satellite map of the place (imagery is blocked in tests, which is said).
    await zones.getByText(/The satellite image could not load|Zones over the satellite image/).waitFor();
    const zoneMap = await (await zones.locator('iframe[title="map"]').elementHandle()).contentFrame();
    await zoneMap.waitForFunction(() => window.__zones > 0, null, { timeout: 30000 });
    await zones.getByTestId('zone-1').click();
    await zones.getByTestId('zone-detail').getByText('Zone 1', { exact: false }).waitFor();
    assert.equal(await zoneMap.evaluate(() => document.querySelectorAll('.zone-label-on').length), 1);
    await shot(page, 'analysis-land');

    // Second soil source: FAO's soil map, bundled for Cambodia, compared with SoilGrids.
    // (At the country's label point HWSD v2 maps Gleysols, pH 5.9; the SoilGrids fixture says 5.8.)
    await page.getByRole('tab', { name: 'Soil' }).click();
    await page.getByTestId('card-hwsd').getByText(/Main soil of this map unit: Gleysols/).waitFor();
    await page.getByTestId('card-hwsd').getByText('Very poorly drained').waitFor();
    await page.getByTestId('card-soil-compare').getByText('Soil pH: SoilGrids 5.8, FAO soil map 5.9.').waitFor();
    await page.getByTestId('card-soil-compare').getByText(/They agree closely/).waitFor();
    await shot(page, 'analysis-soil2');

    // Farming: crops grown around the place (real FAO GAEZ cell through the site's proxy),
    // the country's farm economy (bundled), and another country picked by search.
    await page.getByRole('tab', { name: 'Farming' }).click();
    const local = page.getByTestId('card-local-crops');
    await local.getByText(/Share of the harvested area in the/).waitFor({ timeout: 60000 });
    await local.getByTestId('local-crop-RCW').waitFor();
    await local.getByText(/Highest value per hectare here: .*, about \$[\d,]+\/ha/).waitFor();
    // US$ by default; the local currency is one tap away and is converted at a dated rate.
    await page.getByTestId('currency-USD').filter({ visible: true }).waitFor();
    await page.getByTestId('currency-KHR').filter({ visible: true }).click();
    await local.getByText(/Highest value per hectare here: .*, about [\d,]+ ៛\/ha/).waitFor();
    await page.getByText(/Converted from US\$ at the exchange rate of \d{4}-\d{2}-\d{2}/).filter({ visible: true }).waitFor();
    await shot(page, 'analysis-farming-riel');
    await page.getByTestId('currency-USD').filter({ visible: true }).click();
    await local.getByText(/about \$[\d,]+\/ha/).waitFor();
    await shot(page, 'analysis-farming');
    const country = page.getByTestId('card-country');
    await country.getByText('Farming in Cambodia').waitFor();
    await country.getByTestId('country-crop-RCW').waitFor();
    await country.getByTestId('country-search').fill('thai');
    await country.getByTestId('country-pick-THA').click();
    await country.getByText('Farming in Thailand').waitFor();
    await country.getByTestId('country-crop-RCW').waitFor();
    await shot(page, 'analysis-country');
    await page.getByRole('tab', { name: 'Land' }).click();

    // Crop scores are computed from the saved analysis with no network at all. (The web
    // build loads each screen's code on first visit, so open the screen once while online.)
    await page.getByTestId('to-crops').click();
    await page.getByText(/Calculated on this phone/).waitFor();
    await page.goBack();
    await context.setOffline(true);
    // "Plant now" follows the phone's date; fix it to 10 June so the test is repeatable.
    await page.clock.setFixedTime(new Date('2026-06-10T09:00:00'));
    await page.getByTestId('to-crops').click();
    await page.getByText(/Calculated on this phone/).filter({ visible: true }).waitFor();

    // Plant now first: crops worth sowing in June or July, in the current (wet) season.
    const nowView = page.getByTestId('plant-now-view').filter({ visible: true });
    await nowView.getByText('Sow in June or July').waitFor();
    await nowView.getByTestId('plant-now-season').getByText('Now (June): wet season. Next: dry season from December.').waitFor();
    await nowView.locator('[data-testid^="now-"]').first().getByText(/^Sow in (June|July)$/).waitFor();
    await shot(page, 'crops-plant-now');

    // Seasons view: every season with each crop's best sowing month.
    await page.getByRole('tab', { name: 'Seasons' }).click();
    await page.getByTestId('seasons-view').filter({ visible: true }).waitFor();
    // The whole catalogue is ranked; narrow it to cereals.
    await page.getByTestId('crop-cat-cereals').filter({ visible: true }).click();
    await page.getByTestId('season-crop-maize').filter({ visible: true }).getByText(/^Sow in /).waitFor();
    await shot(page, 'crops-seasons');
    await page.getByTestId('season-dry-11').filter({ visible: true }).click();
    await page.getByTestId('seasons-view').filter({ visible: true }).getByText(/With irrigation/).first().waitFor();
    await shot(page, 'crops-dry-season');

    await page.getByRole('tab', { name: 'Whole year' }).click();
    await page.getByTestId('crop-maize').filter({ visible: true }).waitFor();
    await shot(page, 'crops-ranking');
    await page.getByTestId('crop-maize').filter({ visible: true }).click();
    await page.getByText('Light band: range the crop tolerates', { exact: false }).waitFor();
    await page.getByTestId('calendar-maize').filter({ visible: true }).waitFor();
    await page.getByRole('tab', { name: 'Compare' }).click();
    await page.getByTestId('compare-table').waitFor();
    await shot(page, 'crops-compare');
    // Earnings: suitable crops by typical value of a hectare's harvest (FAO prices, not market prices).
    await page.getByRole('tab', { name: 'Earnings' }).click();
    await page.getByTestId('earnings-view').filter({ visible: true }).getByText(/ranked by the value of a typical harvest/).waitFor();
    await page.getByTestId('earnings-view').filter({ visible: true }).getByText(/^\$[\d,]+\/ha$/).first().waitFor();
    await page.getByTestId('earnings-view').filter({ visible: true }).getByTestId('currency-KHR').click();
    await page.getByTestId('earnings-view').filter({ visible: true }).getByText(/^[\d,]+ ៛\/ha$/).first().waitFor();
    await page.getByTestId('earnings-view').filter({ visible: true }).getByTestId('currency-USD').click();
    await shot(page, 'crops-earnings');

    // Search the whole catalogue by name, including ECOCROP's local names.
    await page.getByTestId('crop-cat-all').filter({ visible: true }).click();
    const search = page.getByTestId('crop-search').filter({ visible: true });
    await search.fill('rice');
    const results = page.getByTestId('crop-search-results').filter({ visible: true });
    await results.getByTestId('crop-rice').click();
    await results.getByTestId('calendar-rice').waitFor();
    await search.fill('okra');
    await page.getByTestId('crop-search-results').filter({ visible: true }).getByTestId('crop-okra').waitFor();
    await search.fill('bhindi');
    await page.getByTestId('crop-search-results').filter({ visible: true }).getByTestId('crop-okra').waitFor();
    await shot(page, 'crops-search');
    await search.fill('');
    await page.getByTestId('crop-cat-fruits').filter({ visible: true }).click();
    await page.getByRole('tab', { name: 'Whole year' }).click();
    await page.getByTestId('crop-mango').filter({ visible: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('identifies a plant from a photo and opens it in the crop list', async () => {
    const { page, context, errors } = await openApp();
    await routeEnvFixtures(context);
    // The app's /api/identify function needs a Pl@ntNet key and isn't part of the static build,
    // so its answer is SYNTHETIC here, in the shape api/identify.ts returns.
    let uploaded = null;
    await page.route(/\/api\/identify$/, async (r) => {
      uploaded = r.request().postDataBuffer();
      await r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          matches: [
            { scientific: 'Oryza sativa', genus: 'Oryza', family: 'Poaceae', commonNames: ['Rice'], score: 0.81 },
            { scientific: 'Quercus robur', genus: 'Quercus', family: 'Fagaceae', commonNames: ['English oak'], score: 0.04 },
          ],
        }),
      });
    });
    await button(page, 'Go to Cambodia').click();
    await page.getByTestId('analyse').click();
    await page.getByTestId('run-analysis').click();
    await page.getByTestId('to-crops').click({ timeout: 60000 });
    await page.getByTestId('open-scan').filter({ visible: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('scan-library').click();
    await (await chooser).setFiles(join(DIST, '..', 'assets', 'favicon.png'));
    await page.getByTestId('scan-preview').waitFor();
    // Nothing is uploaded until the user asks.
    assert.equal(uploaded, null);
    await page.getByTestId('organ-flower').click();
    await page.getByTestId('scan-send').click();
    await page.getByTestId('scan-match-0').getByText('Rice', { exact: false }).waitFor();
    await page.getByTestId('scan-match-0').getByText('81% match').waitFor();
    await page.getByTestId('scan-match-1').getByText('Uncertain').waitFor();
    await page.getByTestId('scan-match-1').getByText('Not in the crop list').waitFor();
    assert.ok(uploaded && uploaded.includes('name="organ"') && uploaded.includes('flower'));
    await shot(page, 'scan-results');
    await page.getByTestId('scan-open-rice').click();
    await page.getByTestId('crop-search-results').filter({ visible: true }).getByTestId('crop-rice').waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('measures a field and goes straight to its crops and weather', async () => {
    const { page, context, errors } = await openApp();
    await routeEnvFixtures(context);
    await button(page, 'Go to Cambodia').click();
    await page.getByTestId('place-title').getByText('Cambodia', { exact: true }).waitFor();
    await page.getByTestId('measure-land').click();
    const { frame: draw } = await mapFrame(page, 2);
    await draw.waitForFunction(() => window.__map.getZoom() > 16);
    const [cx, cy] = await draw.evaluate(() => window.__map.getCenter().toArray());
    for (const p of [
      [cx - 0.0005, cy - 0.0005],
      [cx + 0.0005, cy - 0.0005],
      [cx + 0.0005, cy + 0.0005],
      [cx - 0.0005, cy + 0.0005],
    ])
      await clickMap(page, draw, p);
    await button(page, 'Close shape').click();
    // One tap: the boundary is kept and the check starts by itself.
    await page.getByTestId('parcel-check').click();
    const glance = page.getByTestId('at-a-glance');
    await glance.getByText('Your land at a glance').waitFor({ timeout: 30000 });
    await glance.getByText(/^1\.\d+ ha$/).waitFor();
    await glance.getByText('Good to sow now').waitFor({ timeout: 60000 });
    await shot(page, 'measure-to-crops');
    await glance.getByTestId('glance-crops').click();
    await page.getByTestId('plant-now-view').filter({ visible: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('shows each result as soon as it arrives, without waiting for slow sources', async () => {
    const { page, context, errors } = await openApp();
    await routeEnvFixtures(context);
    // Hold SoilGrids (often the slowest source) until the rest is on screen.
    let release;
    const held = new Promise((r) => (release = r));
    await page.route(/\/soilgrids\/soilgrids\/v2\.0\/properties\/query/, async (r) => {
      await held;
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(soilFixture) });
    });
    await button(page, 'Go to Cambodia').click();
    await page.getByTestId('analyse').click();
    await page.getByTestId('run-analysis').click();
    await page.getByTestId('card-rainfall').getByText(/mm/).first().waitFor({ timeout: 30000 });
    await page.getByRole('tab', { name: 'Soil' }).click();
    await page.getByTestId('card-soil-loading').waitFor();
    await page.getByTestId('card-hwsd').getByText(/Main soil of this map unit/).waitFor();
    await shot(page, 'analysis-progressive');
    release();
    await page.getByTestId('card-soil').getByText(/^5\.8 pH/).waitFor({ timeout: 30000 });
    await page.getByTestId('to-crops').waitFor({ timeout: 60000 });
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('gives no crop advice when the land could not be seen', async () => {
    const { page, context, errors } = await openApp();
    await routeEnvFixtures(context);
    await page.route(/\/worldcover\//, (r) => r.abort('internetdisconnected'));
    await button(page, 'Go to Cambodia').click();
    await page.getByTestId('place-title').getByText('Cambodia', { exact: true }).waitFor();
    await page.getByTestId('analyse').click();
    await page.getByTestId('run-analysis').click();
    await page.getByTestId('land-blocked').getByText('No crop advice: land not checked').waitFor({ timeout: 30000 });
    assert.equal(await page.getByTestId('to-crops').count(), 0);
    await shot(page, 'analysis-land-blocked');
    assert.deepEqual(errors, []);
    await context.close();
  });
});

describe('Khmer interface', () => {
  it('shows place names, dates, tabs and farming figures in Khmer', async () => {
    const { page, context, errors } = await openApp();
    await routeEnvFixtures(context);
    await button(page, 'Language').first().click();
    await page.getByTestId('go-cambodia').click();
    await page.getByTestId('place-title').getByText('កម្ពុជា', { exact: true }).waitFor();
    await page.getByTestId('analyse').click();
    await page.getByTestId('run-analysis').click();
    await page.getByTestId('card-rainfall').waitFor({ timeout: 30000 });
    // Date with a Khmer month name, not an English one.
    const months = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
    await page.getByText(new RegExp(`ធ្វើបច្ចុប្បន្នភាព \\d+ (${months.join('|')}) \\d{4}`)).waitFor();
    for (const tab of ['អាកាសធាតុ', 'ដី', 'ដីធ្លី', 'កសិកម្ម']) await page.getByRole('tab', { name: new RegExp(`(^|\\s)${tab}$`) }).waitFor();
    await page.getByRole('tab', { name: /កសិកម្ម$/ }).click();
    await page.getByTestId('card-country').getByText('កសិកម្មនៅ កម្ពុជា').waitFor();
    await page.getByTestId('card-country').getByTestId('country-crop-RCW').getByText('ស្រូវ', { exact: false }).waitFor();
    await shot(page, 'km-farming');
    assert.equal(await page.getByText('Cambodia', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  });
});
