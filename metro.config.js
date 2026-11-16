// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite on web loads SQLite as WebAssembly.
config.resolver.assetExts.push('wasm');

// ESA WorldCover, FAO GAEZ, NASA POWER and Planetary Computer storage can't be read from a browser on another origin, so the
// web build reads them through paths on its own origin (src/env/appFetch.ts).
// vercel.json does this in production; this does it in development.
const PROXIES = {
  '/worldcover/': 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/',
  '/gaez/': 'https://storage.googleapis.com/fao-gismgr-gaez-v5-data/',
  '/nasadem/': 'https://nasademeuwest.blob.core.windows.net/nasadem-cog/',
  '/pc-sas/': 'https://planetarycomputer.microsoft.com/api/sas/',
  '/pc-data/': 'https://planetarycomputer.microsoft.com/api/data/',
  '/power/': 'https://power.larc.nasa.gov/',
};
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
  });
}
async function proxy(req, res, path) {
  try {
    // Planetary Computer's mosaic registration is a POST with a JSON body.
    const post = req.method === 'POST';
    const up = await fetch(PROXIES[path] + req.url.slice(path.length), {
      method: post ? 'POST' : 'GET',
      body: post ? await readBody(req) : undefined,
      headers: {
        ...(req.headers.range ? { Range: req.headers.range } : {}),
        ...(post && req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
        Accept: req.headers.accept ?? '*/*',
      },
    });
    const headers = {};
    for (const h of ['content-type', 'content-range', 'accept-ranges']) if (up.headers.get(h)) headers[h] = up.headers.get(h);
    res.writeHead(up.status, headers);
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch {
    res.writeHead(502);
    res.end();
  }
}

// expo-sqlite on web needs SharedArrayBuffer, which requires cross-origin isolation.
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  const path = Object.keys(PROXIES).find((p) => req.url?.startsWith(p));
  if (path) return void proxy(req, res, path);
  middleware(req, res, next);
};

module.exports = config;
