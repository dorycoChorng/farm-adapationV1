import { Platform } from 'react-native';

import type { LngLat, MapInitConfig, Projection } from '../../map/bridge';
import { LAND_COVER_CLASSES } from '../../env/sources';
import { BASE_LAYERS, ELEVATION_LOOKUP_ZOOM, LAND_COVER_OVERLAY, TERRAIN_DEM } from '../../map/layers';

export function buildMapConfig(initial: { center: LngLat; zoom: number; projection: Projection }): MapInitConfig {
  return {
    ...initial,
    baseLayers: Object.fromEntries(Object.values(BASE_LAYERS).map((l) => [l.id, l.provider])),
    terrain: {
      ...TERRAIN_DEM,
      // The web build reads Planetary Computer through its own origin (vercel.json, metro.config.js).
      planetary:
        TERRAIN_DEM.planetary && Platform.OS === 'web' && typeof window !== 'undefined'
          ? { ...TERRAIN_DEM.planetary, dataApi: `${window.location.origin}/pc-data/v1/` }
          : TERRAIN_DEM.planetary,
    },
    elevationZoom: ELEVATION_LOOKUP_ZOOM,
    landCover: {
      minzoom: LAND_COVER_OVERLAY.minzoom,
      maxzoom: LAND_COVER_OVERLAY.maxzoom,
      attribution: LAND_COVER_OVERLAY.attribution,
      colors: Object.fromEntries(Object.entries(LAND_COVER_CLASSES).map(([code, c]) => [code, c.color])),
    },
  };
}
