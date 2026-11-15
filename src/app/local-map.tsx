import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { LayerPicker } from '../components/LayerPicker';
import { FarmMap } from '../components/map/FarmMap';
import { NetworkBanner } from '../components/NetworkBanner';
import { Banner, Button, Chip, EmptyState, Row, styles as ui } from '../components/ui';
import { formatCoordinate } from '../geo/format';
import { useMapController } from '../hooks/useMapController';
import { useOnline } from '../hooks/useOnline';
import { useI18n } from '../i18n';
import { useAppState } from '../state/AppState';
import { colors, spacing } from '../theme/colors';

export default function LocalMapScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const online = useOnline();
  const { selection, select, userFix, layers, setLayers } = useAppState();
  const [layersOpen, setLayersOpen] = useState(false);
  const { ref: mapRef, view: mapView, tileError, onEvent: onMapEvent } = useMapController((event) => {
    if (event.type === 'mapTap') {
      select({ latitude: event.point[1], longitude: event.point[0], name: null, source: 'map', accuracyMeters: null, bbox: null });
    }
  });

  useEffect(() => {
    mapRef.current?.send({ type: 'setSelected', point: selection ? [selection.longitude, selection.latitude] : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  useEffect(() => {
    mapRef.current?.send({
      type: 'setUserLocation',
      point: userFix ? [userFix.longitude, userFix.latitude] : null,
      accuracyMeters: userFix?.accuracyMeters ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFix]);

  if (!selection) {
    return (
      <View style={{ padding: spacing.lg, flex: 1, justifyContent: 'center' }}>
        <EmptyState icon="image-outline" title={t('local.title')} text={t('local.noSelection')} />
        <Row>
          <Button label={t('nav.search')} icon="search" onPress={() => router.replace('/search')} />
          <Button label={t('nav.myLocation')} icon="locate" variant="secondary" onPress={() => router.replace('/my-location')} />
        </Row>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <FarmMap
        ref={mapRef}
        initial={{ center: [selection.longitude, selection.latitude], zoom: 16, projection: 'mercator' }}
        onEvent={onMapEvent}
      />
      <View style={s.panel}>
        <NetworkBanner />
        {tileError && online !== false ? <Banner kind="warning">{t('map.tileError')}</Banner> : null}
        <View style={s.chips}>
          <Chip icon="navigate" label={`${formatCoordinate(selection.latitude, 'N', 'S')}  ${formatCoordinate(selection.longitude, 'E', 'W')}`} />
          <Chip icon="search" label={`${t('common.zoom')} ${mapView ? mapView.zoom.toFixed(1) : '–'}`} />
        </View>
        <Text style={ui.muted}>{t('globe.tapHint')}</Text>
        <Row>
          <Button label={t('globe.measure')} icon="crop" onPress={() => router.push('/parcel-draw')} />
          <Button label={t('globe.analyse')} icon="analytics" variant="secondary" onPress={() => router.push('/analysis')} />
          <Button label={t('globe.layers')} icon="layers" variant="outline" onPress={() => setLayersOpen(true)} />
        </Row>
      </View>
      <LayerPicker visible={layersOpen} state={layers} onChange={setLayers} onClose={() => setLayersOpen(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  panel: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    marginTop: -22,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
