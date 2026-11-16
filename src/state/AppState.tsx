import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

import type { LayerState } from '../components/LayerPicker';
import type { LocationFix } from '../location/locationService';
import type { PlaceSource } from '../search/types';

/** A location the user picked (search result, map tap, GPS fix or saved place). Never a default guess. */
export interface Selection {
  latitude: number;
  longitude: number;
  name: string | null;
  /** Khmer name, when known (countries from the bundled index). */
  nameKm?: string | null;
  source: PlaceSource | 'map' | 'gps';
  accuracyMeters: number | null;
  bbox: [number, number, number, number] | null;
}

/** A request for the globe to move, consumed by the globe screen. */
export interface FocusRequest {
  id: number;
  selection: Selection;
  zoom?: number;
}

interface AppStateValue {
  selection: Selection | null;
  userFix: LocationFix | null;
  focus: FocusRequest | null;
  select(selection: Selection | null, options?: { fly?: boolean; zoom?: number }): void;
  setUserFix(fix: LocationFix | null): void;
  layers: LayerState;
  setLayers(layers: LayerState): void;
}

export const DEFAULT_LAYERS: LayerState = {
  // ESA Copernicus Sentinel-2 (10 m, open licence, cloud-free mosaic by EOX).
  base: 'satellite-s2',
  overlays: { places: true, hillshade: false, boundaries: true, landcover: false, waterflow: false, rainfall: false, sunlight: false },
};

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [userFix, setUserFix] = useState<LocationFix | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const focusId = useRef(0);

  const select = useCallback<AppStateValue['select']>((next, options) => {
    setSelection(next);
    if (next && options?.fly) setFocus({ id: ++focusId.current, selection: next, zoom: options.zoom });
  }, []);

  const value = useMemo(
    () => ({ selection, userFix, focus, select, setUserFix, layers, setLayers }),
    [selection, userFix, focus, select, layers],
  );
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
