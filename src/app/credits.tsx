import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, Ionicons, styles as ui } from '../components/ui';
import { CREDIT_GROUPS, CREDITS } from '../env/credits';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n/en';
import { colors, radius, spacing } from '../theme/colors';

/** Full licence texts of the open-source packages, written by scripts/build-licenses.mjs. */
const LICENCES_URL =
  Platform.OS === 'web' ? '/third-party-licenses.txt' : 'https://farm-adapationv1.vercel.app/third-party-licenses.txt';

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
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(LICENCES_URL)} style={st.row} testID="credit-licences">
        <Text style={[st.name, { flex: 1, color: colors.primary }]}>{t('credits.licenceTexts')}</Text>
        <Ionicons name="open-outline" size={18} color={colors.primary} />
      </Pressable>
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
