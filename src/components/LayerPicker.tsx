import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { LAND_COVER_CLASSES } from '../env/sources';
import { WATER_STYLE } from '../env/waterStyle';
import type { TranslationKey } from '../i18n/en';
import { CLIMATE_STOPS } from '../env/climateGrid';
import { BASE_LAYERS, type BaseLayerId, LAND_COVER_OVERLAY, type OverlayId, PLANNED_LAYERS, SOIL_OVERLAY_LICENCE } from '../map/layers';
import { colors, spacing, TOUCH_TARGET } from '../theme/colors';
import { Button, IconButton, type IconName, Ionicons, tapFeedback } from './ui';

const BASE_ICONS: Record<BaseLayerId, IconName> = {
  'satellite-s2': 'planet-outline',
  outline: 'map-outline',
};

/** Same colours as the map page's water-flow tiles and the field view (WATER_STYLE). */
const WATER_FLOW_LEGEND: [string, TranslationKey][] = [
  [WATER_STYLE.small.color, 'layers.waterflowSmall'],
  [WATER_STYLE.stream.color, 'layers.waterflowStream'],
  [WATER_STYLE.main.color, 'layers.waterflowRiver'],
  [WATER_STYLE.pond.color, 'layers.waterflowPool'],
];

/** ISRIC's own legend for the pH layer, so the colours always match the map. */
const SOIL_LEGEND_URL = (Platform.OS === 'web' && typeof window !== 'undefined' ? `${window.location.origin}/isric-maps/` : 'https://maps.isric.org/') +
  'mapserv?map=/map/phh2o.map&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&LAYER=phh2o_0-5cm_mean&FORMAT=image/png&SLD_VERSION=1.1.0';

const OVERLAY_ICONS: Record<OverlayId, IconName> = {
  places: 'text-outline',
  landcover: 'leaf-outline',
  hillshade: 'triangle-outline',
  waterflow: 'water-outline',
  rainfall: 'rainy-outline',
  sunlight: 'sunny-outline',
  soil: 'layers-outline',
  boundaries: 'git-network-outline',
};

export interface LayerState {
  base: BaseLayerId;
  overlays: Record<OverlayId, boolean>;
}

