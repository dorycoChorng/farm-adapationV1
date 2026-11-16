/**
 * Map layer catalogue. Each entry records provider, licence and attribution so
 * the app never shows imagery without its source.
 */
export type BaseLayerId = 'satellite-s2' | 'outline';
export type OverlayId = 'places' | 'hillshade' | 'boundaries' | 'landcover' | 'waterflow' | 'rainfall' | 'sunlight';

export interface RasterProvider {
  tiles: string[];
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  attribution: string;
}

export interface BaseLayerDef {
  id: BaseLayerId;
  provider: RasterProvider | null;
  licence: string;
  notes: string;
}

export const BASE_LAYERS: Record<BaseLayerId, BaseLayerDef> = {
  'satellite-s2': {
    id: 'satellite-s2',
    provider: {
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256,
      minzoom: 0,
      // Sentinel-2 is 10 m/pixel; beyond z14 tiles are only upscaled.
      maxzoom: 14,
      attribution:
        '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)',
    },
    licence: 'CC BY 4.0 (2016 edition). Later editions are CC BY-NC-SA 4.0 and need a commercial licence for commercial use.',
    notes: '10 m resolution cloud-free mosaic from 2016. Good for orientation; too coarse to trace small field edges precisely.',
  },
  outline: {
    id: 'outline',
    provider: null,
    licence: 'Natural Earth, public domain.',
    notes: 'Bundled country outlines at 1:110m scale. Works offline; no imagery.',
  },
};

/**
 * Terrain for the map (terrain shading, the water-flow layer, tap-for-elevation): NASA's
 * NASADEM rendered as Terrarium tiles by the Planetary Computer data API. The map page
 * serves them through its own farmdem:// protocol (src/map/web/map-app.js) so it can fall
 * back to AWS Terrain Tiles where Planetary Computer has none (zoomed far out, beyond
 * 60° N / 56° S) or can't be reached.
 */
export interface TerrainSource extends RasterProvider {
  encoding: 'terrarium';
  /** Planetary Computer data API base URL; mapConfig.ts fills in the web proxy path. */
  planetary: { dataApi: string; collection: 'nasadem'; asset: 'elevation'; minzoom: number } | null;
  /** Used where Planetary Computer has no tile. */
  fallbackTiles: string[];
}

export const TERRAIN_DEM: TerrainSource = {
  tiles: ['farmdem://{z}/{x}/{y}'],
  tileSize: 256,
  minzoom: 0,
  // NASADEM is 30 m; beyond z13 the map only upscales.
  maxzoom: 13,
  encoding: 'terrarium',
  attribution:
    'NASADEM (NASA/JPL) via <a href="https://planetarycomputer.microsoft.com/">Microsoft Planetary Computer</a>; backup <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> (AWS Open Data)',
  planetary: { dataApi: 'https://planetarycomputer.microsoft.com/api/data/v1/', collection: 'nasadem', asset: 'elevation', minzoom: 7 },
  fallbackTiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
};

/** Zoom used for point elevation lookups; ~38 m/pixel at the equator. Source DEMs are 30–90 m in most farmland. */
export const ELEVATION_LOOKUP_ZOOM = 12;

/**
 * Land-cover overlay, drawn from ESA WorldCover 2021 v200 (10 m, CC BY 4.0). The bucket
 * sends no CORS headers, so the app reads the files and hands class codes to the map page.
 */
export const LAND_COVER_OVERLAY = {
  minzoom: 7,
  maxzoom: 14,
  attribution:
    '<a href="https://esa-worldcover.org">ESA WorldCover 2021</a> v200 (CC BY 4.0), © ESA WorldCover project / contains modified Copernicus Sentinel data (2021)',
  licence: 'CC BY 4.0',
};

/**
 * Water flow anywhere in the world, worked out in the map page from the terrain tiles
 * (src/map/web/map-app.js). Shown from about district zoom, where 30 m elevation can
 * pick out the small streams and gullies that matter on a farm.
 */
export const WATER_FLOW_OVERLAY = { minzoom: 10 };

/** Rainfall and sunlight overlays (NASA POWER, src/env/climateGrid.ts) show from about country zoom. */
export const CLIMATE_OVERLAY = { minzoom: 5, attribution: '<a href="https://power.larc.nasa.gov/">NASA POWER</a> climatology' };
