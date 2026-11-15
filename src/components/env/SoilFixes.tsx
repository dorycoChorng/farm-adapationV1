import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { cropById, cropName } from '../../env/crops';
import type { SaltRisk } from '../../env/salinity';
import { type Severity, soilFixPlan, type SoilProblem } from '../../env/soilFixes';
import type { EnvSummary } from '../../env/types';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';
import { colors, radius, spacing, type } from '../../theme/colors';
import { Card, Ionicons } from '../ui';

const SEVERITY_STYLE: Record<Severity, { fg: string; bg: string }> = {
  blocker: { fg: colors.danger, bg: colors.dangerBg },
  major: { fg: colors.warning, bg: colors.warningBg },
  minor: { fg: colors.secondary, bg: colors.infoBg },
};

const SALT_STYLE: Record<SaltRisk['level'], { fg: string; bg: string; icon: 'water' | 'alert-circle' | 'warning' }> = {
  low: { fg: colors.secondary, bg: colors.infoBg, icon: 'water' },
  medium: { fg: colors.warning, bg: colors.warningBg, icon: 'alert-circle' },
  high: { fg: colors.danger, bg: colors.dangerBg, icon: 'warning' },
};

/** "Fix the land": terrain problems (slope, high ground, wet spots, salt) and, once the farmer enters a soil test, soil problems; worst first, with steps and crops that cope. */
export function SoilFixesCard({ summary }: { summary: EnvSummary }) {
  const { t } = useI18n();
  const plan = useMemo(() => soilFixPlan(summary), [summary]);
  return (
    <Card title={t('fix.title')} icon="construct" iconColor={colors.soil} iconBg={colors.soilLight} testID="card-soil-fixes">
      {plan.notSuitable ? (
        <View style={[st.banner, { backgroundColor: colors.dangerBg }]} testID="land-not-suitable">
          <Ionicons name="alert-circle" size={22} color={colors.danger} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[st.bannerTitle, { color: colors.danger }]}>{t('fix.notSuitableTitle')}</Text>
            <Text style={type.small}>{t('fix.notSuitableBody')}</Text>
          </View>
        </View>
      ) : plan.problems.length ? (
        <Text style={[type.small, { marginBottom: spacing.sm }]}>{t('fix.okBody')}</Text>
      ) : null}
      {plan.problems.length ? (
        plan.problems.map((p) => <Problem key={p.id} problem={p} />)
      ) : (
        <Text style={type.body}>{t('fix.none')}</Text>
      )}
      {summary.soilTest ? null : (
        <Text style={[type.body, { marginTop: spacing.sm }]} testID="fix-no-test">
          {t('fix.noTest')}
        </Text>
      )}
      <Text style={[type.small, { marginTop: spacing.sm }]}>{t('fix.testFirst')}</Text>
    </Card>
  );
}

const fmtValue = (p: SoilProblem) => {
  if (p.value === null) return '';
  if (p.id === 'low-spots') return String(Math.round(p.value * 100));
  return p.value < 20 ? p.value.toFixed(1) : String(Math.round(p.value));
};

function Problem({ problem }: { problem: SoilProblem }) {
  const { t, language } = useI18n();
  const sev = SEVERITY_STYLE[problem.severity];
  const steps = t(`fix.p.${problem.id}.steps` as TranslationKey).split('\n');
  const crops = problem.crops
    .map((id) => cropById(id))
    .filter((c) => c !== undefined)
    .map((c) => cropName(c, language));
  return (
    <View style={[st.problem, { borderLeftColor: sev.fg }]} testID={`fix-${problem.id}`}>
      <View style={st.problemHead}>
        <Text style={st.problemTitle}>{t(`fix.p.${problem.id}.title` as TranslationKey)}</Text>
        <View style={[st.badge, { backgroundColor: sev.bg }]}>
          <Text style={[st.badgeText, { color: sev.fg }]}>{t(`fix.severity.${problem.severity}` as TranslationKey)}</Text>
        </View>
      </View>
      {problem.measured ? <Text style={st.measured}>{t('fix.measured')}</Text> : null}
      <Text style={type.small}>
        {problem.measured && problem.value === null && (problem.id === 'sandy' || problem.id === 'heavy-clay')
          ? t(`fix.p.${problem.id}.whyTest` as TranslationKey)
          : t(`fix.p.${problem.id}.why` as TranslationKey, { v: fmtValue(problem) })}
      </Text>
      {steps.map((step, i) => (
        <View key={i} style={st.step}>
          <Text style={st.stepDot}>•</Text>
          <Text style={[type.body, { flex: 1 }]}>{step}</Text>
        </View>
      ))}
      {crops.length ? <Text style={[type.small, { marginTop: 4 }]}>{t('fix.crops', { list: crops.join(', ') })}</Text> : null}
    </View>
  );
}

/** "Salty or fresh water?": the salt-risk rating, the clues behind it and how to test. */
export function SaltCard({ summary }: { summary: EnvSummary }) {
  const { t } = useI18n();
  const risk = useMemo(() => soilFixPlan(summary).salt, [summary]);
  const style = SALT_STYLE[risk.level];
  const band = risk.measuredEc === null ? '' : t(risk.measuredEc > 3 ? 'salt.band.severe' : risk.measuredEc >= 0.7 ? 'salt.band.care' : 'salt.band.fine');
  const params = {
    ec: risk.measuredEc ?? '–',
    band,
    km: risk.coastKm === null ? '–' : risk.coastKm < 20 ? risk.coastKm.toFixed(0) : String(Math.round(risk.coastKm / 5) * 5),
    m: risk.elevationM === null ? '–' : String(Math.round(risk.elevationM)),
    n: risk.dryMonths ?? '–',
    ai: risk.aridity === null ? '–' : risk.aridity.toFixed(2),
  };
  return (
    <Card title={t('salt.title')} icon="water" iconColor={colors.secondary} iconBg={colors.infoBg} testID="card-salt">
      <View style={[st.banner, { backgroundColor: style.bg }]} testID={`salt-${risk.level}`}>
        <Ionicons name={style.icon} size={22} color={style.fg} />
        <Text style={[st.bannerTitle, { color: style.fg, flex: 1 }]}>{t(`salt.level.${risk.level}` as TranslationKey)}</Text>
      </View>
      {risk.reasons.map((r) => (
        <View key={r} style={st.step}>
          <Text style={st.stepDot}>•</Text>
          <Text style={[type.body, { flex: 1 }]}>{t(`salt.reason.${r}` as TranslationKey, params)}</Text>
        </View>
      ))}
      <Text style={[type.body, { marginTop: spacing.sm }]}>{t('salt.test')}</Text>
      <Text style={[type.small, { marginTop: spacing.xs }]}>{t('salt.sources')}</Text>
    </Card>
  );
}

const st = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  bannerTitle: { fontSize: 14.5, fontWeight: '700' },
  problem: { borderLeftWidth: 4, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, padding: spacing.md, marginTop: spacing.sm, gap: 2 },
  problemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  problemTitle: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  step: { flexDirection: 'row', gap: 6, marginTop: 3 },
  stepDot: { fontSize: 15, color: colors.textMuted, lineHeight: 20 },
  measured: { fontSize: 12, fontWeight: '700', color: colors.primary },
});
