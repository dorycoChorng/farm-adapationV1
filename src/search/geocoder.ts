import type { PlaceResult } from './types';

/**
 * Client for an OpenStreetMap Nominatim-compatible geocoder.
 *
 * The public nominatim.openstreetmap.org service allows at most one request per
 * second, forbids autocomplete-style querying and requires an identifying
 * User-Agent. This client only searches when the user submits, and spaces
 * requests at least {@link MIN_INTERVAL_MS} apart. For production traffic point
 * `baseUrl` at your own backend proxy or a commercial geocoder.
 */
export const MIN_INTERVAL_MS = 1100;

export interface GeocoderConfig {
  baseUrl: string;
  userAgent: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class GeocoderError extends Error {
  constructor(
    readonly kind: 'network' | 'http' | 'parse' | 'rate-limited',
    message: string,
  ) {
    super(message);
    this.name = 'GeocoderError';
  }
}

interface NominatimItem {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  type?: string;
  addresstype?: string;
  category?: string;
  boundingbox?: [string, string, string, string];
}

export function parseNominatim(items: unknown): PlaceResult[] {
  if (!Array.isArray(items)) throw new GeocoderError('parse', 'Unexpected geocoder response');
  const out: PlaceResult[] = [];
  for (const raw of items as NominatimItem[]) {
    const latitude = Number(raw.lat);
    const longitude = Number(raw.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    // Nominatim boundingbox is [south, north, west, east].
    const bb = raw.boundingbox?.map(Number);
    const bbox: PlaceResult['bbox'] =
      bb && bb.length === 4 && bb.every(Number.isFinite) ? [bb[2], bb[0], bb[3], bb[1]] : null;
    out.push({
      id: `nominatim:${raw.place_id}`,
      name: raw.name || raw.display_name.split(',')[0],
      displayName: raw.display_name,
      latitude,
      longitude,
      bbox,
      kind: raw.addresstype || raw.type || raw.category || 'place',
      source: 'nominatim',
    });
  }
  return out;
}

export function createGeocoder(config: GeocoderConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastRequestAt = -Infinity;

  return async function search(
    query: string,
    { language = 'en', limit = 10, signal }: { language?: string; limit?: number; signal?: AbortSignal } = {},
  ): Promise<PlaceResult[]> {
    const q = query.trim();
    if (!q) return [];

    const wait = lastRequestAt + MIN_INTERVAL_MS - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();

    const url =
      `${config.baseUrl.replace(/\/$/, '')}/search?format=jsonv2&addressdetails=0` +
      `&limit=${limit}&q=${encodeURIComponent(q)}&accept-language=${encodeURIComponent(language)}`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': config.userAgent },
        signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new GeocoderError('network', String(e));
    }
    if (response.status === 429) throw new GeocoderError('rate-limited', 'Geocoder rate limit reached');
    if (!response.ok) throw new GeocoderError('http', `Geocoder returned HTTP ${response.status}`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GeocoderError('parse', 'Geocoder returned invalid JSON');
    }
    return parseNominatim(body);
  };
}

export type Geocoder = ReturnType<typeof createGeocoder>;
