import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { ageInDays } from '../../env/analyze';
import { SOURCES } from '../../env/sources';
import type { Section } from '../../env/types';
import type { TranslationKey } from '../../i18n/en';
import { useI18n } from '../../i18n';
import { formatDate } from '../../i18n/format';
import { colors, spacing } from '../../theme/colors';
import { Badge, Collapsible, InfoRow } from '../ui';

export const confidenceColor = { high: colors.primary, medium: colors.sun, low: '#c4521c' } as const;

/** "About this data" disclosure under every indicator: source, period, resolution, freshness, confidence, limits. */
export function SourceInfo({ section, period, testID }: { section: Section<unknown>; period?: string; testID?: string }) {
  const { t, language } = useI18n();
  const src = SOURCES[section.source];
  const days = ageInDays(section.fetchedAt, new Date());
  const retrieved = formatDate(section.fetchedAt, language);
  return (
    <Collapsible title={t('env.about')} testID={testID}>
      <View style={s.badges}>
        <Badge label={t(`env.kind.${src.kind}` as TranslationKey)} color={colors.secondary} />
        <Badge label={t('env.confidence', { level: t(`env.conf.${src.confidence}` as TranslationKey) })} color={confidenceColor[src.confidence]} />
      </View>
      <InfoRow label={t('env.source')} value={src.name} />
      <InfoRow label={t('env.provider')} value={src.provider} />
      <InfoRow label={t('env.period')} value={period ?? src.period} />
      <InfoRow label={t('env.resolution')} value={src.resolution} />
      <InfoRow label={t('env.retrieved')} value={`${retrieved} · ${days <= 0 ? t('env.today') : t('env.daysAgo', { n: days })}`} />
      <InfoRow label={t('env.licence')} value={src.licence} />
      <Text style={s.limits}>{t(src.limitationKey as TranslationKey)}</Text>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(src.url)} style={s.link}>
        <Text style={s.linkText}>{src.url}</Text>
      </Pressable>
    </Collapsible>
  );
}

const s = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
  limits: { fontSize: 13.5, lineHeight: 19, color: colors.text, backgroundColor: colors.surfaceAlt, padding: spacing.md, borderRadius: 10, marginTop: spacing.sm },
  link: { minHeight: 36, justifyContent: 'center' },
  linkText: { fontSize: 13, color: colors.secondary, textDecorationLine: 'underline' },
});