export function LayerPicker({
  visible,
  state,
  onChange,
  onClose,
}: {
  visible: boolean;
  state: LayerState;
  onChange: (next: LayerState) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.grabber} />
          <View style={s.header}>
            <Text style={s.title}>{t('layers.title')}</Text>
            <IconButton icon="close" label={t('common.close')} onPress={onClose} size={40} style={{ boxShadow: 'none', backgroundColor: colors.surfaceAlt }} />
          </View>
          <ScrollView>
            <Text style={s.section}>{t('layers.base')}</Text>
            {(Object.keys(BASE_LAYERS) as BaseLayerId[]).map((id) => {
              const on = state.base === id;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    tapFeedback('select');
                    onChange({ ...state, base: id });
                  }}
                  style={[s.option, on && s.optionOn]}
                >
                  <View style={[s.optionIcon, on && { backgroundColor: colors.primary }]}>
                    <Ionicons name={BASE_ICONS[id]} size={20} color={on ? colors.white : colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.optionTitle}>{t(`layers.${id}`)}</Text>
                    <Text style={s.note}>{BASE_LAYERS[id].notes}</Text>
                    <Text style={s.note}>{BASE_LAYERS[id].licence}</Text>
                  </View>
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.primary : colors.textFaint} />
                </Pressable>
              );
            })}
            <Text style={s.section}>{t('layers.overlays')}</Text>
            {(['places', 'waterflow', 'rainfall', 'sunlight', 'soil', 'landcover', 'hillshade', 'boundaries'] as OverlayId[]).map((id) => (
              <View key={id}>
                <View style={s.switchRow}>
                  <Ionicons name={OVERLAY_ICONS[id]} size={20} color={colors.textMuted} />
                  <Text style={[s.optionTitle, { flex: 1 }]}>{t(`layers.${id}`)}</Text>
                  <Switch
                    accessibilityLabel={t(`layers.${id}`)}
                    value={state.overlays[id]}
                    onValueChange={(v) => onChange({ ...state, overlays: { ...state.overlays, [id]: v } })}
                    trackColor={{ true: colors.primary, false: colors.border }}
                    testID={`overlay-${id}`}
                  />
                </View>
                {id === 'places' ? (
                  <View style={s.overlayInfo}>
                    <Text style={s.note}>{t('layers.placesNote')}</Text>
                  </View>
                ) : null}
                {id === 'waterflow' ? (
                  <View style={s.overlayInfo}>
                    <Text style={s.note}>{t('layers.waterflowNote')}</Text>
                    {state.overlays.waterflow ? (
                      <View style={s.legend}>
                        {WATER_FLOW_LEGEND.map(([color, key]) => (
                          <View key={key} style={s.legendItem}>
                            <View style={[s.swatch, { backgroundColor: color }]} />
                            <Text style={s.legendText}>{t(key)}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
                {id === 'rainfall' || id === 'sunlight' ? (
                  <View style={s.overlayInfo}>
                    <Text style={s.note}>{t(id === 'rainfall' ? 'layers.rainfallNote' : 'layers.sunlightNote')}</Text>
                    {state.overlays[id] ? (
                      <View style={s.legend}>
                        {CLIMATE_STOPS[id].map(([v, color]) => (
                          <View key={v} style={s.legendItem}>
                            <View style={[s.swatch, { backgroundColor: color }]} />
                            <Text style={s.legendText}>{id === 'rainfall' ? `${v.toLocaleString('en-US')} mm` : `${v} kWh/m²`}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
                {id === 'soil' ? (
                  <View style={s.overlayInfo}>
                    <Text style={s.note}>{t('layers.soilNote')}</Text>
                    <Text style={s.note}>{SOIL_OVERLAY_LICENCE}</Text>
                    {state.overlays.soil ? (
                      <Image source={{ uri: SOIL_LEGEND_URL }} style={s.soilLegend} resizeMode="contain" accessibilityLabel={t('layers.soilLegend')} />
                    ) : null}
                  </View>
                ) : null}
                {id === 'landcover' ? (
                  <View style={s.overlayInfo}>
                    <Text style={s.note}>{t('layers.landcoverNote')}</Text>
                    <Text style={s.note}>{LAND_COVER_OVERLAY.licence}</Text>
                    {state.overlays.landcover ? (
                      <View style={s.legend}>
                        {Object.values(LAND_COVER_CLASSES).map((c) => (
                          <View key={c.key} style={s.legendItem}>
                            <View style={[s.swatch, { backgroundColor: c.color }]} />
                            <Text style={s.legendText}>{t(c.key as TranslationKey)}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ))}
            {PLANNED_LAYERS.length ? <Text style={s.section}>{t('layers.planned')}</Text> : null}
            {PLANNED_LAYERS.map((l) => (
              <View key={l.id} style={[s.option, s.optionDisabled]} accessibilityState={{ disabled: true }}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textFaint} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.optionTitle, { color: colors.textMuted }]}>{t(`layers.${l.id}`)}</Text>
                  <Text style={s.note}>{l.candidateSources}</Text>
                </View>
              </View>
            ))}
            {PLANNED_LAYERS.length ? <Text style={s.note}>{t('layers.plannedNote')}</Text> : null}
          </ScrollView>
          <Button label={t('common.close')} onPress={onClose} grow={false} style={{ marginTop: spacing.md }} />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  soilLegend: { width: 220, height: 180, marginTop: spacing.sm, alignSelf: 'flex-start' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '85%',
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#c5d1c9', marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18.5, fontWeight: '700', color: colors.text },
  section: { fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm },
  option: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  optionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  optionOn: { borderColor: colors.primary, backgroundColor: '#f3faf6' },
  optionDisabled: { backgroundColor: colors.surfaceAlt, borderStyle: 'dashed' },
  optionTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  note: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  overlayInfo: { paddingLeft: 32, paddingBottom: spacing.sm, gap: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: '45%' },
  swatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  legendText: { fontSize: 12.5, color: colors.textMuted },
  switchRow: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
});
