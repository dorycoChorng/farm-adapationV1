import { Platform } from 'react-native';

import { type FetchJson, fetchJson } from './analyze';
import { type FetchRange, fetchRange } from './tiff';

/**
 * Hosts the web build reads through its own origin, because they send no CORS
 * headers (WorldCover, FAO GAEZ, Planetary Computer storage, NASA POWER).
 * vercel.json rewrites these paths in production; metro.config.js does it in
 * development. Native apps are not subject to CORS and call the hosts directly.
 */
export const WEB_PROXIES: Record<string, string> = {
  'https://esa-worldcover.s3.eu-central-1.amazonaws.com/': '/worldcover/',
  'https://storage.googleapis.com/fao-gismgr-gaez-v5-data/': '/gaez/',
  // NASA's NASADEM elevation on Microsoft Planetary Computer, and its read-token service.
  'https://nasademeuwest.blob.core.windows.net/nasadem-cog/': '/nasadem/',
  'https://planetarycomputer.microsoft.com/api/sas/': '/pc-sas/',
  'https://planetarycomputer.microsoft.com/api/data/': '/pc-data/',
  // NASA POWER: the map's rainfall and sunlight grids, cached a day by Vercel.
  'https://power.larc.nasa.gov/': '/power/',
};

export function webUrl(url: string) {
  for (const [host, path] of Object.entries(WEB_PROXIES)) if (url.startsWith(host)) return path + url.slice(host.length);
  return url;
}

const isWeb = Platform.OS === 'web';

/** Range fetcher used by the app (land cover, terrain, crop statistics). */
export const appFetchRange: FetchRange = isWeb ? (url, start, end) => fetchRange(webUrl(url), start, end) : fetchRange;

/** JSON fetcher used by the app (climate, soil). */
export const appFetchJson: FetchJson = isWeb ? (url, signal, options) => fetchJson(webUrl(url), signal, options) : fetchJson;
