/**
 * Every outside source the app uses, for the "Sources and credits" screen and the
 * README. NASA Space Apps asks teams to cite every source, even open ones, and to use
 * only material that is freely and publicly available or open-source licensed; each
 * entry here is one of those. `use` is a translation key (credits.use.<id>).
 */

export type CreditGroup = 'data' | 'map' | 'media' | 'software' | 'help';

export interface Credit {
  id: string;
  group: CreditGroup;
  name: string;
  /** Who makes or hosts it. */
  by: string;
  licence: string;
  url: string;
}

export const CREDITS: Credit[] = [
  // Data used in the land analysis and crop advice.
  { id: 'power', group: 'data', name: 'NASA POWER', by: 'NASA Langley Research Center', licence: 'Public domain (NASA open data)', url: 'https://power.larc.nasa.gov/' },
  {
    id: 'nasadem',
    group: 'data',
    name: 'NASADEM',
    by: 'NASA / JPL, hosted by Microsoft Planetary Computer',
    licence: 'NASA open data',
    url: 'https://planetarycomputer.microsoft.com/dataset/nasadem',
  },
  {
    id: 'terrain',
    group: 'data',
    name: 'Terrain Tiles (SRTM)',
    by: 'AWS Open Data, Mapzen / Tilezen',
    licence: 'Open data, attribution required',
    url: 'https://registry.opendata.aws/terrain-tiles/',
  },
  { id: 'worldcover', group: 'data', name: 'ESA WorldCover 2021 v200', by: 'European Space Agency', licence: 'CC BY 4.0', url: 'https://esa-worldcover.org/' },
  { id: 'gaez', group: 'data', name: 'GAEZ v5 (from FAOSTAT)', by: 'FAO and IIASA', licence: 'CC BY 4.0', url: 'https://github.com/un-fao/gaezv5/wiki' },
  {
    id: 'ecocrop',
    group: 'data',
    name: 'FAO ECOCROP crop requirements',
    by: 'FAO, via the ecocrop Python package (MIT); method after Hijmans, R package Recocrop (GPL-3)',
    licence: 'MIT (ecocrop package)',
    url: 'https://pypi.org/project/ecocrop/',
  },
  { id: 'dismo', group: 'data', name: 'English crop names', by: 'ECOCROP, via the R package dismo', licence: 'GPL-3', url: 'https://cran.r-project.org/package=dismo' },
  { id: 'soiltest', group: 'data', name: 'Your own soil test', by: 'Entered by you', licence: 'Stays on your device', url: '' },

  // Map.
  {
    id: 's2',
    group: 'map',
    name: 'Sentinel-2 cloudless 2016',
    by: 'EOX IT Services (contains modified Copernicus Sentinel data 2016)',
    licence: 'CC BY 4.0',
    url: 'https://s2maps.eu',
  },
  { id: 'naturalearth', group: 'map', name: 'Natural Earth', by: 'Natural Earth', licence: 'Public domain', url: 'https://www.naturalearthdata.com' },
  { id: 'soilgrids', group: 'map', name: 'SoilGrids 2.0 (soil pH layer)', by: 'ISRIC – World Soil Information', licence: 'CC BY 4.0', url: 'https://soilgrids.org' },
  {
    id: 'nominatim',
    group: 'map',
    name: 'Nominatim place search',
    by: 'OpenStreetMap Foundation; data © OpenStreetMap contributors',
    licence: 'ODbL (data)',
    url: 'https://nominatim.openstreetmap.org',
  },

  // Photos and other media.
  {
    id: 'commons',
    group: 'media',
    name: 'Wikimedia Commons, via Wikipedia',
    by: 'Each photographer, credited under the photo',
    licence: 'Free licences (CC BY, CC BY-SA, CC0, public domain)',
    url: 'https://commons.wikimedia.org',
  },
  { id: 'currency', group: 'media', name: 'Exchange rates (currency-api)', by: 'Fawaz Ahmed', licence: 'CC0', url: 'https://github.com/fawazahmed0/exchange-api' },
  { id: 'countrycurrency', group: 'media', name: 'country-to-currency', by: 'Open-source package', licence: 'MIT', url: 'https://www.npmjs.com/package/country-to-currency' },

  // Open-source software the app is built with.
  { id: 'expo', group: 'software', name: 'Expo, React Native, Expo Router', by: 'Expo and Meta', licence: 'MIT', url: 'https://expo.dev' },
  { id: 'maplibre', group: 'software', name: 'MapLibre GL JS', by: 'MapLibre', licence: 'BSD-3-Clause', url: 'https://maplibre.org' },
  { id: 'webview', group: 'software', name: 'react-native-webview', by: 'React Native Community', licence: 'MIT', url: 'https://github.com/react-native-webview/react-native-webview' },
  { id: 'geodesic', group: 'software', name: 'GeographicLib', by: 'Charles Karney', licence: 'MIT', url: 'https://geographiclib.sourceforge.io' },
  { id: 'pako', group: 'software', name: 'pako', by: 'Nodeca', licence: 'MIT and Zlib', url: 'https://github.com/nodeca/pako' },
  { id: 'vercel', group: 'software', name: 'Vercel (hosting and web analytics)', by: 'Vercel', licence: '@vercel/analytics: MIT', url: 'https://vercel.com' },

  // Help.
  { id: 'ai', group: 'help', name: 'Claude (AI assistant)', by: 'Anthropic', licence: 'Used to help write and review code', url: 'https://claude.ai' },
];

export const CREDIT_GROUPS: CreditGroup[] = ['data', 'map', 'media', 'software', 'help'];
