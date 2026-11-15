// Browser tests for the MapLibre globe page (src/map/web/map-app.js) in headless Chromium.
// Remote tile servers are replaced by locally generated tiles so the tests are
// deterministic and run offline; one test blocks all tiles to check offline behaviour.
//
//   npm run test:map            (set CHROMIUM_PATH to use a specific Chromium build)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { deflateSync } from 'node:zlib';

import { chromium } from 'playwright-core';

import { buildMapHtml } from './build-map-html.mjs';

// ---------- tiny PNG encoder for synthetic tiles ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function solidPng([r, g, b]) {
  const w = 256;
  const h = 256;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Terrarium encoding of 123.5 m: 123.5 + 32768 = 32891.5 -> R=128, G=123, B=128.
const SYNTHETIC_ELEVATION = 123.5;
const TERRAIN_TILE = solidPng([128, 123, 128]);
const IMAGERY_TILE = solidPng([200, 40, 160]); // magenta, easy to detect on screen

const CONFIG = {
  center: [0, 15],
  zoom: 1.5,
  projection: 'globe',
  baseLayers: {
    'satellite-s2': {
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 14,
      attribution: 'test',
    },
    outline: null,
  },
  terrain: {
    // The page serves terrain through farmdem://; with no Planetary Computer set it reads the backup tiles.
    tiles: ['farmdem://{z}/{x}/{y}'],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 13,
    encoding: 'terrarium',
    attribution: 'test',
    planetary: null,
    fallbackTiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  },
  elevationZoom: 12,
  soil: { tiles: ['https://maps.isric.org/mapserv?BBOX={bbox-epsg-3857}'], tileSize: 256, minzoom: 0, maxzoom: 12, attribution: 'test' },
  climate: { attribution: 'test', stops: { rainfall: [[0, '#ffffff'], [3000, '#0000ff']], sunlight: [[3, '#6a51a3'], [6, '#c4361b']] } },
  landCover: { minzoom: 7, maxzoom: 14, attribution: 'test', colors: { 40: '#f096ff', 80: '#0064c8' } },
};

let server;
let baseUrl;
let browser;

before(async () => {
  const html = buildMapHtml();
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function openMap({ offline = false, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 400, height: 700 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  const tileRequests = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    tileRequests.push(url);
    if (offline) return route.abort('internetdisconnected');
    if (url.includes('terrarium')) return route.fulfill({ body: TERRAIN_TILE, contentType: 'image/png' });
    if (url.includes('eox.at')) return route.fulfill({ body: IMAGERY_TILE, contentType: 'image/png' });
    return route.abort();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.addInitScript(() => {
    window.__farmMapEvents = [];
  });
  await page.goto(baseUrl);
  await page.waitForFunction(() => window.__farmMapEvents.some((e) => e.type === 'ready'));
  await page.evaluate((config) => window.farmMap.receive({ type: 'init', config }), CONFIG);
  await page.waitForFunction(() => window.__farmMapEvents.some((e) => e.type === 'loaded'), null, {
    timeout: 30000,
  });
  return { page, context, tileRequests, errors };
}

const send = (page, cmd) => page.evaluate((c) => window.farmMap.receive(c), cmd);
const events = (page, type) => page.evaluate((t) => window.__farmMapEvents.filter((e) => e.type === t), type);
const idle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const m = window.__map;
        if (!m.isMoving()) return resolve();
        m.once('moveend', () => resolve());
      }),
  );
async function waitFor(predicate, timeoutMs = 10000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}
/** Waits until the ring's vertices are queryable on screen (GeoJSON updates render asynchronously). */
const ringRendered = (page, n) =>
  page.waitForFunction(
    (count) => window.__map.queryRenderedFeatures({ layers: ['ring-vertices'] }).length >= count,
    n,
  );
const clearEvents = (page) => page.evaluate(() => (window.__farmMapEvents.length = 0));
const project = (page, lngLat) => page.evaluate((ll) => window.__map.project(ll), lngLat);

