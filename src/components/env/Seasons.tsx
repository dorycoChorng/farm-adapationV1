import { StyleSheet, Text, View } from 'react-native';

import { type Season, WET_MONTH_MM } from '../../env/seasons';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';
import { colors, spacing } from '../../theme/colors';
import type { IconName } from '../ui';

export const SEASON_STYLE: Record<Season['kind'], { color: string; icon: IconName }> = {
  wet: { color: '#2f7fc1', icon: 'rainy' },
  dry: { color: '#c98a1b', icon: 'sunny' },
  spring: { color: '#3c9a5f', icon: 'flower-outline' },
  summer: { color: '#d9822b', icon: 'sunny' },
  autumn: { color: '#b5602a', icon: 'leaf-outline' },
  winter: { color: '#5b7fa6', icon: 'snow-outline' },
};

/** "Wet season", plus the month span unless the season is the whole year. */
export function useSeasonText() {
  const { t } = useI18n();
  const months = t('env.monthsLong').split(',');
  return {
    months,
    name: (s: Season) => (s.months.length === 12 ? t('season.yearRound') : t(`season.${s.kind}` as TranslationKey)),
    span: (s: Season) =>
      s.months.length === 12 ? '' : t('season.span', { from: months[s.months[0]], to: months[s.months[s.months.length - 1]] }),
  };
}

/** Twelve month cells; the given season's months are filled with its colour, and `now` marks this month. */
export function MonthStrip({ season, kinds, now }: { season?: Season; kinds?: Season[]; now?: number }) {
  const { t } = useI18n();
  const axis = t('env.monthsAxis').split(',');
  const colourOf = (m: number) => {
    const owner = (kinds ?? (season ? [season] : [])).find((s) => s.months.includes(m));
    return owner ? SEASON_STYLE[owner.kind].color : null;
  };
  return (
    <View style={s.strip}>
      {axis.map((label, m) => {
        const c = colourOf(m);
        const on = season ? season.months.includes(m) : !!c;
        return (
          <View key={m} style={s.cellWrap}>
            <View style={[s.cell, { backgroundColor: on && c ? c : colors.surfaceAlt }, m === now && s.nowCell]} />
            <Text style={[s.label, on && { color: colors.text, fontWeight: '700' }, m === now && s.nowLabel]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** "Now: October, wet season. Next: dry season from November." from the device's date. */
export function useSeasonNow(seasons: Season[], date = new Date()) {
  const { t } = useI18n();
  const text = useSeasonText();
  const month = date.getMonth();
  const current = seasons.find((x) => x.months.includes(month)) ?? null;
  const next = current && current.months.length < 12 ? seasons[(seasons.indexOf(current) + 1) % seasons.length] : null;
  const line = current
    ? t(next && next !== current ? 'season.nowNext' : 'season.now', {
        month: text.months[month],
        season: text.name(current).toLowerCase(),
        next: next ? text.name(next).toLowerCase() : '',
        from: next ? text.months[next.months[0]] : '',
      })
    : null;
  return { month, current, line };
}

export function SeasonLegend() {
  const { t } = useI18n();
  return (
    <View style={s.legend}>
      {(['wet', 'dry'] as const).map((k) => (
        <View key={k} style={s.legendItem}>
          <View style={[s.swatch, { backgroundColor: SEASON_STYLE[k].color }]} />
          <Text style={s.legendText}>
            {t(k === 'wet' ? 'season.wetMonth' : 'season.dryMonth')}
            {k === 'wet' ? ` (≥ ${WET_MONTH_MM} mm)` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 3 },
  cellWrap: { flex: 1, alignItems: 'center', gap: 3 },
  cell: { height: 10, alignSelf: 'stretch', borderRadius: 3 },
  label: { fontSize: 10.5, color: colors.textFaint },
  nowCell: { height: 14, marginTop: -2, borderWidth: 2, borderColor: colors.text },
  nowLabel: { color: colors.text, fontWeight: '800', textDecorationLine: 'underline' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 13, color: colors.textMuted },
});
