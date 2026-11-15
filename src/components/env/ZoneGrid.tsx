import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LAND_COVER_CLASSES } from '../../env/sources';
import type { LatLng } from '../../geo/types';
import type { ZoneData, ZoneKind } from '../../env/types';
import { FARMABLE_ZONES, zoneAt, zoneCells, zoneSummary } from '../../env/zones';
import { useMapController } from '../../hooks/useMapController';
import type { LngLat } from '../../map/bridge';
import { FarmMap } from '../map/FarmMap';
import type { TranslationKey } from '../../i18n/en';
import { useI18n } from '../../i18n';
import { colors, radius, spacing, type } from '../../theme/colors';
import { tapFeedback } from '../ui';

export const ZONE_COLORS: Record<ZoneKind, string> = {
  cropland: '#3f9a4f',
  open: '#b5c94a',
  low: '#3f8fd6',
  wet: '#0096a0',
  steep: '#c4721c',
  tree: '#17633a',
  water: '#1d4fa3',
  built: '#c0392b',
  'no-data': '#b8c2bc',
};

const toLngLat = (p: LatLng): LngLat => [p.longitude, p.latitude];

/**
 * The land split into zones, drawn over the satellite image of the place so each zone
 * can be matched to what is on the ground. Tap a zone (on the map or in the list) to
 * read why it was classed that way and what that means for planting.
 */
export function ZoneGrid({ data, ring, height = 300 }: { data: ZoneData; ring: LatLng[] | null; height?: number }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<number | null>(null);
  const cells = useMemo(() => zoneCells(data, ring), [data, ring]);
  const { ref: mapRef, tileError, onEvent } = useMapController((event) => {
    if (event.type === 'mapTap') {
      const i = zoneAt(cells, { longitude: event.point[0], latitude: event.point[1] });
      if (i !== null) {
        tapFeedback('select');
        setPicked((p) => (p === i ? null : i));
      }
    }
  });
  const [w, s, e, n] = data.bbox;

  useEffect(() => {
    mapRef.current?.send({ type: 'fitBounds', bbox: data.bbox, maxZoom: 18 });
    if (ring) mapRef.current?.send({ type: 'setRing', points: ring.map(toLngLat), closed: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ring]);
  useEffect(() => {
    mapRef.current?.send({
      type: 'setZones',
      zones: zoneOverlay(data, cells),
      selected: picked,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, cells, picked]);

  const zone = picked === null ? null : data.zones[picked];
  const median = (() => {
    const els = data.zones.map((z) => z.elevationM).filter((v): v is number => v !== null).sort((a, b) => a - b);
    return els.length ? els[Math.floor(els.length / 2)] : null;
  })();

  return (
    <View testID="zone-grid">
      <Text style={[type.small, { marginBottom: spacing.sm }]}>
        {data.area === 'parcel'
          ? t('zones.introParcel', { rows: data.rows, cols: data.cols, w: data.cellWidthM, h: data.cellHeightM })
          : t('zones.introSquare', { side: 400, rows: data.rows, cols: data.cols, w: data.cellWidthM, h: data.cellHeightM })}
      </Text>
      <View style={[st.map, { height }]} testID="zone-map">
        <FarmMap
          ref={mapRef}
          initial={{ center: [(w + e) / 2, (s + n) / 2], zoom: 16, projection: 'mercator' }}
          onEvent={onEvent}
        />
      </View>
      <Text style={[type.small, { marginTop: 4 }]}>{tileError ? t('zones.noImagery') : t('zones.mapNote')}</Text>
      <ZoneLegend data={data} />
      {zone ? (
        <View style={[st.detail, { borderColor: ZONE_COLORS[zone.kind] }]} testID="zone-detail">
          <Text style={st.detailTitle}>
            {t('zones.zone', { n: (picked ?? 0) + 1 })} · {t(`zones.kind.${zone.kind}` as TranslationKey)}
          </Text>
          <Text style={type.small}>
            {zone.landCover
              .slice(0, 3)
              .map((f) => `${LAND_COVER_CLASSES[f.code] ? t(LAND_COVER_CLASSES[f.code].key as TranslationKey) : `#${f.code}`} ${Math.round(f.fraction * 100)}%`)
              .join(' · ')}
          </Text>
          {zone.elevationM !== null ? (
            <Text style={type.small}>
              {t('zones.elevSlope', { m: zone.elevationM, deg: zone.slopeDeg === null ? '–' : zone.slopeDeg.toFixed(1) })}
              {median !== null && zone.kind === 'low' ? ` (−${(median - zone.elevationM).toFixed(0)} m)` : ''}
            </Text>
          ) : null}
          <Text style={[type.body, { marginTop: 4 }]}>{t(`zones.advice.${zone.kind}` as TranslationKey)}</Text>
        </View>
      ) : (
        <Text style={[type.small, { marginTop: spacing.xs }]}>{t('zones.tap')}</Text>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
        {data.zones.map((z, i) => (
          <Pressable
            key={`c${i}`}
            accessibilityRole="button"
            accessibilityState={{ selected: picked === i }}
            accessibilityLabel={`${t('zones.zone', { n: i + 1 })}: ${t(`zones.kind.${z.kind}` as TranslationKey)}`}
            onPress={() => {
              tapFeedback('select');
              setPicked(picked === i ? null : i);
            }}
            style={[st.chip, { borderColor: ZONE_COLORS[z.kind], backgroundColor: picked === i ? ZONE_COLORS[z.kind] : colors.surface }]}
            testID={`zone-${i + 1}`}
          >
            <Text style={[st.chipText, picked === i && { color: colors.white }]}>{i + 1}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={[type.small, { marginTop: spacing.sm }]}>{t('zones.sameData')}</Text>
    </View>
  );
}

/** What each colour is, how much of the land it covers, and how much can follow the crop advice. */
export function ZoneLegend({ data }: { data: ZoneData }) {
  const { t } = useI18n();
  const summary = zoneSummary(data);
  const usable = summary.filter((x) => FARMABLE_ZONES.has(x.kind));
  const usableShare = usable.reduce((a, x) => a + x.share, 0);
  const usableCount = usable.reduce((a, x) => a + x.count, 0);
  return (
    <>
      <View style={st.legend}>
        {summary.map((x) => (
          <View key={x.kind} style={st.legendItem} testID={`zone-kind-${x.kind}`}>
            <View style={[st.swatch, { backgroundColor: ZONE_COLORS[x.kind] }]} />
            <Text style={st.legendText}>
              {t(`zones.kind.${x.kind}` as TranslationKey)} · {Math.round(x.share * 100)}%
            </Text>
          </View>
        ))}
      </View>
      <Text style={[type.body, { marginTop: spacing.sm, fontWeight: '700' }]} testID="zones-usable">
        {t('zones.usable', { pct: Math.round(usableShare * 100), n: usableCount, total: data.zones.length })}
      </Text>
    </>
  );
}

/** Zones as map overlay commands. */
export const zoneOverlay = (data: ZoneData, cells: LatLng[][]) =>
  data.zones.map((z, i) => ({ id: i, ring: cells[i].map(toLngLat), color: ZONE_COLORS[z.kind], label: String(i + 1) }));

const st = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 14, height: 14, borderRadius: 4 },
  legendText: { fontSize: 13.5, color: colors.text },
  detail: { marginTop: spacing.sm, borderLeftWidth: 4, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, padding: spacing.md, gap: 2 },
  detailTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  map: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#04121c' },
  chips: { gap: 6, paddingVertical: spacing.sm },
  chip: { minWidth: 40, minHeight: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  chipText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
});
