import { pointInRing } from '../env/rasters';
import world from '../map/web/world-110m.json';
import type { LatLng } from './types';

type Polygon = [number, number][][];
interface Feature {
  properties: { name: string; iso3: string };
  geometry: { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: Polygon[] };
}

const ring = (r: [number, number][]): LatLng[] => r.map(([longitude, latitude]) => ({ latitude, longitude }));

const COUNTRIES = (world.features as unknown as Feature[]).map((f) => ({
  iso3: f.properties.iso3,
  // Outer rings only: the 1:110m outline has no holes that matter for farmland.
  rings: (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => ring(p[0])),
}));

/**
 * ISO 3166 alpha-3 code of the country containing a point, from the bundled Natural
 * Earth 1:110m outline (offline). The outline is coarse, so points within a few
 * kilometres of a border or on small islands may get no country or the neighbour's.
 */
export function countryAt(p: LatLng): string | null {
  for (const c of COUNTRIES) if (c.rings.some((r) => pointInRing(p, r))) return c.iso3;
  return null;
}
