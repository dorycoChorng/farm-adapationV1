import Constants from 'expo-constants';

import { createGeocoder } from './search/geocoder';

interface ExtraConfig {
  geocoderBaseUrl?: string;
  geocoderUserAgent?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

/**
 * Place search. Defaults to the public OSM Nominatim service, which is fine for
 * development and light use; set `expo.extra.geocoderBaseUrl` to your own proxy
 * or Nominatim instance for production.
 */
export const geocode = createGeocoder({
  baseUrl: extra.geocoderBaseUrl ?? 'https://nominatim.openstreetmap.org',
  userAgent: extra.geocoderUserAgent ?? 'FarmAdaptationApp/1.0 (https://github.com/dorycoChorng/Farm-Adaptation-App)',
});
