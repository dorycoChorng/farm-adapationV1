import type { SourceId, SourceInfo } from './types';

/**
 * Every data source the analysis reads. None needs an API key, so no credentials ship
 * in the app; if a keyed source is added later it must go through a backend proxy.
 */
export const SOURCES: Record<SourceId, SourceInfo> = {
  'nasa-power': {
    id: 'nasa-power',
    name: 'NASA POWER',
    provider: 'NASA Langley Research Center',
    url: 'https://power.larc.nasa.gov/',
    licence: 'Public domain (NASA); credit "NASA POWER Project"',
    kind: 'reanalysis-model',
    resolution: '0.5° × 0.625° (about 55 × 70 km)',
    period: 'Long-term monthly averages; yearly totals for recent complete years',
    confidence: 'medium',
    limitationKey: 'src.power.limits',
  },
  soilgrids: {
    id: 'soilgrids',
    name: 'SoilGrids 2.0',
    provider: 'ISRIC – World Soil Information',
    url: 'https://soilgrids.org/',
    licence: 'CC BY 4.0',
    kind: 'statistical-model',
    resolution: '250 m',
    period: 'Model released 2020, built from soil profiles collected over many decades',
    confidence: 'low',
    limitationKey: 'src.soilgrids.limits',
  },
  'aws-terrain': {
    id: 'aws-terrain',
    // Key kept as 'aws-terrain' so analyses saved earlier still load; NASADEM is read first now.
    name: 'NASADEM (NASA) via Microsoft Planetary Computer',
    provider: 'NASA/JPL, hosted by Microsoft Planetary Computer; AWS Terrain Tiles as backup',
    url: 'https://planetarycomputer.microsoft.com/api/stac/v1/collections/nasadem',
    licence: 'NASA open data; backup Terrain Tiles under mixed open licences',
    kind: 'elevation-model',
    resolution: '1 arc-second (about 30 m)',
    period: 'SRTM radar, February 2000, reprocessed by NASA in 2020',
    confidence: 'medium',
    limitationKey: 'src.terrain.limits',
  },
  'esa-worldcover': {
    id: 'esa-worldcover',
    name: 'ESA WorldCover 2021 v200',
    provider: 'European Space Agency',
    url: 'https://esa-worldcover.org/',
    licence: 'CC BY 4.0 – © ESA WorldCover project 2021, contains modified Copernicus Sentinel data (2021)',
    kind: 'satellite-classification',
    resolution: '10 m',
    period: 'Imagery from 2021',
    confidence: 'medium',
    limitationKey: 'src.worldcover.limits',
  },
  hwsd: {
    id: 'hwsd',
    name: 'Harmonized World Soil Database v2.0',
    provider: 'FAO and IIASA',
    url: 'https://www.fao.org/soils-portal/data-hub/soil-maps-and-databases/harmonized-world-soil-database-v20/en/',
    licence: 'CC BY 4.0',
    kind: 'soil-map',
    resolution: '30 arc-seconds (about 1 km) grid; Cambodian soil units come from coarse regional maps',
    period: 'Released 2023, compiled from national and regional soil maps and profiles',
    confidence: 'low',
    limitationKey: 'src.hwsd.limits',
  },
  gaez: {
    id: 'gaez',
    name: 'GAEZ v5 – Actual yields and production',
    provider: 'FAO and IIASA (from FAOSTAT statistics)',
    url: 'https://github.com/un-fao/gaezv5/wiki',
    licence: 'CC BY 4.0',
    kind: 'statistics',
    resolution: '5 arc-minutes (about 10 km); country totals',
    period: 'Year 2020 (FAOSTAT averages 2019–2021); prices are 2014–2016 international dollars',
    confidence: 'medium',
    limitationKey: 'src.gaez.limits',
  },
};

/** ESA WorldCover class codes and their translation keys. */
export const LAND_COVER_CLASSES: Record<number, { key: string; color: string }> = {
  10: { key: 'lc.tree', color: '#006400' },
  20: { key: 'lc.shrub', color: '#ffbb22' },
  30: { key: 'lc.grass', color: '#ffff4c' },
  40: { key: 'lc.crop', color: '#f096ff' },
  50: { key: 'lc.built', color: '#fa0000' },
  60: { key: 'lc.bare', color: '#b4b4b4' },
  70: { key: 'lc.snow', color: '#f0f0f0' },
  80: { key: 'lc.water', color: '#0064c8' },
  90: { key: 'lc.wetland', color: '#0096a0' },
  95: { key: 'lc.mangrove', color: '#00cf75' },
  100: { key: 'lc.moss', color: '#fae6a0' },
};

/** Analyses older than this get a "data may be out of date" warning. */
export const STALE_AFTER_DAYS = 180;
