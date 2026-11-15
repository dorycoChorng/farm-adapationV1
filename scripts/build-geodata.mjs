// Builds the offline geodata bundled with the app from Natural Earth 1:110m
// (public domain, https://www.naturalearthdata.com/about/terms-of-use/).
// Inputs are committed under scripts/data/; run `node scripts/build-geodata.mjs` after updating them.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = JSON.parse(readFileSync(join(root, 'scripts/data/ne_110m_admin_0_countries.geojson'), 'utf8'));
// Khmer names: Unicode CLDR via the i18n-iso-countries package (MIT).
const km = JSON.parse(readFileSync(join(root, 'scripts/data/countries-km.json'), 'utf8')).names;
const iso3Of = (p) => (p.ISO_A3_EH !== '-99' ? p.ISO_A3_EH : p.ADM0_A3);

const round = (n) => Math.round(n * 100) / 100;
const roundCoords = (c) => (typeof c[0] === 'number' ? [round(c[0]), round(c[1])] : c.map(roundCoords));

const countries = src.features
  .map((f) => {
    const p = f.properties;
    const iso2 = p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
    const iso3 = iso3Of(p);
    return {
      name: p.NAME,
      nameLong: p.NAME_LONG,
      iso2: iso2 === '-99' ? null : iso2,
      iso3,
      ...(km[iso2] ? { km: km[iso2] } : {}),
      bbox: f.bbox.map(round),
      label: [round(p.LABEL_X), round(p.LABEL_Y)],
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(join(root, 'src/data/countries.json'), JSON.stringify(countries) + '\n');

const outline = {
  type: 'FeatureCollection',
  features: src.features.map((f) => ({
    type: 'Feature',
    properties: { name: f.properties.NAME, iso3: iso3Of(f.properties) },
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
  })),
};
writeFileSync(join(root, 'src/map/web/world-110m.json'), JSON.stringify(outline) + '\n');

console.log(`countries: ${countries.length}`);