describe('globe', () => {
  it('renders a globe projection with a WebGL canvas', async () => {
    const { page, context, errors } = await openMap();
    const info = await page.evaluate(() => ({
      projection: window.__map.style.projection?.name ?? window.__map.getProjection()?.type,
      webgl: !!window.__map.painter.context.gl,
    }));
    assert.equal(info.projection, 'globe');
    assert.ok(info.webgl);
    // The globe sits in space: corners are background, the centre is land or ocean.
    const shot = await page.screenshot();
    assert.ok(shot.length > 5000, 'screenshot should not be blank');
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('rotates when dragged', async () => {
    const { page, context } = await openMap();
    const before = await page.evaluate(() => window.__map.getCenter().lng);
    await page.mouse.move(200, 350);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(200 + i * 15, 350);
    await page.mouse.up();
    await idle(page);
    const afterLng = await page.evaluate(() => window.__map.getCenter().lng);
    assert.ok(Math.abs(afterLng - before) > 5, `expected rotation, centre moved ${afterLng - before}°`);
    const views = await events(page, 'viewChanged');
    assert.ok(views.length > 0, 'viewChanged events emitted while rotating');
    await context.close();
  });

  it('zooms with the zoom button, the zoomBy command and the scroll wheel', async () => {
    const { page, context } = await openMap();
    const z0 = await page.evaluate(() => window.__map.getZoom());
    await page.click('.maplibregl-ctrl-zoom-in');
    await idle(page);
    const z1 = await page.evaluate(() => window.__map.getZoom());
    assert.ok(z1 > z0 + 0.5, `zoom-in button: ${z0} -> ${z1}`);
    await send(page, { type: 'zoomBy', delta: 2 });
    await page.waitForTimeout(400);
    await idle(page);
    const z2 = await page.evaluate(() => window.__map.getZoom());
    assert.ok(Math.abs(z2 - (z1 + 2)) < 0.01, `zoomBy: ${z1} -> ${z2}`);
    await page.mouse.move(200, 350);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(600);
    await idle(page);
    const z3 = await page.evaluate(() => window.__map.getZoom());
    assert.ok(z3 < z2, `wheel out: ${z2} -> ${z3}`);
    await context.close();
  });

  it('reports the tapped coordinate in browse mode', async () => {
    const { page, context } = await openMap();
    await clearEvents(page);
    const expected = await page.evaluate(() => window.__map.unproject([200, 350]));
    await page.mouse.click(200, 350);
    const taps = await events(page, 'mapTap');
    assert.equal(taps.length, 1);
    assert.ok(Math.abs(taps[0].point[0] - expected.lng) < 0.5);
    assert.ok(Math.abs(taps[0].point[1] - expected.lat) < 0.5);
    await context.close();
  });

  it('flies from the globe to a bounding box (Cambodia shortcut)', async () => {
    const { page, context } = await openMap();
    // Natural Earth 1:110m extent of Cambodia, as used by the app's shortcut.
    await send(page, { type: 'fitBounds', bbox: [102.35, 10.49, 107.61, 14.57], maxZoom: 8 });
    await page.waitForTimeout(300);
    await idle(page);
    const v = await page.evaluate(() => ({ c: window.__map.getCenter(), z: window.__map.getZoom() }));
    assert.ok(v.c.lng > 102.35 && v.c.lng < 107.61, `lng ${v.c.lng}`);
    assert.ok(v.c.lat > 10.49 && v.c.lat < 14.57, `lat ${v.c.lat}`);
    assert.ok(v.z > 4, `zoomed in to ${v.z}`);
    await context.close();
  });

  it('places selection and user-location markers with an accuracy circle', async () => {
    const { page, context } = await openMap();
    await send(page, { type: 'setSelected', point: [10, 20] });
    await send(page, { type: 'setUserLocation', point: [11, 21], accuracyMeters: 500 });
    const state = await page.evaluate(() => ({
      markers: document.querySelectorAll('.maplibregl-marker').length,
      userDots: document.querySelectorAll('.user-dot').length,
      accuracy: window.__map.getSource('accuracy')._data,
    }));
    assert.equal(state.markers, 2);
    assert.equal(state.userDots, 1);
    const accFeatures = state.accuracy.features ?? state.accuracy.geojson?.features;
    assert.equal(accFeatures.length, 1);
    await send(page, { type: 'setUserLocation', point: null, accuracyMeters: null });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.user-dot').length), 0);
    await context.close();
  });

  it('switches to satellite imagery and requests tiles from the provider URL', async () => {
    const { page, context, tileRequests } = await openMap();
    await send(page, { type: 'setBaseLayer', id: 'satellite-s2' });
    await page.waitForFunction(() => window.__map.areTilesLoaded(), null, { timeout: 15000 });
    await waitFor(() => tileRequests.some((u) => u.includes('eox.at')));
    const vis = await page.evaluate(() => window.__map.getLayoutProperty('base-satellite-s2', 'visibility'));
    assert.equal(vis, 'visible');
    assert.ok(tileRequests.some((u) => /eox\.at\/wmts\/1\.0\.0\/s2cloudless_3857\/default\/g\/\d+\/\d+\/\d+\.jpg$/.test(u)));
    await context.close();
  });

  it('decodes elevation from a Terrarium tile', async () => {
    const { page, context } = await openMap();
    await send(page, { type: 'queryElevation', requestId: 7, point: [104.9, 11.5] });
    await page.waitForFunction(() => window.__farmMapEvents.some((e) => e.type === 'elevation'));
    const [ev] = await events(page, 'elevation');
    assert.equal(ev.requestId, 7);
    assert.equal(ev.meters, SYNTHETIC_ELEVATION);
    await context.close();
  });

  it('draws the land-cover overlay from class codes sent by React Native', async () => {
    const { page, context } = await openMap();
    await send(page, { type: 'setProjection', projection: 'mercator' });
    await send(page, { type: 'flyTo', center: [104.9, 11.5], zoom: 9, duration: 0 });
    await send(page, { type: 'setOverlay', id: 'landcover', visible: true });
    await page.waitForFunction(() => window.__farmMapEvents.some((e) => e.type === 'tileRequest'), null, { timeout: 15000 });
    // Answer every request (including late ones) with a synthetic all-water tile.
    const answered = new Set();
    const answer = async () => {
      for (const r of await events(page, 'tileRequest')) {
        if (answered.has(r.requestId)) continue;
        answered.add(r.requestId);
        assert.equal(r.layer, 'landcover');
        assert.ok(r.z >= 7 && r.z <= 10, `unexpected zoom ${r.z}`);
        await send(page, { type: 'tileData', requestId: r.requestId, runs: [80, 256 * 256] });
      }
    };
    for (let i = 0; ; i++) {
      await answer();
      if (await page.evaluate(() => window.__map.isSourceLoaded('landcover') && !window.__map.isMoving())) break;
      if (i > 200) throw new Error('land-cover tiles never loaded');
      await new Promise((r) => setTimeout(r, 50));
    }
    const pixel = await page.evaluate(
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
            resolve(Array.from(ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data));
          });
          m.triggerRepaint();
        }),
    );
    // Water blue (0, 100, 200) at 72% over the green outline land.
    assert.ok(pixel[2] > pixel[0] + 80 && pixel[2] > pixel[1], `expected blue land cover, got ${pixel}`);
    await context.close();
  });

  it('draws land zones in colour with labels, and highlights the selected one', async () => {
    const { page, context } = await openMap();
    await send(page, { type: 'setProjection', projection: 'mercator' });
    await send(page, { type: 'flyTo', center: [0.001, 0.001], zoom: 16, duration: 0 });
    await idle(page);
    const ring = (x, y) => [[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001]];
    await send(page, {
      type: 'setZones',
      zones: [
        { id: 0, ring: ring(0, 0), color: '#ff0000', label: 'A1' },
        { id: 1, ring: ring(0.001, 0.001), color: '#0000ff', label: 'B2' },
        { id: 2, ring: [], color: '#00ff00', label: 'C3' },
      ],
      selected: 1,
    });
    await idle(page);
    assert.equal(await page.evaluate(() => window.__zones), 2);
    await page.waitForFunction(() => window.__map.queryRenderedFeatures({ layers: ['zones-fill'] }).length >= 2, null, { timeout: 10000 });
    const labels = await page.$$eval('.zone-label', (els) => els.map((e) => [e.textContent, e.classList.contains('zone-label-on')]));
    assert.deepEqual(labels, [['A1', false], ['B2', true]]);
    const pixelAt = (lng, lat) =>
      page.evaluate(
        ([lng, lat]) =>
          new Promise((resolve) => {
            const m = window.__map;
            m.once('render', () => {
              const c = m.getCanvas();
              const p = m.project([lng, lat]);
              const r = window.devicePixelRatio || 1;
              const copy = document.createElement('canvas');
              copy.width = c.width;
              copy.height = c.height;
              const ctx = copy.getContext('2d');
              ctx.drawImage(c, 0, 0);
              resolve(Array.from(ctx.getImageData(Math.round(p.x * r) + 6, Math.round(p.y * r) + 6, 1, 1).data));
            });
            m.triggerRepaint();
          }),
        [lng, lat],
      );
    // Near the zone corners (away from the labels): red over zone A, blue over zone B.
    const a = await pixelAt(0, 0.001);
    const b = await pixelAt(0.001, 0.002);
    assert.ok(a[0] > a[2] + 40, `expected red zone, got ${a}`);
    assert.ok(b[2] > b[0] + 40, `expected blue zone, got ${b}`);
    await send(page, { type: 'setZones', zones: [], selected: null });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.zone-label').length), 0);
    await context.close();
  });

  it('switches between globe and flat projections', async () => {
    const { page, context } = await openMap();
    await send(page, { type: 'setProjection', projection: 'mercator' });
    const p = await page.evaluate(() => window.__map.getProjection()?.type);
    assert.equal(p, 'mercator');
    await context.close();
  });
});

