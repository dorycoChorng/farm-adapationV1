import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { FarmMapHandle } from '../components/map/types';
import { appFetchRange } from '../env/appFetch';
import { landCoverTile, runLength } from '../env/rasters';
import type { LngLat, MapEvent, ViewState } from '../map/bridge';
import { useI18n } from '../i18n';
import { useAppState } from '../state/AppState';

/**
 * Shared wiring for screens that host a FarmMap: view state, layer choice,
 * tile-error reporting, promise-based elevation lookups and land-cover tiles
 * (read here because the map page can't fetch ESA's files itself).
 */
export function useMapController(onMapEvent?: (event: MapEvent) => void) {
  const ref = useRef<FarmMapHandle>(null);
  const { layers } = useAppState();
  const { language } = useI18n();
  const [view, setView] = useState<ViewState | null>(null);
  const [tileError, setTileError] = useState(false);
  const pendingElevation = useRef(new Map<number, (m: number | null) => void>());
  const nextRequest = useRef(1);
  const handler = useRef(onMapEvent);
  const layersRef = useRef(layers);
  const languageRef = useRef(language);
  useLayoutEffect(() => {
    handler.current = onMapEvent;
    layersRef.current = layers;
    languageRef.current = language;
  });

  const applyLayers = useCallback(() => {
    const map = ref.current;
    const current = layersRef.current;
    if (!map) return;
    map.send({ type: 'setBaseLayer', id: current.base });
    for (const [id, visible] of Object.entries(current.overlays)) {
      map.send({ type: 'setOverlay', id: id as keyof typeof current.overlays, visible });
    }
    map.send({ type: 'setPlaceLanguage', language: languageRef.current });
  }, []);

  // Re-apply when the user changes layers or language; the 'ready' event covers maps that mount later.
  useEffect(applyLayers, [layers, language, applyLayers]);

  const onEvent = useCallback((event: MapEvent) => {
    switch (event.type) {
      case 'ready':
        applyLayers();
        break;
      case 'viewChanged':
        setView(event.view);
        break;
      case 'tileError':
        if (event.source.startsWith('base-') || event.source === 'terrain-dem') setTileError(true);
        break;
      case 'tileRequest': {
        const { requestId, z, x, y } = event;
        landCoverTile(z, x, y, appFetchRange).then(
          (codes) => ref.current?.send({ type: 'tileData', requestId, runs: codes ? runLength(codes) : null }),
          () => ref.current?.send({ type: 'tileData', requestId, runs: null, error: true }),
        );
        break;
      }
      case 'elevation': {
        const resolve = pendingElevation.current.get(event.requestId);
        pendingElevation.current.delete(event.requestId);
        resolve?.(event.meters);
        break;
      }
    }
    handler.current?.(event);
  }, [applyLayers]);

  const queryElevation = useCallback((point: LngLat) => {
    const requestId = nextRequest.current++;
    return new Promise<number | null>((resolve) => {
      pendingElevation.current.set(requestId, resolve);
      ref.current?.send({ type: 'queryElevation', requestId, point });
    });
  }, []);

  return { ref, view, tileError, clearTileError: () => setTileError(false), onEvent, queryElevation };
}
