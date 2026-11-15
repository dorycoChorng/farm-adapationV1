import { Platform } from 'react-native';

import type { LngLat, MapInitConfig, Projection } from '../../map/bridge';
import { LAND_COVER_CLASSES } from '../../env/sources';
import { CLIMATE_STOPS } from '../../env/climateGrid';
import { BASE_LAYERS, CLIMATE_OVERLAY, ELEVATION_LOOKUP_ZOOM, LAND_COVER_OVERLAY, SOIL_OVERLAY, TERRAIN_DEM } from '../../map/layers';

const web = Platform.OS === 'web' && typeof window !== 'undefined';

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
    soil: {
      ...SOIL_OVERLAY,
      // ISRIC's map service sends no CORS headers we can rely on; the web build reads it through its own origin.
      tiles: web ? SOIL_OVERLAY.tiles.map((u) => u.replace('https://maps.isric.org/', `${window.location.origin}/isric-maps/`)) : SOIL_OVERLAY.tiles,
    },
    climate: { attribution: CLIMATE_OVERLAY.attribution, stops: CLIMATE_STOPS },
    landCover: {
      minzoom: LAND_COVER_OVERLAY.minzoom,
      maxzoom: LAND_COVER_OVERLAY.maxzoom,
      attribution: LAND_COVER_OVERLAY.attribution,
      colors: Object.fromEntries(Object.entries(LAND_COVER_CLASSES).map(([code, c]) => [code, c.color])),
    },
  };
}