describe('place names', () => {
  const places = (page) => page.evaluate(() => window.__places());
  const overlaps = (page) =>
    page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.places .pl')].map((el) => el.getBoundingClientRect());
      let n = 0;
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) n++;
        }
      return n;
    });
  const SHOTS = process.env.SHOTS_DIR;

  it('names countries on the globe, only on the side facing the viewer', async () => {
    const { page, context, errors } = await openMap({ offline: true });
    await send(page, { type: 'flyTo', center: [104, 12], zoom: 2, duration: 0 });
    // Labels are placed after the move settles; wait for them rather than a fixed delay.
    await page.waitForFunction(() => window.__places().some((p) => ['Cambodia', 'Thailand', 'India'].includes(p.text)), null, { timeout: 10000 });
    const names = (await places(page)).map((p) => p.text);
    assert.ok(names.includes('Cambodia') || names.includes('Thailand') || names.includes('India'), names.join(', '));
    assert.ok(!names.includes('Brazil') && !names.includes('United States of America'), 'far side of the globe is hidden');
    assert.equal(await overlaps(page), 0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/map-places-globe.png` });
    assert.deepEqual(errors, []);
    await context.close();
  });

  it('shows provinces and towns in Cambodia, in Khmer when asked, and can be turned off', async () => {
    const { page, context } = await openMap({ offline: true });
    await send(page, { type: 'setProjection', projection: 'mercator' });
    await send(page, { type: 'flyTo', center: [104.9, 11.9], zoom: 7, duration: 0 });
    await page.waitForTimeout(200);
    let list = await places(page);
    const names = list.map((p) => p.text);
    assert.ok(names.includes('Phnom Penh'), names.join(', '));
    assert.ok(list.some((p) => p.kind === 2), 'province names');
    assert.ok(list.some((p) => p.kind === 3 || p.kind === 4), 'town names');
    assert.equal(await overlaps(page), 0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/map-places-cambodia.png` });

    await send(page, { type: 'setPlaceLanguage', language: 'km' });
    list = await places(page);
    assert.ok(list.some((p) => p.text === 'ភ្នំពេញ'), list.map((p) => p.text).join(', '));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/map-places-khmer.png` });

    await send(page, { type: 'setOverlay', id: 'places', visible: false });
    assert.equal((await places(page)).length, 0);
    await send(page, { type: 'setOverlay', id: 'places', visible: true });
    assert.ok((await places(page)).length > 0);
    await context.close();
  });
});

describe('parcel drawing', () => {
  async function localMap() {
    const m = await openMap();
    await send(m.page, { type: 'setProjection', projection: 'mercator' });
    await send(m.page, { type: 'flyTo', center: [0.0005, 0.0005], zoom: 17, duration: 0 });
    await idle(m.page);
    await send(m.page, { type: 'setMode', mode: 'measure' });
    await clearEvents(m.page);
    return m;
  }

  it('adds points on tap, closes on the first vertex and ignores taps after closing', async () => {
    const { page, context } = await localMap();
    const pts = [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0.001],
    ];
    for (const p of pts) {
      const xy = await project(page, p);
      await page.mouse.click(xy.x, xy.y);
    }
    let rings = await events(page, 'ringChanged');
    assert.equal(rings.length, 4);
    assert.equal(rings[3].points.length, 4);
    assert.equal(rings[3].closed, false);
    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(rings[3].points[i][0] - pts[i][0]) < 1e-5);
      assert.ok(Math.abs(rings[3].points[i][1] - pts[i][1]) < 1e-5);
    }
    // No map taps leak out while measuring.
    assert.equal((await events(page, 'mapTap')).length, 0);

    await ringRendered(page, 4);
    const first = await project(page, pts[0]);
    await page.mouse.click(first.x + 3, first.y - 3); // a slightly-off finger still hits the vertex
    rings = await events(page, 'ringChanged');
    assert.equal(rings.at(-1).closed, true);
    assert.equal(rings.at(-1).points.length, 4);

    const inside = await project(page, [0.0005, 0.0005]);
    await page.mouse.click(inside.x, inside.y);
    assert.equal((await events(page, 'ringChanged')).length, rings.length, 'closed ring ignores taps');
    await context.close();
  });

  it('drags a vertex to a new position without panning the map', async () => {
    const { page, context } = await localMap();
    await send(page, {
      type: 'setRing',
      points: [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
        [0, 0.001],
      ],
      closed: true,
    });
    await ringRendered(page, 4);
    const centerBefore = await page.evaluate(() => window.__map.getCenter().toArray());
    const from = await project(page, [0.001, 0.001]);
    const to = await project(page, [0.0015, 0.0012]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    }
    await page.mouse.up();
    const rings = await events(page, 'ringChanged');
    assert.equal(rings.length, 1, 'one ringChanged at the end of the drag');
    const moved = rings[0].points[2];
    assert.ok(Math.abs(moved[0] - 0.0015) < 2e-5, `lng ${moved[0]}`);
    assert.ok(Math.abs(moved[1] - 0.0012) < 2e-5, `lat ${moved[1]}`);
    assert.equal(rings[0].closed, true);
    const centerAfter = await page.evaluate(() => window.__map.getCenter().toArray());
    assert.deepEqual(centerAfter, centerBefore, 'map did not pan during vertex drag');
    // The click at the end of a drag must not add a point.
    assert.equal(rings[0].points.length, 4);
    await context.close();
  });

  it('renders segment labels sent from React Native', async () => {
    const { page, context } = await localMap();
    await send(page, {
      type: 'setLabels',
      labels: [
        { at: [0.0005, 0], text: '111.3 m' },
        { at: [0.001, 0.0005], text: '110.6 m' },
      ],
    });
    const texts = await page.$$eval('.seg-label', (els) => els.map((e) => e.textContent));
    assert.deepEqual(texts, ['111.3 m', '110.6 m']);
    await context.close();
  });
});

describe('touch gestures', () => {
  async function touchPath(page, points) {
    const cdp = await page.context().newCDPSession(page);
    const at = (p) => [{ x: p[0], y: p[1], id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(points[0]) });
    for (const p of points.slice(1)) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(p) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  it('rotates the globe with a one-finger swipe', async () => {
    const { page, context } = await openMap({ touch: true });
    const before = await page.evaluate(() => window.__map.getCenter().lng);
    await touchPath(page, Array.from({ length: 12 }, (_, i) => [120 + i * 15, 350]));
    await idle(page);
    const afterLng = await page.evaluate(() => window.__map.getCenter().lng);
    assert.ok(Math.abs(afterLng - before) > 5, `centre moved ${afterLng - before}°`);
    await context.close();
  });

  it('zooms in with a two-finger pinch', async () => {
    const { page, context } = await openMap({ touch: true });
    const z0 = await page.evaluate(() => window.__map.getZoom());
    const cdp = await context.newCDPSession(page);
    const pts = (d) => [
      { x: 200 - d, y: 350, id: 1 },
      { x: 200 + d, y: 350, id: 2 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(20) });
    for (let d = 30; d <= 140; d += 10) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    await idle(page);
    const z1 = await page.evaluate(() => window.__map.getZoom());
    assert.ok(z1 > z0 + 1, `pinch zoom ${z0} -> ${z1}`);
    await context.close();
  });

  it('adds a point with a tap and drags a vertex with a finger', async () => {
    const { page, context } = await openMap({ touch: true });
    await send(page, { type: 'setProjection', projection: 'mercator' });
    await send(page, { type: 'flyTo', center: [0.0005, 0.0005], zoom: 17, duration: 0 });
    await idle(page);
    await send(page, { type: 'setMode', mode: 'measure' });
    await send(page, { type: 'setRing', points: [[0, 0], [0.001, 0], [0.001, 0.001]], closed: false });
    await ringRendered(page, 3);
    await clearEvents(page);

    const add = await project(page, [0, 0.001]);
    await page.touchscreen.tap(add.x, add.y);
    await page.waitForFunction(() => window.__farmMapEvents.some((e) => e.type === 'ringChanged'));
    let rings = await events(page, 'ringChanged');
    assert.equal(rings.at(-1).points.length, 4);

    await ringRendered(page, 4);
    const centerBefore = await page.evaluate(() => window.__map.getCenter().toArray());
    const from = await project(page, [0.001, 0]);
    const to = await project(page, [0.0012, -0.0002]);
    await touchPath(
      page,
      Array.from({ length: 9 }, (_, i) => [from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8]),
    );
    rings = await events(page, 'ringChanged');
    const moved = rings.at(-1).points[1];
    assert.ok(Math.abs(moved[0] - 0.0012) < 2e-5, `lng ${moved[0]}`);
    assert.ok(Math.abs(moved[1] + 0.0002) < 2e-5, `lat ${moved[1]}`);
    assert.equal(rings.at(-1).points.length, 4, 'drag did not add a point');
    assert.deepEqual(await page.evaluate(() => window.__map.getCenter().toArray()), centerBefore);
    await context.close();
  });
});

describe('offline', () => {
  it('still renders the bundled outline globe and allows drawing when tiles fail', async () => {
    const { page, context, errors } = await openMap({ offline: true });
    await send(page, { type: 'setBaseLayer', id: 'satellite-s2' });
    await page.waitForFunction(() => window.__farmMapEvents.some((e) => e.type === 'tileError'), null, {
      timeout: 15000,
    });
    const world = await page.evaluate(() => window.__map.querySourceFeatures('world').length);
    assert.ok(world > 0, 'bundled country outlines are rendered');
    await send(page, { type: 'setMode', mode: 'measure' });
    await clearEvents(page);
    await page.mouse.click(200, 350);
    assert.equal((await events(page, 'ringChanged')).length, 1);
    assert.deepEqual(errors, []);
    await context.close();
  });
});
