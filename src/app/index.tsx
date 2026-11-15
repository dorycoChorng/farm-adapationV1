import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '../components/BottomSheet';
import { LayerPicker } from '../components/LayerPicker';
import { FarmMap } from '../components/map/FarmMap';
import { NamePrompt } from '../components/NamePrompt';
import { NetworkBanner } from '../components/NetworkBanner';
import { Banner, IconButton, Ionicons, Pill, tapFeedback } from '../components/ui';
import { insertLocation } from '../db/repositories';
import { formatCoordinate } from '../geo/format';
import { useMapController } from '../hooks/useMapController';
import { useOnline } from '../hooks/useOnline';
import { useI18n } from '../i18n';
import { localName } from '../i18n/format';
import type { Projection } from '../map/bridge';
import { LAND_COVER_OVERLAY, WATER_FLOW_OVERLAY } from '../map/layers';
import { cambodia } from '../search/countries';
import { type Selection, useAppState } from '../state/AppState';
import { colors, radius, shadow, spacing } from '../theme/colors';

type Elevation = { status: 'idle' | 'loading' | 'unavailable' } | { status: 'ok'; meters: number };

/** Zoom used when flying to a single point (GPS fix, map tap, village search result). */
const POINT_ZOOM = 15;
const SEARCH_BAR = 54;
/** Height of the shortcut chip row under the search bar. */
const CHIPS = 44;
const PEEK = 200;

