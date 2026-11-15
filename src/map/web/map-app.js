/* global maplibregl */
// Runs inside the WebView (or an iframe on web). Talks to React Native through
// the protocol in src/map/bridge.ts. Kept dependency-free apart from MapLibre GL JS
// so the whole page can be inlined and work without a network connection.
(function () {
  'use strict';

  var map = null;
  var config = null;
  var mode = 'browse';
  var ring = []; // [[lng, lat], ...]
  var ringClosed = false;
  var dragIndex = -1;
  var selectedMarker = null;
  var labelMarkers = [];
  var userDot = null;
  var lastTileErrorAt = {};
  var moveTimer = null;

  function post(msg) {
    var data = JSON.stringify(msg);
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(data);
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage({ __farmMap: true, data: data }, '*');
    }
    if (window.__farmMapEvents) window.__farmMapEvents.push(msg);
  }

  window.onerror = function (message) {
    post({ type: 'error', message: String(message) });
  };

  // Shown instead of a blank screen when MapLibre cannot start (no WebGL, blocked worker, old browser).
  function showFailure(reason) {
    post({ type: 'error', message: 'map failed to start: ' + reason });
    var el = document.getElementById('map');
    if (!el || document.getElementById('map-failed')) return;
    var box = document.createElement('div');
    box.id = 'map-failed';
    box.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;' +
      'text-align:center;color:#e8f1ea;font:500 15px/1.4 system-ui,sans-serif;background:#0b3d5c;z-index:2';
    box.textContent =
      'The map could not start in this browser. Try opening the page in Safari or Chrome. / ' +
      'ផែនទីមិនអាចបើកក្នុងកម្មវិធីរុករកនេះបានទេ។ សូមបើកក្នុង Safari ឬ Chrome។';
    el.appendChild(box);
  }

  var hasMapLibre = typeof window.maplibregl !== 'undefined';

  // ---------- geometry helpers (rendering only; measurements happen in RN) ----------

  function circlePolygon(center, radiusMeters, steps) {
    var coords = [];
    var lat = (center[1] * Math.PI) / 180;
    var dLat = radiusMeters / 111320;
    var dLng = radiusMeters / (111320 * Math.max(Math.cos(lat), 1e-6));
    for (var i = 0; i <= steps; i++) {
      var t = (i / steps) * 2 * Math.PI;
      coords.push([center[0] + dLng * Math.cos(t), center[1] + dLat * Math.sin(t)]);
    }
    return { type: 'Polygon', coordinates: [coords] };
  }

  function fc(features) {
    return { type: 'FeatureCollection', features: features };
  }

  // ---------- style ----------

  function rasterSource(p) {
    return {
      type: 'raster',
      tiles: p.tiles,
      tileSize: p.tileSize,
      minzoom: p.minzoom,
      maxzoom: p.maxzoom,
      attribution: p.attribution,
    };
  }

  function buildStyle(cfg) {
    var sources = {
      world: { type: 'geojson', data: window.__WORLD__, attribution: 'Natural Earth' },
      'terrain-dem': {
        type: 'raster-dem',
        tiles: cfg.terrain.tiles,
        tileSize: cfg.terrain.tileSize,
        maxzoom: cfg.terrain.maxzoom,
        encoding: cfg.terrain.encoding,
        attribution: cfg.terrain.attribution,
      },
      accuracy: { type: 'geojson', data: fc([]) },
      zones: { type: 'geojson', data: fc([]) },
      ring: { type: 'geojson', data: fc([]) },
      landcover: {
        type: 'raster',
        tiles: ['farmlc://{z}/{x}/{y}'],
        tileSize: 256,
        minzoom: cfg.landCover.minzoom,
        maxzoom: cfg.landCover.maxzoom,
        attribution: cfg.landCover.attribution,
      },
    };
    var layers = [
      { id: 'background', type: 'background', paint: { 'background-color': '#0b3d5c' } },
      { id: 'land', type: 'fill', source: 'world', paint: { 'fill-color': '#5d8a4a' } },
    ];
    Object.keys(cfg.baseLayers).forEach(function (id) {
      var p = cfg.baseLayers[id];
      if (!p) return;
      sources['base-' + id] = rasterSource(p);
      layers.push({
        id: 'base-' + id,
        type: 'raster',
        source: 'base-' + id,
        layout: { visibility: 'none' },
      });
    });
    layers.push(
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'terrain-dem',
        layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.5 },
      },
      {
        id: 'landcover',
        type: 'raster',
        source: 'landcover',
        minzoom: cfg.landCover.minzoom,
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.72, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
      },
      {
        id: 'boundaries',
        type: 'line',
        source: 'world',
        paint: { 'line-color': '#f4f1de', 'line-width': 0.8, 'line-opacity': 0.8 },
      },
      {
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'selected'], 0.62, 0.38] },
      },
      {
        id: 'zones-line',
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': ['case', ['get', 'selected'], '#ffffff', 'rgba(255,255,255,0.75)'],
          'line-width': ['case', ['get', 'selected'], 3.5, 1.2],
        },
      },
      {
        id: 'accuracy-fill',
        type: 'fill',
        source: 'accuracy',
        paint: { 'fill-color': '#1e88e5', 'fill-opacity': 0.18 },
      },
      {
        id: 'accuracy-line',
        type: 'line',
        source: 'accuracy',
        paint: { 'line-color': '#1e88e5', 'line-width': 1.5 },
      },
      {
        id: 'ring-fill',
        type: 'fill',
        source: 'ring',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#ffd54f', 'fill-opacity': 0.25 },
      },
      {
        id: 'ring-line',
        type: 'line',
        source: 'ring',
        filter: ['!=', ['geometry-type'], 'Point'],
        paint: { 'line-color': '#ffd54f', 'line-width': 3 },
      },
      {
        // Invisible, larger hit area so fingers can grab vertices.
        id: 'ring-vertex-hit',
        type: 'circle',
        source: 'ring',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 22, 'circle-opacity': 0 },
      },
      {
        id: 'ring-vertices',
        type: 'circle',
        source: 'ring',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': ['case', ['==', ['get', 'index'], 0], 10, 8],
          'circle-color': ['case', ['==', ['get', 'index'], 0], '#2e7d32', '#ffffff'],
          'circle-stroke-color': '#1b5e20',
          'circle-stroke-width': 3,
        },
      },
    );
    return {
      version: 8,
      projection: { type: cfg.projection },
      sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
      sources: sources,
      layers: layers,
    };
  }

  // ---------- land-cover tiles ----------
  // ESA's files can't be read from this page (no CORS headers), so the app reads them
  // and sends back class codes, which are coloured here into PNG tiles.

  var tileRequests = {};
  var nextTileRequest = 1;
  var emptyTile = null;

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function canvasToPng(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) return reject(new Error('tile encode failed'));
        blob.arrayBuffer().then(resolve, reject);
      }, 'image/png');
    });
  }

  function renderClassTile(runs) {
    var size = 256;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(size, size);
    var rgb = {};
    Object.keys(config.landCover.colors).forEach(function (code) {
      rgb[code] = hexToRgb(config.landCover.colors[code]);
    });
    var p = 0;
    for (var i = 0; i < runs.length; i += 2) {
      var c = rgb[runs[i]];
      for (var k = 0; k < runs[i + 1]; k++, p++) {
        if (!c) continue;
        img.data[p * 4] = c[0];
        img.data[p * 4 + 1] = c[1];
        img.data[p * 4 + 2] = c[2];
        img.data[p * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvasToPng(canvas);
  }

  function emptyPng() {
    if (!emptyTile) {
      var canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      emptyTile = canvasToPng(canvas);
    }
    return emptyTile;
  }

  if (hasMapLibre) maplibregl.addProtocol('farmlc', function (params, abortController) {
    var parts = params.url.replace('farmlc://', '').split('/').map(Number);
    var requestId = nextTileRequest++;
    return new Promise(function (resolve, reject) {
      tileRequests[requestId] = { resolve: resolve, reject: reject };
      abortController.signal.addEventListener('abort', function () {
        delete tileRequests[requestId];
        reject(new Error('aborted'));
      });
      post({ type: 'tileRequest', requestId: requestId, layer: 'landcover', z: parts[0], x: parts[1], y: parts[2] });
    }).then(function (msg) {
      if (msg.error) throw new Error('land-cover tile failed');
      return (msg.runs ? renderClassTile(msg.runs) : emptyPng()).then(function (data) {
        return { data: data };
      });
    });
  });

  function onTileData(msg) {
    var req = tileRequests[msg.requestId];
    if (!req) return;
    delete tileRequests[msg.requestId];
    req.resolve(msg);
  }

  // ---------- view events ----------

  function viewState() {
    var c = map.getCenter();
    var proj = map.getProjection && map.getProjection();
    return {
      center: [c.lng, c.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      projection: proj && proj.type === 'mercator' ? 'mercator' : config.projection,
    };
  }

  function onMove() {
    if (moveTimer) return;
    moveTimer = setTimeout(function () {
      moveTimer = null;
      post({ type: 'viewChanged', view: viewState(), final: false });
    }, 150);
  }

  // ---------- ring editing ----------

  function renderRing() {
    var features = [];
    if (ring.length >= 3 && ringClosed) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [ring.concat([ring[0]])] },
      });
    } else if (ring.length >= 2) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } });
    }
    ring.forEach(function (p, i) {
      features.push({ type: 'Feature', properties: { index: i }, geometry: { type: 'Point', coordinates: p } });
    });
    map.getSource('ring').setData(fc(features));
  }

  function emitRing() {
    post({ type: 'ringChanged', points: ring.slice(), closed: ringClosed });
  }

  function vertexAt(point) {
    var hits = map.queryRenderedFeatures(point, { layers: ['ring-vertex-hit'] });
    if (!hits.length) return -1;
    return hits[0].properties.index;
  }

  function startDrag(e) {
    if (mode !== 'measure') return;
    var i = vertexAt(e.point);
    if (i < 0) return;
    if (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches.length > 1) return;
    e.preventDefault();
    dragIndex = i;
    dragMoved = false;
    map.getCanvas().style.cursor = 'grabbing';
  }

  function moveDrag(e) {
    if (dragIndex < 0) return;
    dragMoved = true;
    ring[dragIndex] = [e.lngLat.lng, e.lngLat.lat];
    renderRing();
  }

  function endDrag() {
    if (dragIndex < 0) return;
    dragIndex = -1;
    map.getCanvas().style.cursor = '';
    // A press without movement is a tap; let the click handler treat it as one.
    if (!dragMoved) return;
    emitRing();
    // Swallow the click that follows a drag so it does not add a point.
    suppressClickUntil = Date.now() + 300;
  }

  var suppressClickUntil = 0;
  var dragMoved = false;

  function onClick(e) {
    if (Date.now() < suppressClickUntil) return;
    var lngLat = [e.lngLat.lng, e.lngLat.lat];
    if (mode !== 'measure') {
      post({ type: 'mapTap', point: lngLat });
      return;
    }
    var hit = vertexAt(e.point);
    if (hit === 0 && ring.length >= 3 && !ringClosed) {
      ringClosed = true;
      renderRing();
      emitRing();
      return;
    }
    if (hit >= 0 || ringClosed) return;
    ring.push(lngLat);
    renderRing();
    emitRing();
  }

  // ---------- place names ----------
  // Country, province, city and town names drawn as their own layer over any base map,
  // in the style of Google's hybrid map: white text with a dark halo, bigger and bolder
  // for more important places, and only as many as fit without overlapping. Drawn as
  // HTML so Khmer renders with the phone's own fonts (map tiles carry no Khmer glyphs).
  // Data: Natural Earth (public domain) plus hand-checked Khmer names (scripts/build-places.py).

  var PLACE_CLASS = ['pl-country', 'pl-capital', 'pl-province', 'pl-city', 'pl-town'];
  var PLACE_SIZE = [15, 13.5, 11.5, 13, 12];
  var MAX_PLACES = 70;
  var placesOn = true;
  var placeLanguage = 'en';
  var placeLayer = null;
  var placeFrame = 0;

  function placeName(p) {
    return (placeLanguage === 'km' && p[5]) || p[4];
  }

  function renderPlaces() {
    placeFrame = 0;
    if (!placeLayer) return;
    placeLayer.textContent = '';
    if (!placesOn || !window.__PLACES__) return;
    var zoom = map.getZoom();
    var canvas = map.getCanvas();
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    var c = map.getCenter();
    var globe = config.projection === 'globe';
    var cLat = (c.lat * Math.PI) / 180;
    var cLng = (c.lng * Math.PI) / 180;
    // On the globe, only places on the side facing the viewer.
    var horizon = Math.cos(Math.min(1.35, 0.5 + 2.2 / Math.pow(2, Math.max(0, zoom - 1))));
    var placed = [];
    var frag = document.createDocumentFragment();
    var list = window.__PLACES__;
    for (var i = 0; i < list.length && placed.length < MAX_PLACES; i++) {
      var p = list[i];
      if (zoom < p[3]) continue;
      // Province names give way to towns once zoomed right in.
      if (p[0] === 2 && zoom > 10) continue;
      if (p[0] === 0 && zoom > 8) continue;
      if (globe) {
        var lat = (p[2] * Math.PI) / 180;
        var dot = Math.sin(cLat) * Math.sin(lat) + Math.cos(cLat) * Math.cos(lat) * Math.cos((p[1] * Math.PI) / 180 - cLng);
        if (dot < horizon) continue;
      }
      var xy = map.project([p[1], p[2]]);
      if (xy.x < -40 || xy.y < -20 || xy.x > w + 40 || xy.y > h + 20) continue;
      var text = placeName(p);
      var size = PLACE_SIZE[p[0]];
      var width = text.length * size * (text !== p[5] && (p[0] === 0 || p[0] === 2) ? 0.72 : 0.6) + (p[0] === 1 || p[0] >= 3 ? 12 : 0);
      var box = [xy.x - width / 2 - 4, xy.y - size, xy.x + width / 2 + 4, xy.y + size];
      // Whole labels only: one cut by the screen edge reads as a different word.
      if (box[0] < 2 || box[2] > w - 2 || box[1] < 2 || box[3] > h - 2) continue;
      var clash = false;
      for (var k = 0; k < placed.length; k++) {
        var b = placed[k];
        if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      placed.push(box);
      var el = document.createElement('div');
      // Khmer is not upper-cased or letter-spaced (spacing breaks its stacked letters).
      el.className = 'pl ' + PLACE_CLASS[p[0]] + (text === p[5] ? ' pl-km' : '');
      el.style.transform = 'translate(' + Math.round(xy.x) + 'px,' + Math.round(xy.y) + 'px) translate(-50%,-50%)';
      el.textContent = text;
      el.setAttribute('data-kind', String(p[0]));
      frag.appendChild(el);
    }
    placeLayer.appendChild(frag);
  }

  function schedulePlaces() {
    if (!placeFrame) placeFrame = window.requestAnimationFrame(renderPlaces);
  }

  function initPlaces() {
    placeLayer = document.createElement('div');
    placeLayer.className = 'places';
    placeLayer.setAttribute('aria-hidden', 'true');
    map.getCanvasContainer().appendChild(placeLayer);
    map.on('move', schedulePlaces);
    map.on('resize', schedulePlaces);
    renderPlaces();
  }

  window.__places = function () {
    return Array.prototype.map.call(document.querySelectorAll('.places .pl'), function (el) {
      return { text: el.textContent, kind: Number(el.getAttribute('data-kind')) };
    });
  };

  // ---------- labels and markers ----------

  function setLabels(labels) {
    labelMarkers.forEach(function (m) {
      m.remove();
    });
    labelMarkers = labels.map(function (l) {
      var el = document.createElement('div');
      el.className = 'seg-label';
      el.textContent = l.text;
      return new maplibregl.Marker({ element: el }).setLngLat(l.at).addTo(map);
    });
  }

  // Land zones over the imagery: each zone filled with its kind's colour and numbered.
  var zoneMarkers = [];
  function setZones(zones, selected) {
    zoneMarkers.forEach(function (m) {
      m.remove();
    });
    zoneMarkers = [];
    var features = zones
      .filter(function (z) {
        return z.ring.length >= 3;
      })
      .map(function (z) {
        return {
          type: 'Feature',
          properties: { id: z.id, color: z.color, selected: z.id === selected },
          geometry: { type: 'Polygon', coordinates: [z.ring.concat([z.ring[0]])] },
        };
      });
    map.getSource('zones').setData(fc(features));
    zones.forEach(function (z) {
      if (!z.label || z.ring.length < 3) return;
      var x = 0;
      var y = 0;
      z.ring.forEach(function (p) {
        x += p[0];
        y += p[1];
      });
      var el = document.createElement('div');
      el.className = 'zone-label' + (z.id === selected ? ' zone-label-on' : '');
      el.textContent = z.label;
      zoneMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([x / z.ring.length, y / z.ring.length]).addTo(map));
    });
    window.__zones = features.length;
  }

  function setSelected(point) {
    if (selectedMarker) selectedMarker.remove();
    selectedMarker = null;
    if (point) selectedMarker = new maplibregl.Marker({ color: '#c62828' }).setLngLat(point).addTo(map);
  }

  function setUserLocation(point, accuracyMeters) {
    if (userDot) userDot.remove();
    userDot = null;
    var src = map.getSource('accuracy');
    if (!point) {
      src.setData(fc([]));
      return;
    }
    var el = document.createElement('div');
    el.className = 'user-dot';
    userDot = new maplibregl.Marker({ element: el }).setLngLat(point).addTo(map);
    src.setData(
      accuracyMeters
        ? fc([{ type: 'Feature', properties: {}, geometry: circlePolygon(point, accuracyMeters, 64) }])
        : fc([]),
    );
  }

  function setBaseLayer(id) {
    Object.keys(config.baseLayers).forEach(function (key) {
      if (!config.baseLayers[key]) return;
      map.setLayoutProperty('base-' + key, 'visibility', key === id ? 'visible' : 'none');
    });
  }

  // ---------- elevation (Terrarium decoding: h = R*256 + G + B/256 - 32768) ----------

  function tileFor(lng, lat, z) {
    var n = Math.pow(2, z);
    var x = ((lng + 180) / 360) * n;
    var latRad = (lat * Math.PI) / 180;
    var y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    return { x: Math.floor(x), y: Math.floor(y), px: Math.floor((x % 1) * 256), py: Math.floor((y % 1) * 256) };
  }

  function queryElevation(requestId, point) {
    var z = config.elevationZoom;
    var t = tileFor(point[0], point[1], z);
    var url = config.terrain.tiles[0].replace('{z}', z).replace('{x}', t.x).replace('{y}', t.y);
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      })
      .then(function (blob) {
        return createImageBitmap(blob);
      })
      .then(function (bmp) {
        var canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        var d = ctx.getImageData(t.px, t.py, 1, 1).data;
        var meters = d[0] * 256 + d[1] + d[2] / 256 - 32768;
        post({ type: 'elevation', requestId: requestId, meters: Math.round(meters * 10) / 10 });
      })
      .catch(function (err) {
        post({ type: 'elevation', requestId: requestId, meters: null, error: String(err) });
      });
  }

  // ---------- command dispatch ----------

  function init(cfg) {
    if (!hasMapLibre) {
      showFailure('MapLibre did not load');
      return;
    }
    try {
      createMap(cfg);
    } catch (err) {
      map = null;
      showFailure(String((err && err.message) || err));
    }
  }

  function createMap(cfg) {
    config = cfg;
    map = new maplibregl.Map({
      container: 'map',
      style: buildStyle(cfg),
      center: cfg.center,
      zoom: cfg.zoom,
      attributionControl: { compact: true },
      maxPitch: 60,
      dragRotate: true,
      touchPitch: false,
    });
    window.__map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('move', onMove);
    map.on('moveend', function () {
      post({ type: 'viewChanged', view: viewState(), final: true });
    });
    map.on('click', onClick);
    map.on('mousedown', 'ring-vertex-hit', startDrag);
    map.on('touchstart', 'ring-vertex-hit', startDrag);
    map.on('mousemove', moveDrag);
    map.on('touchmove', moveDrag);
    map.on('mouseup', endDrag);
    map.on('touchend', endDrag);
    map.on('touchcancel', endDrag);
    map.on('mouseenter', 'ring-vertex-hit', function () {
      if (mode === 'measure') map.getCanvas().style.cursor = 'grab';
    });
    map.on('mouseleave', 'ring-vertex-hit', function () {
      if (dragIndex < 0) map.getCanvas().style.cursor = '';
    });
    map.on('error', function (e) {
      var source = (e && e.sourceId) || 'map';
      var now = Date.now();
      if (lastTileErrorAt[source] && now - lastTileErrorAt[source] < 5000) return;
      lastTileErrorAt[source] = now;
      post({ type: 'tileError', source: source });
    });
    map.on('load', function () {
      initPlaces();
      styleReady = true;
      window.__farmMapLoaded = true;
      pending.splice(0).forEach(function (fn) {
        fn();
      });
      post({ type: 'viewChanged', view: viewState(), final: true });
      post({ type: 'loaded' });
    });
  }

  // Commands that arrive before the first 'load' are queued. Do not use
  // map.loaded()/isStyleLoaded() here: both stay false while tiles are loading.
  var styleReady = false;
  var pending = [];

  function whenLoaded(fn) {
    if (styleReady) fn();
    else pending.push(fn);
  }

  function receive(msg) {
    if (typeof msg === 'string') msg = JSON.parse(msg);
    if (!msg || !msg.type) return;
    if (msg.type === 'init') {
      if (!map) init(msg.config);
      return;
    }
    if (msg.type === 'ping') {
      if (!map && !document.getElementById('map-failed')) post({ type: 'ready' });
      return;
    }
    if (!map) return;
    if (msg.type === 'tileData') {
      onTileData(msg);
      return;
    }
    if (msg.type === 'setInsets') {
      applyInsets(msg.top || 0, msg.bottom || 0);
      return;
    }
    whenLoaded(function () {
      switch (msg.type) {
        case 'flyTo':
          map.flyTo({
            center: msg.center,
            zoom: msg.zoom == null ? map.getZoom() : msg.zoom,
            duration: msg.duration == null ? 2500 : msg.duration,
            essential: true,
          });
          break;
        case 'fitBounds':
          map.fitBounds(
            [
              [msg.bbox[0], msg.bbox[1]],
              [msg.bbox[2], msg.bbox[3]],
            ],
            // Extra right padding keeps vertices clear of the zoom/compass buttons.
            { padding: { top: 60, bottom: 60, left: 60, right: 90 }, maxZoom: msg.maxZoom == null ? 16 : msg.maxZoom, duration: 2000 },
          );
          break;
        case 'zoomBy':
          map.easeTo({ zoom: map.getZoom() + msg.delta, duration: 300 });
          break;
        case 'setProjection':
          config.projection = msg.projection;
          map.setProjection({ type: msg.projection });
          schedulePlaces();
          break;
        case 'setBaseLayer':
          setBaseLayer(msg.id);
          break;
        case 'setOverlay':
          if (msg.id === 'places') {
            placesOn = msg.visible;
            renderPlaces();
          } else map.setLayoutProperty(msg.id, 'visibility', msg.visible ? 'visible' : 'none');
          break;
        case 'setPlaceLanguage':
          placeLanguage = msg.language;
          renderPlaces();
          break;
        case 'setSelected':
          setSelected(msg.point);
          break;
        case 'setUserLocation':
          setUserLocation(msg.point, msg.accuracyMeters);
          break;
        case 'setMode':
          mode = msg.mode;
          map.doubleClickZoom[mode === 'measure' ? 'disable' : 'enable']();
          break;
        case 'setRing':
          ring = msg.points.slice();
          ringClosed = !!msg.closed && ring.length >= 3;
          renderRing();
          break;
        case 'closeRing':
          if (ring.length >= 3) {
            ringClosed = true;
            renderRing();
            emitRing();
          }
          break;
        case 'setZones':
          setZones(msg.zones, msg.selected == null ? null : msg.selected);
          break;
        case 'setLabels':
          setLabels(msg.labels);
          break;
        case 'queryElevation':
          queryElevation(msg.requestId, msg.point);
          break;
      }
    });
  }

  // Keep the map's own buttons and attribution clear of app UI floating over the map,
  // and centre the camera in the part of the map that is still visible.
  function applyInsets(top, bottom) {
    var set = function (sel, prop, px) {
      var el = document.querySelector(sel);
      if (el) el.style[prop] = px + 'px';
    };
    set('.maplibregl-ctrl-top-right', 'marginTop', top);
    set('.maplibregl-ctrl-top-left', 'marginTop', top);
    set('.maplibregl-ctrl-bottom-right', 'marginBottom', bottom);
    set('.maplibregl-ctrl-bottom-left', 'marginBottom', bottom);
    whenLoaded(function () {
      map.easeTo({ padding: { top: top, bottom: bottom, left: 0, right: 0 }, duration: 350 });
    });
  }

  window.farmMap = { receive: receive };
  window.addEventListener('message', function (e) {
    if (e.data && e.data.__farmMapCommand) receive(e.data.data);
  });
  // react-native-webview delivers postMessage on document for Android.
  document.addEventListener('message', function (e) {
    receive(e.data);
  });

  post({ type: 'ready' });
})();
