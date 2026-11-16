import type { FetchJson } from './analyze';

/**
 * Microsoft Planetary Computer: where the app reads NASA's NASADEM elevation.
 * The raw files sit in Azure storage and need a short-lived read token (SAS) that the
 * Planetary Computer hands out for free; the map's terrain tiles come from its data API
 * (src/map/web/map-app.js), which renders the same NASADEM files.
 */

/** NASADEM cloud-optimised GeoTIFFs: 1°×1° tiles at 1 arc-second, named by their south-west corner. */
export const NASADEM_BASE = 'https://nasademeuwest.blob.core.windows.net/nasadem-cog/v001/';
export const PC_SAS_URL = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/nasademeuwest/nasadem-cog';
/** NASADEM covers 60° N to 56° S; the app falls back to AWS Terrain Tiles elsewhere or when offline. */
export const NASADEM_LAT = [-56, 60] as const;

export function nasademTileName(lat: number, lon: number) {
  const la = Math.floor(lat);
  const lo = Math.floor(lon);
  const ns = (la < 0 ? 's' : 'n') + String(Math.abs(la)).padStart(2, '0');
  const ew = (lo < 0 ? 'w' : 'e') + String(Math.abs(lo)).padStart(3, '0');
  return `NASADEM_HGT_${ns}${ew}.tif`;
}

let token: { value: string; expires: number } | null = null;

/** A Planetary Computer read token, reused until five minutes before it expires. */
export async function planetaryToken(getJson: FetchJson): Promise<string> {
  if (token && token.expires - Date.now() > 5 * 60_000) return token.value;
  const body = (await getJson(PC_SAS_URL, undefined, { timeoutMs: 15000 })) as { token?: string; 'msft:expiry'?: string };
  if (!body?.token) throw new Error('no Planetary Computer token');
  const expires = Date.parse(body['msft:expiry'] ?? '') || Date.now() + 30 * 60_000;
  token = { value: body.token, expires };
  return body.token;
}

/** URL of the NASADEM file holding a point, signed with a read token. */
export const nasademUrl = (lat: number, lon: number, sas: string) => `${NASADEM_BASE}${nasademTileName(lat, lon)}?${sas}`;
