import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, EmptyState, FadeIn, IconButton, ListItem, Row, SectionTitle, styles as ui } from '../components/ui';
import {
  deleteLocation,
  deleteParcel,
  listLocations,
  listParcels,
  type Parcel,
  type SavedLocation,
} from '../db/repositories';
import { formatDecimalPair, formatHectares, formatMeters } from '../geo/format';
import { useI18n } from '../i18n';
import { formatDate } from '../i18n/format';
import { useAppState } from '../state/AppState';
import { colors, radius, spacing } from '../theme/colors';

function confirm(message: string, onYes: () => void, yes: string, no: string) {
  if (Platform.OS === 'web') {
    if (window.confirm(message)) onYes();
    return;
  }
  Alert.alert(message, undefined, [
    { text: no, style: 'cancel' },
    { text: yes, style: 'destructive', onPress: onYes },
  ]);
}

export default function SavedScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { t, language } = useI18n();
  const { select } = useAppState();
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [parcels, setParcels] = useState<Parcel[]>([]);

  const reload = useCallback(() => {
    listLocations(db).then(setLocations);
    listParcels(db).then(setParcels);
  }, [db]);

  useFocusEffect(reload);

  const openLocation = (l: SavedLocation) => {
    select(
      { latitude: l.latitude, longitude: l.longitude, name: l.name, source: 'saved', accuracyMeters: l.accuracyMeters, bbox: null },
      { fly: true, zoom: 16 },
    );
    router.dismissTo('/');
  };

  const openParcel = (p: Parcel) => {
    const lats = p.ring.map((q) => q.latitude);
    const lngs = p.ring.map((q) => q.longitude);
    select(
      {
        latitude: p.ring[0].latitude,
        longitude: p.ring[0].longitude,
        name: p.name,
        source: 'saved',
        accuracyMeters: null,
        bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
      },
      { fly: true },
    );
    router.dismissTo('/');
  };

  const del = (name: string, run: () => Promise<void>) =>
    confirm(t('saved.confirmDelete', { name }), () => void run().then(reload), t('common.delete'), t('common.cancel'));

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <SectionTitle>{`${t('saved.parcels')} · ${parcels.length}`}</SectionTitle>
      {parcels.length === 0 ? (
        <Card>
          <EmptyState
            icon="crop"
            title={t('saved.emptyParcels')}
            action={<Button label={t('nav.draw')} icon="add" onPress={() => router.dismissTo('/')} grow={false} />}
          />
        </Card>
      ) : null}
      {parcels.map((p, i) => (
        <FadeIn key={p.id} delay={i * 40}>
          <Card title={p.name} icon="crop" right={<Text style={ui.muted}>{formatDate(p.updatedAt, language)}</Text>}>
            <View style={s.stats}>
              <View style={s.stat}>
                <Text style={s.statValue}>{formatHectares(p.areaSquareMeters / 10_000)}</Text>
                <Text style={s.statLabel}>{t('draw.area')}</Text>
              </View>
              <View style={s.stat}>
                <Text style={s.statValue}>{formatMeters(p.perimeterMeters)}</Text>
                <Text style={s.statLabel}>{t('draw.perimeter')}</Text>
              </View>
              <View style={s.stat}>
                <Text style={s.statValue}>{p.vertexCount}</Text>
                <Text style={s.statLabel}>{t('draw.points')}</Text>
              </View>
            </View>
            <Row style={{ marginTop: spacing.md }}>
              <Button
                label={t('saved.analyse')}
                icon="analytics"
                variant="secondary"
                onPress={() => router.push({ pathname: '/analysis', params: { parcelId: p.id } })}
              />
              <Button label={t('common.open')} icon="map" variant="outline" onPress={() => openParcel(p)} />
            </Row>
            <Row>
              <Button
                label={t('saved.editBoundary')}
                icon="create"
                variant="soft"
                onPress={() => router.push({ pathname: '/parcel-draw', params: { id: p.id } })}
              />
              <Button label={t('common.delete')} icon="trash" variant="danger" onPress={() => del(p.name, () => deleteParcel(db, p.id))} />
            </Row>
          </Card>
        </FadeIn>
      ))}

      <SectionTitle>{`${t('saved.locations')} · ${locations.length}`}</SectionTitle>
      {locations.length === 0 ? (
        <Card>
          <EmptyState icon="bookmark-outline" title={t('saved.emptyLocations')} />
        </Card>
      ) : null}
      <View style={{ gap: spacing.sm }}>
        {locations.map((l) => (
          <ListItem
            key={l.id}
            icon={l.isFarmStart ? 'flag' : l.source === 'gps' ? 'locate' : 'location'}
            iconColor={l.isFarmStart ? colors.primary : colors.sun}
            iconBg={l.isFarmStart ? colors.primaryLight : colors.sunLight}
            title={l.name}
            subtitle={`${formatDecimalPair(l)}${l.accuracyMeters != null ? ` · ± ${Math.round(l.accuracyMeters)} m` : ''}${
              l.isFarmStart ? ` · ${t('saved.farmStart')}` : ''
            }`}
            onPress={() => openLocation(l)}
            right={
              <IconButton
                icon="trash-outline"
                label={`${t('common.delete')} ${l.name}`}
                size={40}
                onPress={() => del(l.name, () => deleteLocation(db, l.id))}
                style={{ boxShadow: 'none' }}
              />
            }
          />
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  statValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 12.5, color: colors.textMuted },
});
