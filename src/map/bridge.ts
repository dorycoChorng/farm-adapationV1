/** Message protocol between React Native and the MapLibre page running in the WebView. */
import type { BaseLayerId, OverlayId, RasterProvider } from './layers';

export type LngLat = [number, number];
export type MapMode = 'browse' | 'measure';
export type Projection = 'globe' | 'mercator';

export interface MapInitConfig {
  center: LngLat;
  zoom: number;
  projection: Projection;
  baseLayers: Record<string, RasterProvider | null>;
  terrain: RasterProvider & { encoding: 'terrarium' };
  elevationZoom: number;
  /** Land-cover overlay: zoom range, attribution and the colour for each class code. */
  landCover: { minzoom: number; maxzoom: number; attribution: string; colors: Record<string, string> };
}

export type MapCommand =
  | { type: 'init'; config: MapInitConfig }
  | { type: 'flyTo'; center: LngLat; zoom?: number; duration?: number }
  | { type: 'fitBounds'; bbox: [number, number, number, number]; maxZoom?: number }
  | { type: 'zoomBy'; delta: number }
  /** Pixels covered by app UI at the top and bottom of the map. */
  | { type: 'setInsets'; top: number; bottom: number }
  | { type: 'setProjection'; projection: Projection }
  | { type: 'setBaseLayer'; id: BaseLayerId }
  | { type: 'setOverlay'; id: OverlayId; visible: boolean }
  /** Language of the place-name labels; Khmer where a Khmer name is known, else English. */
  | { type: 'setPlaceLanguage'; language: 'en' | 'km' }
  | { type: 'setSelected'; point: LngLat | null }
  | { type: 'setUserLocation'; point: LngLat | null; accuracyMeters: number | null }
  | { type: 'setMode'; mode: MapMode }
  | { type: 'setRing'; points: LngLat[]; closed: boolean }
  | { type: 'closeRing' }
  | { type: 'setLabels'; labels: { at: LngLat; text: string }[] }
  /** Land zones drawn over the imagery; `selected` is the id of the highlighted zone. */
  | { type: 'setZones'; zones: { id: number; ring: LngLat[]; color: string; label: string }[]; selected: number | null }
  | { type: 'queryElevation'; requestId: number; point: LngLat }
  /** Answer to a tileRequest: run-length encoded class codes ([value, count, ...]), or null for an empty tile. */
  | { type: 'tileData'; requestId: number; runs: number[] | null; error?: boolean };

export interface ViewState {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
  projection: Projection;
}

export type MapEvent =
  | { type: 'ready' }
  | { type: 'loaded' }
  | { type: 'viewChanged'; view: ViewState; final: boolean }
  | { type: 'mapTap'; point: LngLat }
  | { type: 'ringChanged'; points: LngLat[]; closed: boolean }
  | { type: 'tileError'; source: string }
  | { type: 'elevation'; requestId: number; meters: number | null; error?: string }
  | { type: 'error'; message: string }
  /** The page needs a data tile it can't fetch itself (the land-cover overlay). */
  | { type: 'tileRequest'; requestId: number; layer: 'landcover'; z: number; x: number; y: number };

export function parseMapEvent(data: string): MapEvent | null {
  try {
    const msg = JSON.parse(data) as MapEvent;
    return msg && typeof msg.type === 'string' ? msg : null;
  } catch {
    return null;
  }
}
