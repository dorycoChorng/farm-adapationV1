import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { LayerPicker } from '../components/LayerPicker';
import { ZoneLegend, zoneOverlay } from '../components/env/ZoneGrid';
import { FarmMap } from '../components/map/FarmMap';
import { NamePrompt } from '../components/NamePrompt';
import { NetworkBanner } from '../components/NetworkBanner';
import { Banner, Button, Card, InfoRow, Ionicons, Row, styles as ui, tapFeedback } from '../components/ui';
import { appFetchRange } from '../env/appFetch';
import type { ZoneData } from '../env/types';
import { readZones, zoneCells } from '../env/zones';
import { getParcel, type Parcel, saveParcel } from '../db/repositories';
import { formatHectares, formatMeters, formatSquareMeters } from '../geo/format';
import { geodesicMidpoint, measureParcel, segmentsOf } from '../geo/geodesy';
import { validateParcelRing } from '../geo/polygon';
import type { LatLng } from '../geo/types';
import { useMapController } from '../hooks/useMapController';
import { useOnline } from '../hooks/useOnline';
import { useI18n } from '../i18n';
import { formatDate } from '../i18n/format';
import type { LngLat } from '../map/bridge';
import { useAppState } from '../state/AppState';
import { colors, spacing, type } from '../theme/colors';

const toLngLat = (p: LatLng): LngLat => [p.longitude, p.latitude];
const toLatLng = (p: LngLat): LatLng => ({ latitude: p[1], longitude: p[0] });

