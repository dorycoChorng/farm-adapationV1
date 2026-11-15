import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { FarmMapHandle } from '../components/map/types';
import { appFetchJson, appFetchRange } from '../env/appFetch';
import { blocksFor, CLIMATE_LAYERS, climateBlock, type ClimateLayer, type GridCell } from '../env/climateGrid';

/** Most grid cells kept on the map per layer (about 50 blocks' worth); the oldest go first. */
const MAX_CELLS = 4000;
import { CLIMATE_OVERLAY } from '../map/layers';
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

  // Rainfall and sunlight overlays: fetch NASA POWER's grid for what is on screen, a short
  // moment after the map stops moving, and resend it when a map page (re)loads.
  const climateSent = useRef<Partial<Record<ClimateLayer, GridCell[]>>>({});
  const [climateBusy, setClimateBusy] = useState(false);
  const [climateTooFar, setClimateTooFar] = useState(false);
  const rainfallOn = layers.overlays.rainfall;
  const sunlightOn = layers.overlays.sunlight;
  useEffect(() => {
    const active = CLIMATE_LAYERS.filter((l) => layersRef.current.overlays[l]);
    if (!active.length || !view?.bounds) {
      setClimateTooFar(false);
      return;
    }
    const blocks = view.zoom >= CLIMATE_OVERLAY.minzoom ? blocksFor(view.bounds) : [];
    setClimateTooFar(!blocks.length);
    if (!blocks.length) return;
    let live = true;
    const timer = setTimeout(async () => {
      setClimateBusy(true);
      for (const layer of active) {
        // Keep what is already drawn and add each block as it arrives, centre first.
        const have = new Map((climateSent.current[layer] ?? []).map((c) => [`${c.w},${c.s}`, c]));
        for (const [bx, by] of blocks) {
          try {
            for (const c of await climateBlock(layer, bx, by, (url) => appFetchJson(url))) have.set(`${c.w},${c.s}`, c);
          } catch {
            // One block missing (offline, rate limit) leaves a gap; it is tried again on the next move.
            continue;
          }
          if (!live) return;
          const cells = [...have.values()].slice(-MAX_CELLS);
          climateSent.current[layer] = cells;
          ref.current?.send({ type: 'setClimateGrid', layer, cells });
        }
      }
      if (live) setClimateBusy(false);
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
      setClimateBusy(false);
    };
  }, [view, rainfallOn, sunlightOn]);

  const onEvent = useCallback((event: MapEvent) => {
    switch (event.type) {
      case 'ready':
        applyLayers();
        for (const layer of CLIMATE_LAYERS) {
          const cells = climateSent.current[layer];
          if (cells) ref.current?.send({ type: 'setClimateGrid', layer, cells });
        }
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

  return { ref, view, tileError, clearTileError: () => setTileError(false), onEvent, queryElevation, climateBusy, climateTooFar };
}
