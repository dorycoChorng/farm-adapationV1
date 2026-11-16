import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, Ionicons, styles as ui } from '../components/ui';
import { CREDIT_GROUPS, CREDITS } from '../env/credits';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n/en';
import { colors, radius, spacing } from '../theme/colors';

/** Sources and credits: every outside source the app uses, what for, its licence and a link. */
export default function CreditsScreen() {
  const { t } = useI18n();
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} testID="credits-screen">
      <Text style={[ui.body, { marginBottom: spacing.md }]}>{t('credits.intro')}</Text>
      {CREDIT_GROUPS.map((group) => (
        <Card key={group} title={t(`credits.group.${group}` as TranslationKey)}>
          {CREDITS.filter((c) => c.group === group).map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole={c.url ? 'link' : 'text'}
              disabled={!c.url}
              onPress={() => c.url && Linking.openURL(c.url)}
              style={st.row}
              testID={`credit-${c.id}`}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.name}>{c.name}</Text>
                <Text style={ui.muted}>{t(`credits.use.${c.id}` as TranslationKey)}</Text>
                <Text style={st.meta}>
                  {c.by} · {c.licence}
                </Text>
              </View>
              {c.url ? <Ionicons name="open-outline" size={18} color={colors.primary} /> : null}
            </Pressable>
          ))}
        </Card>
      ))}
      <Text style={[ui.muted, { marginTop: spacing.sm }]}>{t('credits.licence')}</Text>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    borderRadius: radius.sm,
  },
  name: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted },
});
