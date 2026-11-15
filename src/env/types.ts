import type { LatLng } from '../geo/types';

export type SourceId = 'nasa-power' | 'soilgrids' | 'aws-terrain' | 'esa-worldcover' | 'hwsd' | 'gaez';
export type Confidence = 'high' | 'medium' | 'low';

/** One section of an analysis either holds data, or says why it has none. */
export type Section<T> =
  | { status: 'ok'; source: SourceId; fetchedAt: string; data: T }
  | { status: 'no-data'; source: SourceId; fetchedAt: string; reason: string }
  | { status: 'error'; source: SourceId; fetchedAt: string; reason: string };

export interface ClimateData {
  /** Long-term monthly averages, January first. Null where the source returned its fill value. */
  monthlyRainMm: (number | null)[];
  annualRainMm: number | null;
  monthlySolarKwhM2Day: (number | null)[];
  annualSolarKwhM2Day: number | null;
  monthlyTempC: (number | null)[];
  annualTempC: number | null;
  annualTempMaxC: number | null;
  annualTempMinC: number | null;
  /** Averaging period as reported by the source, e.g. "2001–2020". */
  period: string;
}

export interface RainHistory {
  years: { year: number; totalMm: number }[];
}

export interface SoilProperty {
  key: 'phh2o' | 'soc' | 'clay' | 'sand' | 'silt' | 'nitrogen' | 'cec';
  /** Depth-weighted 0–30 cm values in display units. */
  mean: number | null;
  low: number | null;
  high: number | null;
  unit: string;
}

export interface SoilData {
  depth: string;
  properties: SoilProperty[];
  textureClass: string | null;
}

export interface TerrainData {
  elevationM: number;
  slopeDeg: number | null;
  cellSizeM: number;
}

export interface LandCoverData {
  /** ESA WorldCover class code at the point (or parcel centre). */
  classAtPoint: number | null;
  /** Share of sampled pixels per class inside the parcel; a single entry for a point. */
  fractions: { code: number; fraction: number }[];
  samples: number;
}

/** HWSD v2 dominant soil of the mapping unit at a point (topsoil, 0–20 cm). */
export interface HwsdData {
  unitId: number;
  /** WRB soil group, e.g. "Acrisols". */
  soil: string | null;
  /** Share of the mapping unit this soil covers. */
  sharePct: number | null;
  texture: string | null;
  drainage: string | null;
  ph: number | null;
  organicCarbonPct: number | null;
  clayPct: number | null;
  sandPct: number | null;
  siltPct: number | null;
  /** Cation exchange capacity, cmol(+)/kg. */
  cec: number | null;
  baseSaturationPct: number | null;
  nitrogenGKg: number | null;
}

/** Crops grown in the ~10 km GAEZ cell around a place (FAOSTAT 2019–2021, spread over cropland). */
export interface LocalProductionData {
  country: string | null;
  cellAreaHa: number;
  /** Harvested area of all crops in the cell, ha. */
  harvestedHa: number;
  crops: {
    code: string;
    harvestedHa: number;
    /** Share of the cell's harvested area. */
    share: number;
    /** t/ha, read for the biggest crops only. */
    yieldT: number | null;
    /** Yield × FAO international price, I$ (2014–2016) per ha. */
    valuePerHa: number | null;
  }[];
}

export type ZoneKind = 'cropland' | 'open' | 'low' | 'wet' | 'steep' | 'tree' | 'water' | 'built' | 'no-data';

export interface Zone {
  row: number;
  col: number;
  centre: LatLng;
  /** Share of the zone's sample points inside the parcel (1 for a full square). */
  coverage: number;
  landCover: { code: number; fraction: number }[];
  elevationM: number | null;
  slopeDeg: number | null;
  kind: ZoneKind;
}

export interface ZoneData {
  /** [west, south, east, north] of the gridded area. */
  bbox: [number, number, number, number];
  rows: number;
  cols: number;
  cellWidthM: number;
  cellHeightM: number;
  /** The drawn parcel, or a square around the point when no parcel was drawn. */
  area: 'parcel' | 'square';
  zones: Zone[];
}

export interface EnvSummary {
  version: 1;
  location: LatLng;
  /** Boundary used for land-cover sampling, when the analysis is for a parcel. */
  ring: LatLng[] | null;
  createdAt: string;
  climate: Section<ClimateData>;
  rainHistory: Section<RainHistory>;
  soil: Section<SoilData>;
  terrain: Section<TerrainData>;
  landCover: Section<LandCoverData>;
  /** Added after the first release; absent in analyses saved before then. */
  hwsd?: Section<HwsdData>;
  production?: Section<LocalProductionData>;
  zones?: Section<ZoneData>;
}

export interface SourceInfo {
  id: SourceId;
  name: string;
  provider: string;
  url: string;
  licence: string;
  /** What the numbers are: modelled, reanalysis, satellite classification, etc. */
  kind: 'reanalysis-model' | 'statistical-model' | 'elevation-model' | 'satellite-classification' | 'soil-map' | 'statistics';
  resolution: string;
  period: string;
  confidence: Confidence;
  /** Translation key for the plain-language limitation shown under each indicator. */
  limitationKey: string;
}
