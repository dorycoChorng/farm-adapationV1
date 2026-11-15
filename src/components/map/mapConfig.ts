import type { LngLat, MapInitConfig, Projection } from '../../map/bridge';
import { LAND_COVER_CLASSES } from '../../env/sources';
import { BASE_LAYERS, ELEVATION_LOOKUP_ZOOM, LAND_COVER_OVERLAY, TERRAIN_DEM } from '../../map/layers';

export function buildMapConfig(initial: { center: LngLat; zoom: number; projection: Projection }): MapInitConfig {
  return {
    ...initial,
    baseLayers: Object.fromEntries(Object.values(BASE_LAYERS).map((l) => [l.id, l.provider])),
    terrain: TERRAIN_DEM,
    elevationZoom: ELEVATION_LOOKUP_ZOOM,
    landCover: {
      minzoom: LAND_COVER_OVERLAY.minzoom,
      maxzoom: LAND_COVER_OVERLAY.maxzoom,
      attribution: LAND_COVER_OVERLAY.attribution,
      colors: Object.fromEntries(Object.entries(LAND_COVER_CLASSES).map(([code, c]) => [code, c.color])),
    },
  };
}
