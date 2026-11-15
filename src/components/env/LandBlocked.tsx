import { StyleSheet, Text, View } from 'react-native';

import { LAND_COVER_CLASSES } from '../../env/sources';
import { landCheck } from '../../env/suitability';
import type { EnvSummary } from '../../env/types';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';
import { colors, radius, spacing, type } from '../../theme/colors';
import { Ionicons } from '../ui';

/** Why there is no crop advice for this place; renders nothing when land cover shows farmland. */
export function LandBlocked({ summary }: { summary: EnvSummary }) {
  const { t } = useI18n();
  const land = landCheck(summary);
  if (land.ok) return null;
  const cls = land.code !== undefined && LAND_COVER_CLASSES[land.code] ? t(LAND_COVER_CLASSES[land.code].key as TranslationKey).toLowerCase() : '–';
  return (
    <View style={s.blocked} testID="land-blocked">
      <Ionicons name={land.reason === 'unchecked' ? 'eye-off-outline' : land.reason === 'no-land' ? 'water-outline' : 'business-outline'} size={26} color={colors.warning} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.blockedTitle}>{t(`land.${land.reason}.title` as TranslationKey)}</Text>
        <Text style={type.small}>
          {t(`land.${land.reason}.body` as TranslationKey, { pct: Math.round((land.farmlandShare ?? 0) * 100), cls })}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  blocked: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.warningBg,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  blockedTitle: { fontSize: 14, fontWeight: '700', color: colors.warning },
});