export default function GlobeScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { t, language, setLanguage } = useI18n();
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { selection, select, focus, userFix, layers, setLayers } = useAppState();
  const [projection, setProjection] = useState<Projection>('globe');
  const [layersOpen, setLayersOpen] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [savedFor, setSavedFor] = useState<Selection | null>(null);
  const [lookup, setLookup] = useState<{ for: Selection; meters: number | null } | null>(null);

  const top = insets.top + spacing.sm;
  const peek = PEEK + insets.bottom;
  const expanded = Math.max(peek + 120, Math.round(height * 0.78) - insets.top);

  const { ref: mapRef, view: mapView, tileError, onEvent: onMapEvent, queryElevation } = useMapController((event) => {
    if (event.type === 'mapTap') {
      tapFeedback('select');
      select({
        latitude: event.point[1],
        longitude: event.point[0],
        name: null,
        source: 'map',
        accuracyMeters: null,
        bbox: null,
      });
    }
  });

  // Light status bar text over the map; other screens have a light background.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );

  // Keep the map's zoom buttons below the search bar and its attribution above the sheet.
  // Sent once; FarmMap queues it until the page is ready.
  useEffect(() => {
    mapRef.current?.send({ type: 'setInsets', top: top + SEARCH_BAR + CHIPS, bottom: peek });
  }, [mapRef, top, peek]);

  // Marker and elevation for the current selection. The result is stored with the
  // selection it belongs to, so a stale lookup never shows against a newer point.
  useEffect(() => {
    mapRef.current?.send({
      type: 'setSelected',
      point: selection ? [selection.longitude, selection.latitude] : null,
    });
    if (!selection || online === false) return;
    let cancelled = false;
    queryElevation([selection.longitude, selection.latitude]).then((meters) => {
      if (!cancelled) setLookup({ for: selection, meters });
    });
    return () => {
      cancelled = true;
    };
  }, [selection, online, mapRef, queryElevation]);

  const elevation: Elevation = !selection
    ? { status: 'idle' }
    : online === false
      ? { status: 'unavailable' }
      : lookup?.for !== selection
        ? { status: 'loading' }
        : lookup.meters == null
          ? { status: 'unavailable' }
          : { status: 'ok', meters: lookup.meters };
  const savedNotice = savedFor !== null && savedFor === selection;

  // Fly when another screen asks (search result, GPS fix, saved place).
  useEffect(() => {
    if (!focus) return;
    const s = focus.selection;
    if (s.bbox && focus.zoom == null) {
      mapRef.current?.send({ type: 'fitBounds', bbox: s.bbox, maxZoom: POINT_ZOOM });
    } else {
      mapRef.current?.send({ type: 'flyTo', center: [s.longitude, s.latitude], zoom: focus.zoom ?? POINT_ZOOM });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  useEffect(() => {
    mapRef.current?.send({
      type: 'setUserLocation',
      point: userFix ? [userFix.longitude, userFix.latitude] : null,
      accuracyMeters: userFix?.accuracyMeters ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFix]);

  const goToCambodia = () => {
    const kh = cambodia();
    select(
      { latitude: kh.latitude, longitude: kh.longitude, name: kh.name, nameKm: kh.nameKm, source: 'country-index', accuracyMeters: null, bbox: kh.bbox },
      { fly: true },
    );
  };

  const toggleProjection = () => {
    const next: Projection = projection === 'globe' ? 'mercator' : 'globe';
    setProjection(next);
    mapRef.current?.send({ type: 'setProjection', projection: next });
  };

  const saveSelection = async (name: string) => {
    if (!selection) return;
    await insertLocation(db, {
      name,
      latitude: selection.latitude,
      longitude: selection.longitude,
      accuracyMeters: selection.accuracyMeters,
      altitudeMeters: null,
      source: selection.source === 'gps' ? 'gps' : selection.source === 'map' ? 'map' : 'search',
      sourceDetail: selection.name,
      isFarmStart: false,
    });
    tapFeedback('success');
    setSavingName(null);
    setSavedFor(selection);
  };

  const shown = selection
    ? { label: t('globe.selected'), lat: selection.latitude, lng: selection.longitude }
    : mapView
      ? { label: t('globe.mapCentre'), lat: mapView.center[1], lng: mapView.center[0] }
      : null;

  const elevationText =
    elevation.status === 'ok'
      ? t('globe.elevationApprox', { m: Math.round(elevation.meters) })
      : elevation.status === 'loading'
        ? t('globe.elevationLoading')
        : t('globe.elevationUnavailable');

  const placeTitle = selection?.name ?? shown?.label ?? t('appName');

  return (
    <View style={s.screen}>
      <FarmMap ref={mapRef} initial={{ center: [20, 15], zoom: 1.2, projection: 'globe' }} onEvent={onMapEvent} />

      <View style={[s.topBar, { top }]} pointerEvents="box-none">
        <View style={s.searchBox}>
          <Pressable accessibilityRole="search" onPress={() => router.push('/search')} style={s.searchPress} testID="globe-search">
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <Text style={s.searchText} numberOfLines={1}>
              {t('globe.searchShort')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('offline.language')}
            onPress={() => {
              tapFeedback('select');
              setLanguage(language === 'en' ? 'km' : 'en');
            }}
            style={s.langButton}
            hitSlop={6}
          >
            <Text style={s.langText}>{t('languageToggle')}</Text>
          </Pressable>
        </View>
      </View>
      {/* Shortcut chips under the search bar, as in Google Maps. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[s.chipBar, { top: top + SEARCH_BAR - 2 }]}
        contentContainerStyle={s.chipBarContent}
      >
        <Pill floating icon="flag" label={t('globe.chipCambodia')} accessibilityLabel={t('globe.cambodia')} onPress={goToCambodia} testID="go-cambodia" />
        <Pill floating icon="locate" label={t('nav.myLocation')} onPress={() => router.push('/my-location')} testID="my-location" />
        <Pill floating icon="bookmark" label={t('globe.chipSaved')} onPress={() => router.push('/saved')} />
        <Pill floating icon="cloud-offline" label={t('globe.chipOffline')} onPress={() => router.push('/offline')} />
      </ScrollView>

      {layers.overlays.landcover && mapView && mapView.zoom < LAND_COVER_OVERLAY.minzoom ? (
        <View style={[s.zoomHint, { top: top + SEARCH_BAR + CHIPS + 8 }]} pointerEvents="none" testID="landcover-zoom-hint">
          <Ionicons name="leaf" size={15} color={colors.white} />
          <Text style={s.zoomHintText}>{t('layers.landcoverZoom')}</Text>
        </View>
      ) : null}

      {layers.overlays.waterflow && mapView && mapView.zoom < WATER_FLOW_OVERLAY.minzoom ? (
        <View style={[s.zoomHint, { top: top + SEARCH_BAR + CHIPS + (layers.overlays.landcover && mapView.zoom < LAND_COVER_OVERLAY.minzoom ? 48 : 8) }]} pointerEvents="none" testID="waterflow-zoom-hint">
          <Ionicons name="water" size={15} color={colors.white} />
          <Text style={s.zoomHintText}>{t('layers.waterflowZoom')}</Text>
        </View>
      ) : null}

      {/* Below MapLibre's zoom and compass buttons, which sit at the top right. */}
      <View style={[s.sideColumn, { top: top + SEARCH_BAR + CHIPS + 150 }]} pointerEvents="box-none">
        <IconButton icon="layers" label={t('globe.layers')} onPress={() => setLayersOpen(true)} testID="open-layers" size={40} />
        <IconButton
          icon={projection === 'globe' ? 'map' : 'globe'}
          label={projection === 'globe' ? t('globe.flat') : t('globe.globe')}
          onPress={toggleProjection}
          size={40}
        />
      </View>


      <BottomSheet
        peekHeight={peek}
        expandedHeight={expanded}
        testID="globe-sheet"
        header={
          <View style={s.placeHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.placeLabel}>{shown?.label ?? ''}</Text>
              <Text style={s.placeTitle} numberOfLines={1} testID="place-title">
                {(selection && localName(selection, language)) ?? (shown ? `${formatCoordinate(shown.lat, 'N', 'S')}, ${formatCoordinate(shown.lng, 'E', 'W')}` : placeTitle)}
              </Text>
            </View>
          </View>
        }
      >
        {selection ? (
          <Text style={s.meta} numberOfLines={2}>
            {[
              selection.name ? `${formatCoordinate(selection.latitude, 'N', 'S')}, ${formatCoordinate(selection.longitude, 'E', 'W')}` : null,
              `${t('common.elevation')} ${elevationText}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : (
          <Text style={s.meta}>{t('globe.tapHint')}</Text>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.actions}>
          <Pill primary icon="crop" label={t('globe.measureLand')} accessibilityLabel={t('globe.measure')} disabled={!selection} onPress={() => router.push('/parcel-draw')} testID="measure-land" />
          <Pill icon="analytics" label={t('globe.quickCheck')} disabled={!selection} onPress={() => router.push('/analysis')} testID="analyse" />
          <Pill icon="image" label={t('globe.closeUp')} accessibilityLabel={t('globe.openLocal')} disabled={!selection} onPress={() => router.push('/local-map')} />
          <Pill icon="bookmark-outline" label={t('globe.save')} accessibilityLabel={t('globe.saveLocation')} disabled={!selection} onPress={() => selection && setSavingName(selection.name ?? '')} />
        </ScrollView>

        <View style={s.flow}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Text style={s.flowText}>{t('globe.flowHint')}</Text>
        </View>

        <NetworkBanner />
        {tileError && online !== false ? <Banner kind="warning">{t('map.tileError')}</Banner> : null}
        {savedNotice ? <Banner kind="success">{t('globe.locationSaved')}</Banner> : null}

      </BottomSheet>

      <LayerPicker visible={layersOpen} state={layers} onChange={setLayers} onClose={() => setLayersOpen(false)} />
      <NamePrompt
        visible={savingName != null}
        title={t('globe.saveLocation')}
        initialValue={savingName ?? ''}
        onCancel={() => setSavingName(null)}
        onSubmit={(name) => void saveSelection(name)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#04121c' },
  zoomHint: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 40, 24, 0.82)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  zoomHintText: { color: colors.white, fontSize: 13.5, fontWeight: '700' },
  topBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  searchBox: {
    flex: 1,
    height: 46,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingLeft: spacing.lg,
    paddingRight: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    ...shadow.float,
  },
  searchPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, alignSelf: 'stretch' },
  searchText: { color: colors.textMuted, fontSize: 14, flex: 1 },
  langButton: {
    height: 36,
    minWidth: 36,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langText: { color: colors.white, fontWeight: '700', fontSize: 12.5 },
  chipBar: { position: 'absolute', left: 0, right: 0, flexGrow: 0 },
  chipBarContent: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6 },
  meta: { fontSize: 12.5, color: colors.textMuted, marginTop: -4 },
  actions: { gap: spacing.sm, paddingVertical: spacing.sm },
  flow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  flowText: { flex: 1, fontSize: 12, color: colors.textMuted },
  sideColumn: { position: 'absolute', right: spacing.md, gap: spacing.md },
  placeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  placeIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.sunLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  placeTitle: { fontSize: 15.5, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hint: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hintText: { fontSize: 12, color: colors.textMuted, flex: 1 },
  tiles: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginTop: spacing.xs,
    ...shadow.card,
  },
  list: { gap: spacing.sm },
});