function bboxOf(ring: LatLng[]): [number, number, number, number] {
  const lats = ring.map((p) => p.latitude);
  const lngs = ring.map((p) => p.longitude);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

export default function ParcelDrawScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { t, language } = useI18n();
  const online = useOnline();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { selection, layers, setLayers } = useAppState();
  const [points, setPoints] = useState<LatLng[]>([]);
  const [closed, setClosed] = useState(false);
  const [existing, setExisting] = useState<Parcel | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [naming, setNaming] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);

  const { ref: mapRef, tileError, onEvent: onMapEvent } = useMapController((event) => {
    if (event.type === 'ringChanged') {
      setPoints(event.points.map(toLatLng));
      setClosed(event.closed);
      setSavedNotice(false);
    }
  });

  useEffect(() => {
    if (loaded) mapRef.current?.send({ type: 'setMode', mode: 'measure' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Editing an existing parcel: load its boundary from SQLite.
  useEffect(() => {
    if (!id) return;
    getParcel(db, id).then((p) => {
      if (p) {
        setExisting(p);
        setPoints(p.ring);
        setClosed(true);
      }
      setLoaded(true);
    });
  }, [db, id]);

  // The map mounts only after loading, so hand it the stored boundary once it exists.
  const existingId = existing?.id;
  useEffect(() => {
    if (!loaded || !existing) return;
    mapRef.current?.send({ type: 'setRing', points: existing.ring.map(toLngLat), closed: true });
    mapRef.current?.send({ type: 'fitBounds', bbox: bboxOf(existing.ring), maxZoom: 18 });
    // Only when a different parcel loads, not after each save of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, existingId]);

  const measurement = useMemo(() => (points.length >= 2 ? measureParcel(points) : null), [points]);
  const edges = useMemo(() => segmentsOf(points, closed), [points, closed]);
  const problems = closed || points.length >= 3 ? validateParcelRing(points) : [];

  // Land zones of the measured field, worked out as soon as the boundary is closed and
  // drawn over the imagery, so the measurement and the land check go together.
  const [zones, setZones] = useState<{ ring: LatLng[]; data: ZoneData | null; error: boolean } | null>(null);
  const zoneRing = closed && problems.length === 0 && online !== false ? points : null;
  const zoneKey = zoneRing ? JSON.stringify(zoneRing) : '';
  useEffect(() => {
    if (!zoneRing) return;
    let cancelled = false;
    const centre = {
      latitude: zoneRing.reduce((a, p) => a + p.latitude, 0) / zoneRing.length,
      longitude: zoneRing.reduce((a, p) => a + p.longitude, 0) / zoneRing.length,
    };
    const timer = setTimeout(() => {
      readZones(centre, zoneRing, appFetchRange).then(
        (data) => !cancelled && setZones({ ring: zoneRing, data, error: false }),
        () => !cancelled && setZones({ ring: zoneRing, data: null, error: true }),
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKey]);
  const zonesNow = zones && zoneRing && JSON.stringify(zones.ring) === zoneKey ? zones : null;
  useEffect(() => {
    const data = zonesNow?.data;
    mapRef.current?.send({ type: 'setZones', zones: data ? zoneOverlay(data, zoneCells(data, zonesNow.ring)) : [], selected: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonesNow]);

  // Edge-length labels drawn on the map.
  useEffect(() => {
    mapRef.current?.send({
      type: 'setLabels',
      labels: edges.map((e) => ({ at: toLngLat(geodesicMidpoint(e.from, e.to)), text: formatMeters(e.lengthMeters) })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges]);

  const pushRing = (next: LatLng[], nextClosed: boolean) => {
    setPoints(next);
    setClosed(nextClosed);
    mapRef.current?.send({ type: 'setRing', points: next.map(toLngLat), closed: nextClosed });
  };

  const undo = () => {
    if (closed) return pushRing(points, false);
    pushRing(points.slice(0, -1), false);
  };

  const save = async (name: string) => {
    const parcel = await saveParcel(
      db,
      { name, ring: points, locationId: existing?.locationId ?? null },
      existing?.id,
    );
    setExisting(parcel);
    setNaming(false);
    setSavedNotice(true);
  };

  // The main step after measuring: keep the boundary and check weather, soil and crops for it.
  const [checking, setChecking] = useState(false);
  const checkLand = async () => {
    setChecking(true);
    try {
      const same = existing && JSON.stringify(existing.ring) === JSON.stringify(points);
      const parcel = same
        ? existing
        : await saveParcel(
            db,
            { name: existing?.name ?? t('draw.defaultName', { date: formatDate(new Date(), language) }), ring: points, locationId: existing?.locationId ?? null },
            existing?.id,
          );
      setExisting(parcel);
      router.push({ pathname: '/analysis', params: { parcelId: parcel.id, auto: '1' } });
    } finally {
      setChecking(false);
    }
  };

  if (!loaded) return null;

  const start = existing?.ring[0] ?? (selection ? { latitude: selection.latitude, longitude: selection.longitude } : null);
  const canSave = closed && problems.length === 0;

  return (
    <View style={s.screen}>
      <FarmMap
        ref={mapRef}
        initial={{
          center: start ? toLngLat(start) : [20, 15],
          zoom: start ? 17 : 2,
          projection: 'mercator',
        }}
        onEvent={onMapEvent}
      />
      <ScrollView style={s.panel} contentContainerStyle={{ padding: spacing.lg, gap: spacing.xs }}>
        <NetworkBanner />
        {tileError && online !== false ? <Banner kind="warning">{t('map.tileError')}</Banner> : null}
        <View style={s.hint}>
          <Ionicons name="finger-print" size={18} color={colors.secondary} />
          <Text style={[ui.muted, { flex: 1 }]}>{t('draw.hint')}</Text>
        </View>
        <Row>
          <Button label={t('draw.undo')} icon="arrow-undo" variant="outline" onPress={undo} disabled={points.length === 0} />
          <Button label={t('draw.clear')} icon="close-circle" variant="danger" onPress={() => pushRing([], false)} disabled={points.length === 0} />
          {closed ? (
            <Button label={t('draw.reopen')} icon="add-circle" variant="outline" onPress={() => pushRing(points, false)} />
          ) : (
            <Button
              label={t('draw.close')}
              icon="checkmark-done"
              variant="secondary"
              onPress={() => {
                tapFeedback('success');
                mapRef.current?.send({ type: 'closeRing' });
              }}
              disabled={points.length < 3}
            />
          )}
        </Row>

        <View style={s.stats}>
          <View style={[s.stat, { flex: 0.6 }]}>
            <Text style={s.statLabel}>{t('draw.points')}</Text>
            <Text style={s.statValue}>{points.length}</Text>
          </View>
          {measurement && closed && measurement.vertexCount >= 3 ? (
            <>
              <View style={[s.stat, s.statMain]} accessible accessibilityLabel={`${t('draw.area')} ${formatHectares(measurement.areaHectares)}`}>
                <Text style={[s.statLabel, { color: '#d7efe1' }]}>{t('draw.area')}</Text>
                <Text style={[s.statValue, { color: colors.white }]}>{formatHectares(measurement.areaHectares)}</Text>
                <Text style={{ color: '#d7efe1', fontSize: 12.5 }}>{formatSquareMeters(measurement.areaSquareMeters)}</Text>
              </View>
              <View style={s.stat}>
                <Text style={s.statLabel}>{t('draw.perimeter')}</Text>
                <Text style={s.statValue}>{formatMeters(measurement.perimeterMeters)}</Text>
              </View>
            </>
          ) : null}
        </View>
        {edges.length > 0 ? (
          <>
            <Text style={s.subTitle}>{t('draw.edges')}</Text>
            {edges.map((e, i) => (
              <InfoRow key={i} label={t('draw.edge', { n: i + 1 })} value={formatMeters(e.lengthMeters)} />
            ))}
          </>
        ) : null}

        {zoneRing ? (
          <Card title={t('zones.onParcel')} icon="grid" iconColor={colors.primary} iconBg={colors.primaryLight} testID="parcel-zones">
            {!zonesNow ? (
              <Text style={type.small}>{t('zones.checking')}</Text>
            ) : zonesNow.data && zonesNow.data.zones.some((z) => z.kind !== 'no-data') ? (
              <>
                <ZoneLegend data={zonesNow.data} />
                <Text style={[type.small, { marginTop: 4 }]}>
                  {t('zones.introParcel', {
                    rows: zonesNow.data.rows,
                    cols: zonesNow.data.cols,
                    w: zonesNow.data.cellWidthM,
                    h: zonesNow.data.cellHeightM,
                  })}
                </Text>
              </>
            ) : (
              <Text style={type.small}>{zonesNow.error ? t('zones.offline') : t('zones.none')}</Text>
            )}
          </Card>
        ) : points.length >= 3 && !closed ? (
          <Text style={ui.muted}>{t('zones.measureHint')}</Text>
        ) : null}
        {closed && problems.includes('self-intersecting') ? (
          <Banner kind="error">{t('draw.selfIntersecting')}</Banner>
        ) : null}
        {!closed && points.length > 0 && points.length < 3 ? <Text style={ui.muted}>{t('draw.tooFew')}</Text> : null}
        <Banner kind="warning">{t('draw.disclaimer')}</Banner>
        {savedNotice ? <Banner kind="success">{t('draw.saved')}</Banner> : null}

        {canSave ? (
          <>
            <Button label={t('draw.check')} icon="leaf" onPress={() => void checkLand()} busy={checking} testID="parcel-check" />
            <Text style={[ui.muted, { textAlign: 'center' }]}>{t('draw.checkNote')}</Text>
          </>
        ) : null}
        <Row>
          <Button label={t('common.save')} icon="save" variant="outline" onPress={() => setNaming(true)} disabled={!canSave} testID="parcel-save" />
          <Button label={t('globe.layers')} icon="layers" variant="outline" onPress={() => setLayersOpen(true)} />
        </Row>
        {savedNotice && existing ? (
          <Row>
            <Button label={t('nav.saved')} icon="folder-open" variant="outline" onPress={() => router.push('/saved')} />
          </Row>
        ) : null}
      </ScrollView>
      <LayerPicker visible={layersOpen} state={layers} onChange={setLayers} onClose={() => setLayersOpen(false)} />
      <NamePrompt
        visible={naming}
        title={t('common.save')}
        initialValue={existing?.name ?? t('draw.defaultName', { date: formatDate(new Date(), language) })}
        placeholder={t('draw.namePlaceholder')}
        onCancel={() => setNaming(false)}
        onSubmit={(name) => void save(name)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  // Fixed height so the map does not resize under the user's finger as points are added.
  panel: {
    height: '42%',
    flexGrow: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    marginTop: -22,
  },
  subTitle: { fontSize: 13, fontWeight: '700', color: colors.secondary, marginTop: spacing.sm },
  hint: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  stats: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.xs },
  stat: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: spacing.md, gap: 2 },
  statMain: { flex: 1.4, backgroundColor: colors.primary },
  statLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
  statValue: { fontSize: 15.5, fontWeight: '700', color: colors.text },
});
