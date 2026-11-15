import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CurrencyPicker } from '../components/CurrencyPicker';
import { BarChart, StackedBar } from '../components/env/charts';
import { LandBlocked } from '../components/env/LandBlocked';
import { MonthStrip, SEASON_STYLE, SeasonLegend, useSeasonNow, useSeasonText } from '../components/env/Seasons';
import { SaltCard, SoilFixesCard } from '../components/env/SoilFixes';
import { SoilTestCard } from '../components/env/SoilTestCard';
import { SourceInfo } from '../components/env/SourceInfo';
import { ZoneGrid } from '../components/env/ZoneGrid';
import { NetworkBanner } from '../components/NetworkBanner';
import {
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  FadeIn,
  Ionicons,
  type IconName,
  Pill,
  Segmented,
  tapFeedback,
} from '../components/ui';
import { latestSummaryForParcel, latestSummaryNear, saveSummary, type StoredSummary, updateSummary } from '../db/envRepository';
import { getParcel } from '../db/repositories';
import { ageInDays, analyzeLocation, type SectionKey } from '../env/analyze';
import { appFetchJson, appFetchRange } from '../env/appFetch';
import { countryProduction, GAEZ_GROUPS, GAEZ_PRICES, type GaezCode } from '../env/gaez';
import { LAND_COVER_CLASSES, SOURCES, STALE_AFTER_DAYS } from '../env/sources';
import { cropById, cropEmoji, cropName, CROPS } from '../env/crops';
import { plantNow, type Season, seasonsFor } from '../env/seasons';
import { soilFixPlan } from '../env/soilFixes';
import { landCheck, rankCrops, siteValues, siteWarnings } from '../env/suitability';
import type { EnvSummary, Section, SoilTest, SourceId } from '../env/types';
import { countryAt } from '../geo/countryAt';
import { formatCoordinate, formatHectares } from '../geo/format';
import type { LatLng } from '../geo/types';
import { useOnline } from '../hooks/useOnline';
import { useI18n } from '../i18n';
import { formatDate, localName } from '../i18n/format';
import type { TranslationKey } from '../i18n/en';
import { formatLargeMoney } from '../money/currency';
import { useMoney } from '../money/MoneyProvider';
import { countryByIso3, searchCountries } from '../search/countries';
import { useAppState } from '../state/AppState';
import { colors, radius, shadow, spacing, type } from '../theme/colors';

interface Target {
  location: LatLng;
  ring: LatLng[] | null;
  parcelId: string | null;
  title: string;
  subtitle: string;
}

const SECTIONS: { key: SectionKey; icon: IconName; label: TranslationKey }[] = [
  { key: 'climate', icon: 'rainy', label: 'env.step.climate' },
  { key: 'rainHistory', icon: 'bar-chart', label: 'env.step.rainHistory' },
  { key: 'terrain', icon: 'trending-up', label: 'env.step.terrain' },
  { key: 'landCover', icon: 'leaf', label: 'env.step.landCover' },
  { key: 'zones', icon: 'grid', label: 'env.step.zones' },
  { key: 'production', icon: 'stats-chart', label: 'env.step.production' },
];

type Tab = 'climate' | 'soil' | 'land' | 'farming';

/** Placeholder sections for results still downloading; SectionCard shows a spinner for these. */
const PENDING = new WeakSet<object>();
const SECTION_SOURCE: Record<SectionKey, SourceId> = {
  climate: 'nasa-power',
  rainHistory: 'nasa-power',
  terrain: 'aws-terrain',
  landCover: 'esa-worldcover',
  production: 'gaez',
  zones: 'esa-worldcover',
};

/** The analysis so far: finished sections as they are, the rest as placeholders. */
function liveSummary(target: Target, got: Partial<Record<SectionKey, Section<unknown>>>, startedAt: string): EnvSummary {
  const pick = (key: SectionKey) => {
    const done = got[key];
    if (done) return done;
    const placeholder = { status: 'no-data', source: SECTION_SOURCE[key], fetchedAt: startedAt, reason: '' } as const;
    PENDING.add(placeholder);
    return placeholder;
  };
  return {
    version: 1,
    location: target.location,
    ring: target.ring,
    createdAt: startedAt,
    climate: pick('climate'),
    rainHistory: pick('rainHistory'),
    terrain: pick('terrain'),
    landCover: pick('landCover'),
    production: pick('production'),
    zones: pick('zones'),
  } as EnvSummary;
}

/** Mean of the vertices: close enough to the middle for field-sized parcels. */
function ringCentre(ring: LatLng[]): LatLng {
  return {
    latitude: ring.reduce((a, p) => a + p.latitude, 0) / ring.length,
    longitude: ring.reduce((a, p) => a + p.longitude, 0) / ring.length,
  };
}

export default function AnalysisScreen() {
  const { parcelId, auto } = useLocalSearchParams<{ parcelId?: string; auto?: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const { t, language } = useI18n();
  const { selection } = useAppState();
  const [target, setTarget] = useState<Target | null | undefined>(undefined);
  const [stored, setStored] = useState<StoredSummary | null>(null);
  const storedRef = useRef<StoredSummary | null>(null);
  storedRef.current = stored;
  const saveSoilTest = useCallback(
    async (test: SoilTest | null) => {
      const current = storedRef.current;
      if (!current) return;
      const next: EnvSummary = { ...current.summary };
      if (test) next.soilTest = test;
      else delete next.soilTest;
      setStored(await updateSummary(db, current, next));
      tapFeedback('success');
    },
    [db],
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<SectionKey[]>([]);
  const [got, setGot] = useState<Partial<Record<SectionKey, Section<unknown>>>>({});
  const [startedAt, setStartedAt] = useState('');
  const [tab, setTab] = useState<Tab>('climate');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: Target | null = null;
      if (parcelId) {
        const p = await getParcel(db, parcelId);
        if (p) {
          next = {
            location: ringCentre(p.ring),
            ring: p.ring,
            parcelId: p.id,
            title: p.name,
            subtitle: `${formatHectares(p.areaSquareMeters / 10_000)} · ${p.vertexCount} ${t('draw.points').toLowerCase()}`,
          };
        }
      } else if (selection) {
        next = {
          location: { latitude: selection.latitude, longitude: selection.longitude },
          ring: null,
          parcelId: null,
          title: localName(selection, language) ?? t('globe.selected'),
          subtitle: `${formatCoordinate(selection.latitude, 'N', 'S', 5)}, ${formatCoordinate(selection.longitude, 'E', 'W', 5)}`,
        };
      }
      if (cancelled) return;
      setTarget(next);
      if (next) {
        setStored(
          next.parcelId
            ? await latestSummaryForParcel(db, next.parcelId)
            : await latestSummaryNear(db, next.location.latitude, next.location.longitude),
        );
      }
    })();
    return () => {
      cancelled = true;
      abort.current?.abort();
    };
    // Resolve the target once per screen; later selection changes belong to a new visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelId, db]);

  const run = useCallback(async () => {
    if (!target) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setDone([]);
    setGot({});
    setStartedAt(new Date().toISOString());
    try {
      const summary = await analyzeLocation(target.location, target.ring, {
        signal: controller.signal,
        fetchRange: appFetchRange,
        fetchJson: appFetchJson,
        // Each result is shown as soon as it arrives; slow sources don't hold up the rest.
        onSection: (k, section) => {
          setDone((d) => [...d, k]);
          setGot((g) => ({ ...g, [k]: section }));
        },
      });
      if (controller.signal.aborted) return;
      // The farmer's own soil test belongs to the land, not to one analysis: carry it over.
      const test = storedRef.current?.summary.soilTest;
      setStored(await saveSummary(db, test ? { ...summary, soilTest: test } : summary, target.parcelId));
      tapFeedback('success');
    } finally {
      if (!controller.signal.aborted) setRunning(false);
    }
  }, [db, target]);

  // Coming straight from measuring a field: check it without another tap.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (auto !== '1' || !target || autoStarted.current || online === false) return;
    autoStarted.current = true;
    void run();
  }, [auto, target, online, run]);

  if (target === undefined) return <View style={s.screen} />;
  if (target === null) {
    return (
      <View style={[s.screen, { justifyContent: 'center' }]}>
        <EmptyState
          icon="location-outline"
          title={t('env.noTarget')}
          text={t('local.noSelection')}
          action={<Button label={t('nav.globe')} icon="globe" onPress={() => router.back()} grow={false} />}
        />
      </View>
    );
  }

  const summary = running && done.length ? liveSummary(target, got, startedAt) : (stored?.summary ?? null);
  const age = summary ? ageInDays(summary.createdAt, new Date()) : 0;
  const updated = summary
    ? formatDate(summary.createdAt, language)
    : null;

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
      <View style={s.hero}>
        <Text style={s.heroLabel}>{t(target.parcelId ? 'env.forParcel' : 'env.forPoint')}</Text>
        <Text style={s.heroTitle} numberOfLines={2}>
          {target.title}
        </Text>
        <Text style={s.heroSub}>{target.subtitle}</Text>
        <View style={s.heroRow}>
          <View style={s.heroBadge}>
            <Ionicons name={summary ? 'time-outline' : 'sparkles-outline'} size={15} color={colors.white} />
            <Text style={s.heroBadgeText}>
              {summary ? `${t('env.updated')} ${updated} · ${age <= 0 ? t('env.today') : t('env.daysAgo', { n: age })}` : t('env.notYet')}
            </Text>
          </View>
        </View>
        <Button
          label={summary ? t('env.refresh') : t('env.run')}
          icon={summary ? 'refresh' : 'play'}
          variant="outline"
          onPress={() => void run()}
          busy={running}
          disabled={online === false}
          testID="run-analysis"
          style={{ marginTop: spacing.md, borderColor: colors.white }}
        />
      </View>

      <NetworkBanner />
      {online === false && summary ? <Banner kind="info">{t('env.offlineSaved', { date: updated ?? '' })}</Banner> : null}
      {summary && age > STALE_AFTER_DAYS ? <Banner kind="warning">{t('env.stale', { n: age })}</Banner> : null}

      {running ? (
        <Card title={t('env.fetching')} icon="cloud-download" iconColor={colors.secondary} iconBg={colors.secondaryLight}>
          {SECTIONS.map((sec) => {
            const finished = done.includes(sec.key);
            return (
              <View key={sec.key} style={s.stepRow}>
                <Ionicons name={sec.icon} size={18} color={colors.textMuted} />
                <Text style={s.stepText}>{t(sec.label)}</Text>
                {finished ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : <ActivityIndicator size="small" color={colors.secondary} />}
              </View>
            );
          })}
        </Card>
      ) : null}

      {!summary && !running ? (
        <Card title={t('env.introTitle')} icon="information-circle" iconColor={colors.secondary} iconBg={colors.secondaryLight}>
          <Text style={type.body}>{t('env.introBody')}</Text>
          <View style={{ gap: 6, marginTop: spacing.md }}>
            {Object.values(SOURCES).map((src) => (
              <Text key={src.id} style={type.small}>
                • {src.name} — {src.provider}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}

      {summary && (!running || done.length) ? (
        <FadeIn>
          <AtAGlance
            summary={summary}
            areaText={target.parcelId ? target.subtitle.split(' · ')[0] : null}
            running={running}
            onCrops={() => stored && router.push({ pathname: '/crops', params: { summaryId: stored.id } })}
          />
          {running ? null : <Warnings summary={summary} />}
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'climate', label: t('env.tab.climate'), icon: 'partly-sunny' },
              { value: 'soil', label: t('env.tab.soil'), icon: 'layers' },
              { value: 'land', label: t('env.tab.land'), icon: 'leaf' },
              { value: 'farming', label: t('env.tab.farming'), icon: 'stats-chart' },
            ]}
          />
          <View style={{ height: spacing.md }} />
          {tab === 'climate' ? <ClimatePanel summary={summary} /> : null}
          {tab === 'soil' ? <SoilPanel summary={summary} onSaveTest={stored && !running ? saveSoilTest : null} /> : null}
          {tab === 'land' ? <LandPanel summary={summary} /> : null}
          {tab === 'farming' ? <FarmingPanel summary={summary} /> : null}

          {running ? null : <CropsEntry summary={summary} onOpen={() => router.push({ pathname: '/crops', params: { summaryId: stored!.id } })} />}
          <Text style={[type.small, { marginTop: spacing.md, textAlign: 'center' }]}>{t('env.disclaimer')}</Text>
        </FadeIn>
      ) : null}
    </ScrollView>
  );
}

/** The measured land's headline numbers and what to sow now, so measuring leads straight to crops and weather. */
function AtAGlance({ summary, areaText, running, onCrops }: { summary: EnvSummary; areaText: string | null; running: boolean; onCrops: () => void }) {
  const { t, language } = useI18n();
  const site = siteValues(summary);
  const land = landCheck(summary);
  const fixes = useMemo(() => soilFixPlan(summary), [summary]);
  const month = new Date().getMonth();
  const now = useMemo(() => {
    if (running || !land.ok) return [];
    const results = rankCrops(summary, CROPS);
    return plantNow(results, month).filter((c) => !c.yearRound).slice(0, 3);
  }, [summary, running, land.ok, month]);
  const { months } = useSeasonText();
  return (
    <View style={s.glance} testID="at-a-glance">
      <Text style={s.glanceTitle}>{t('glance.title')}</Text>
      {!running && fixes.notSuitable ? (
        <Banner kind="warning" icon="construct">
          {t('fix.glance', { list: fixes.problems.filter((p) => p.severity === 'blocker').map((p) => t(`fix.p.${p.id}.title` as TranslationKey).toLowerCase()).join(', ') })}
        </Banner>
      ) : null}
      <View style={s.glanceRow}>
        {areaText ? <GlanceStat icon="crop" label={t('glance.area')} value={areaText} /> : null}
        <GlanceStat icon="rainy" label={t('glance.rain')} value={site.annualRainMm === null ? '–' : `${fmt(site.annualRainMm)} mm`} />
        <GlanceStat icon="thermometer" label={t('glance.temp')} value={site.annualTempC === null ? '–' : `${fmt(site.annualTempC, 1)} °C`} />
        <GlanceStat icon="flask" label={t('glance.ph')} value={site.ph === null ? t('glance.phNone') : fmt(site.ph, 1)} />
      </View>
      {!running && land.ok ? (
        <>
          <Text style={s.glanceSub}>{t('glance.plantNow')}</Text>
          {now.length ? (
            now.map((c) => {
              const crop = cropById(c.cropId)!;
              return (
                <View key={c.cropId} style={s.glanceCrop} testID={`glance-${c.cropId}`}>
                  <Text style={s.glanceCropName} numberOfLines={1}>
                    {cropEmoji(crop)} {cropName(crop, language)}
                  </Text>
                  <Text style={s.glanceCropMeta}>
                    {t('crops.sowNow', { month: months[c.option.month] })} · {c.option.score}
                  </Text>
                </View>
              );
            })
          ) : (
            <Text style={type.small}>{t('glance.noneNow')}</Text>
          )}
          <Pill primary icon="leaf" label={t('glance.allCrops')} onPress={onCrops} testID="glance-crops" />
        </>
      ) : null}
    </View>
  );
}

function GlanceStat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={s.glanceStat}>
      <Ionicons name={icon} size={15} color={colors.primary} />
      <Text style={s.glanceValue}>{value}</Text>
      <Text style={s.glanceLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/** The way on to crop advice, or why there is none: crops are only suggested where land cover shows farmland. */
function CropsEntry({ summary, onOpen }: { summary: EnvSummary; onOpen: () => void }) {
  const { t } = useI18n();
  const land = landCheck(summary);
  if (land.ok) {
    return <Button label={t('env.toCrops')} icon="leaf" onPress={onOpen} testID="to-crops" style={{ marginTop: spacing.sm }} />;
  }
  return <LandBlocked summary={summary} />;
}

function SeasonNowLine({ seasons }: { seasons: Season[] }) {
  const { line, current } = useSeasonNow(seasons);
  if (!line || !current) return null;
  return (
    <View style={s.nowRow} testID="season-now">
      <Ionicons name={SEASON_STYLE[current.kind].icon} size={18} color={SEASON_STYLE[current.kind].color} />
      <Text style={s.nowText}>{line}</Text>
    </View>
  );
}

function SeasonsCard({ summary }: { summary: EnvSummary }) {
  const { t } = useI18n();
  const text = useSeasonText();
  if (summary.climate.status !== 'ok') return null;
  const seasons = seasonsFor(summary.location, summary.climate.data);
  if (!seasons.length) return null;
  return (
    <Card title={t('season.title')} icon="calendar" iconColor={colors.primary} iconBg={colors.primaryLight} testID="card-seasons">
      <SeasonNowLine seasons={seasons} />
      <MonthStrip kinds={seasons} now={new Date().getMonth()} />
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {seasons.map((x) => (
          <View key={x.id} style={s.seasonRow}>
            <View style={[s.seasonIcon, { backgroundColor: `${SEASON_STYLE[x.kind].color}22` }]}>
              <Ionicons name={SEASON_STYLE[x.kind].icon} size={18} color={SEASON_STYLE[x.kind].color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.seasonName}>
                {text.name(x)} <Text style={s.seasonSpan}>{text.span(x)}</Text>
              </Text>
              <Text style={type.small}>{t('season.stats', { rain: fmt(x.rainMm), temp: fmt(x.meanTempC, 1) })}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={[type.small, { marginTop: spacing.md }]}>{t('season.caption', { mm: 100 })}</Text>
    </Card>
  );
}

function Warnings({ summary }: { summary: EnvSummary }) {
  const { t } = useI18n();
  const warnings = siteWarnings(summary);
  if (!warnings.length) return null;
  return (
    <>
      {warnings.map((w) => (
        <Banner key={w.key} kind="warning">
          {t(`env.warn.${w.key}` as TranslationKey, { pct: Math.round(w.value * 100), deg: w.value.toFixed(0) })}
        </Banner>
      ))}
    </>
  );
}

/** Shows a section's content, or its no-data / error state, plus the source details. */
function SectionCard<T>({
  title,
  icon,
  color,
  bg,
  section,
  period,
  children,
  testID,
}: {
  title: string;
  icon: IconName;
  color: string;
  bg: string;
  section: Section<T>;
  period?: string;
  children: (data: T) => ReactNode;
  testID?: string;
}) {
  const { t } = useI18n();
  if (PENDING.has(section)) {
    return (
      <Card title={title} icon={icon} iconColor={color} iconBg={bg} testID={testID}>
        <View style={s.missing} testID={testID ? `${testID}-loading` : undefined}>
          <ActivityIndicator size="small" color={colors.secondary} />
          <Text style={[type.small, { flex: 1 }]}>{t('env.loadingSection')}</Text>
        </View>
      </Card>
    );
  }
  return (
    <Card title={title} icon={icon} iconColor={color} iconBg={bg} testID={testID}>
      {section.status === 'ok' ? (
        children(section.data)
      ) : (
        <View style={s.missing}>
          <Ionicons name={section.status === 'error' ? 'cloud-offline-outline' : 'remove-circle-outline'} size={20} color={colors.textMuted} />
          <Text style={[type.small, { flex: 1 }]}>
            {section.status === 'error' ? t('env.sectionError', { reason: section.reason }) : t('env.sectionNoData', { reason: section.reason })}
          </Text>
        </View>
      )}
      <SourceInfo section={section} period={period} />
    </Card>
  );
}

function BigValue({ value, unit, caption }: { value: string; unit: string; caption?: string }) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={type.number}>
        {value} <Text style={s.unit}>{unit}</Text>
      </Text>
      {caption ? <Text style={type.small}>{caption}</Text> : null}
    </View>
  );
}

function Stat({ label, value, icon, color }: { label: string; value: string; icon: IconName; color: string }) {
  return (
    <View style={s.stat}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

/** Wet/dry colour for each month's rain bar, in the tropics where seasons follow rain. */
function seasonColours(summary: EnvSummary): (string | null)[] | undefined {
  if (summary.climate.status !== 'ok' || Math.abs(summary.location.latitude) >= 23.44) return undefined;
  const seasons = seasonsFor(summary.location, summary.climate.data);
  return [...Array(12).keys()].map((m) => {
    const owner = seasons.find((x) => x.months.includes(m));
    return owner ? SEASON_STYLE[owner.kind].color : null;
  });
}

const fmt = (v: number | null, digits = 0, unit = '') => (v === null ? '–' : `${v.toLocaleString('en-US', { maximumFractionDigits: digits })}${unit}`);

function ClimatePanel({ summary }: { summary: EnvSummary }) {
  const { t } = useI18n();
  const months = t('env.monthsLong').split(',');
  const axis = t('env.monthsAxis').split(',');
  const climatePeriod = summary.climate.status === 'ok' ? t('env.average', { period: summary.climate.data.period }) : undefined;
  return (
    <>
      <SectionCard
        title={t('env.rainfall')}
        icon="rainy"
        color={colors.secondary}
        bg={colors.secondaryLight}
        section={summary.climate}
        period={climatePeriod}
        testID="card-rainfall"
      >
        {(c) => (
          <>
            <BigValue value={fmt(c.annualRainMm)} unit={t('env.mmPerYear')} caption={t('env.rainCaption')} />
            <BarChart
              values={c.monthlyRainMm}
              labels={months}
              axisLabels={axis}
              format={(v) => `${Math.round(v)} mm`}
              barColors={seasonColours(summary)}
            />
            {Math.abs(summary.location.latitude) < 23.44 ? <SeasonLegend /> : null}
          </>
        )}
      </SectionCard>

      <SeasonsCard summary={summary} />

      <SectionCard
        title={t('env.rainHistory')}
        icon="bar-chart"
        color={colors.secondary}
        bg={colors.secondaryLight}
        section={summary.rainHistory}
        period={
          summary.rainHistory.status === 'ok' && summary.rainHistory.data.years.length
            ? `${summary.rainHistory.data.years[0].year}–${summary.rainHistory.data.years.at(-1)!.year}`
            : undefined
        }
      >
        {(h) => {
          const avg = h.years.reduce((a, y) => a + y.totalMm, 0) / h.years.length;
          const min = h.years.reduce((a, y) => (y.totalMm < a.totalMm ? y : a));
          const max = h.years.reduce((a, y) => (y.totalMm > a.totalMm ? y : a));
          return (
            <>
              <Text style={[type.small, { marginBottom: spacing.sm }]}>
                {t('env.rainRange', { min: fmt(min.totalMm), minYear: min.year, max: fmt(max.totalMm), maxYear: max.year })}
              </Text>
              <BarChart
                values={h.years.map((y) => y.totalMm)}
                labels={h.years.map((y) => String(y.year))}
                axisLabels={h.years.map((y) => `'${String(y.year).slice(2)}`)}
                format={(v) => `${fmt(v)} mm`}
                color="#3f8fd6"
                reference={{ value: avg, label: t('env.avg', { v: fmt(avg) }) }}
              />
            </>
          );
        }}
      </SectionCard>

      <SectionCard
        title={t('env.tempSun')}
        icon="sunny"
        color={colors.sun}
        bg={colors.sunLight}
        section={summary.climate}
        period={climatePeriod}
      >
        {(c) => (
          <>
            <View style={s.stats}>
              <Stat icon="thermometer" color="#d1495b" label={t('env.tempMean')} value={fmt(c.annualTempC, 1, ' °C')} />
              <Stat icon="arrow-up" color="#d1495b" label={t('env.tempMax')} value={fmt(c.annualTempMaxC, 1, ' °C')} />
              <Stat icon="arrow-down" color={colors.secondary} label={t('env.tempMin')} value={fmt(c.annualTempMinC, 1, ' °C')} />
            </View>
            <View style={{ height: spacing.md }} />
            <BigValue value={fmt(c.annualSolarKwhM2Day, 2)} unit={t('env.unitSolar')} caption={t('env.solarCaption')} />
            <BarChart
              values={c.monthlySolarKwhM2Day}
              labels={months}
              axisLabels={axis}
              format={(v) => `${v.toFixed(2)} ${t('env.unitSolar')}`}
              color={colors.sun}
              height={80}
            />
          </>
        )}
      </SectionCard>
    </>
  );
}

function SoilPanel({ summary, onSaveTest }: { summary: EnvSummary; onSaveTest: ((test: SoilTest | null) => void) | null }) {
  return (
    <>
      <SoilTestCard test={summary.soilTest} onSave={(test) => onSaveTest?.(test)} disabled={!onSaveTest} />
      <SoilFixesCard summary={summary} />
    </>
  );
}

function LandPanel({ summary }: { summary: EnvSummary }) {
  const { t } = useI18n();
  return (
    <>
      {summary.zones ? (
        <SectionCard title={t('zones.title')} icon="grid" color={colors.primary} bg={colors.primaryLight} section={summary.zones} testID="card-zones">
          {(z) => <ZoneGrid data={z} ring={summary.ring} />}
        </SectionCard>
      ) : (
        <OldSection title={t('zones.title')} icon="grid" />
      )}
      <SaltCard summary={summary} />
      <SectionCard title={t('env.terrain')} icon="trending-up" color={colors.soil} bg={colors.soilLight} section={summary.terrain} testID="card-terrain">
        {(tr) => (
          <View style={s.stats}>
            <Stat icon="arrow-up-circle" color={colors.soil} label={t('common.elevation')} value={`${fmt(tr.elevationM)} m`} />
            <Stat
              icon="trending-up"
              color={colors.soil}
              label={t('env.slope')}
              value={tr.slopeDeg === null ? '–' : `${tr.slopeDeg.toFixed(1)}°`}
            />
            <Stat icon="resize" color={colors.textMuted} label={t('env.cell')} value={`${fmt(tr.cellSizeM)} m`} />
          </View>
        )}
      </SectionCard>
      <SectionCard title={t('env.landCover')} icon="leaf" color={colors.primary} bg={colors.primaryLight} section={summary.landCover} testID="card-landcover">
        {(lc) => (
          <>
            <Text style={[type.small, { marginBottom: spacing.sm }]}>
              {summary.ring ? t('env.lcParcel', { n: lc.samples }) : t('env.lcPoint')}
            </Text>
            <StackedBar
              parts={lc.fractions.map((f) => ({
                label: LAND_COVER_CLASSES[f.code] ? t(LAND_COVER_CLASSES[f.code].key as TranslationKey) : `#${f.code}`,
                fraction: f.fraction,
                color: LAND_COVER_CLASSES[f.code]?.color ?? colors.textFaint,
              }))}
            />
          </>
        )}
      </SectionCard>
    </>
  );
}

/** Card shown when a saved analysis predates a section: the user can refresh to add it. */
function OldSection({ title, icon }: { title: string; icon: IconName }) {
  const { t } = useI18n();
  return (
    <Card title={title} icon={icon} iconColor={colors.textMuted} iconBg={colors.surfaceAlt}>
      <Text style={type.small}>{t('env.sectionOld')}</Text>
    </Card>
  );
}

const fmtArea = (t: (k: TranslationKey, p?: Record<string, string | number>) => string, ha: number) =>
  ha >= 1e6 ? t('farm.mha', { v: fmt(ha / 1e6, 1) }) : t('farm.kha', { v: fmt(ha / 1e3, ha >= 1e5 ? 0 : 1) });

/** A labelled bar for shares and comparisons. */
function ShareRow({ label, share, right, color = colors.primary, testID }: { label: string; share: number; right: string; color?: string; testID?: string }) {
  return (
    <View style={s.shareRow} testID={testID}>
      <View style={s.shareHead}>
        <Text style={s.shareLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={s.shareRight}>{right}</Text>
      </View>
      <View style={s.shareTrack}>
        <View style={[s.shareFill, { width: `${Math.max(2, Math.min(100, share * 100))}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function FarmingPanel({ summary }: { summary: EnvSummary }) {
  const { t } = useI18n();
  const local = summary.production;
  const iso3 = (local?.status === 'ok' ? local.data.country : null) ?? countryAt(summary.location);
  return (
    <>
      <CurrencyPicker iso3={iso3} />
      {local ? <LocalCropsCard summary={summary} iso3={iso3} /> : <OldSection title={t('farm.localTitle')} icon="stats-chart" />}
      <CountryCard initial={iso3} fetchedAt={summary.createdAt} />
      <Text style={[type.small, { marginTop: spacing.xs }]} testID="price-note">
        {t('farm.priceNote')}
      </Text>
    </>
  );
}

function LocalCropsCard({ summary, iso3 }: { summary: EnvSummary; iso3: string | null }) {
  const { t } = useI18n();
  const { money } = useMoney();
  const country = countryProduction(iso3);
  const countryValue = (code: GaezCode) => country?.crops.find((c) => c.code === code)?.valuePerHa ?? null;
  return (
    <SectionCard
      title={t('farm.localTitle')}
      icon="stats-chart"
      color={colors.primary}
      bg={colors.primaryLight}
      section={summary.production!}
      testID="card-local-crops"
    >
      {(p) => {
        const rows = p.crops.map((c) => {
          const code = c.code as GaezCode;
          const fromCountry = c.valuePerHa === null ? countryValue(code) : null;
          return { ...c, code, value: c.valuePerHa ?? fromCountry, countryAvg: fromCountry !== null };
        });
        const best = rows.filter((r) => r.value !== null).sort((a, b) => b.value! - a.value!)[0];
        const top = Math.max(...rows.map((r) => r.share), 0.01);
        return (
          <>
            <Text style={[type.small, { marginBottom: spacing.sm }]}>{t('farm.localIntro', { area: fmt(p.cellAreaHa) })}</Text>
            {rows.map((r) => (
              <View key={r.code} style={{ marginBottom: spacing.sm }}>
                <ShareRow
                  label={`${t(`gaez.${r.code}` as TranslationKey)}${GAEZ_GROUPS.has(r.code) ? ` (${t('farm.group')})` : ''}`}
                  share={r.share / top}
                  right={t('farm.share', { pct: fmt(r.share * 100, r.share < 0.1 ? 1 : 0) })}
                  testID={`local-crop-${r.code}`}
                />
                <Text style={type.small}>
                  {[
                    r.yieldT !== null ? t('farm.yield', { t: fmt(r.yieldT, 1) }) : null,
                    r.value !== null ? t(r.countryAvg ? 'farm.perHaCountry' : 'farm.perHa', { v: money(r.value) }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            ))}
            {best ? (
              <Banner kind="success" icon="cash-outline">
                {t('farm.bestValue', { crop: t(`gaez.${best.code}` as TranslationKey), v: money(best.value!) })}
              </Banner>
            ) : null}
          </>
        );
      }}
    </SectionCard>
  );
}

/** Farming economy of a country from the bundled GAEZ totals, with a picker for any other country. */
function CountryCard({ initial, fetchedAt }: { initial: string | null; fetchedAt: string }) {
  const { t, language } = useI18n();
  const { money, currency, rates } = useMoney();
  const [iso3, setIso3] = useState(initial);
  const [query, setQuery] = useState('');
  const place = iso3 ? countryByIso3(iso3) : null;
  const name = place ? (localName(place, language) ?? iso3) : null;
  const data = countryProduction(iso3);
  const results = searchCountries(query, 6);
  const byArea = data ? data.crops.slice(0, 8) : [];
  const byValue = data ? data.crops.filter((c) => c.valuePerHa !== null).sort((a, b) => b.valuePerHa! - a.valuePerHa!).slice(0, 8) : [];
  const maxValue = byValue[0]?.valuePerHa ?? 1;

  return (
    <Card title={name ? t('farm.countryTitle', { country: name }) : t('farm.otherCountry')} icon="globe" iconColor={colors.secondary} iconBg={colors.secondaryLight} testID="card-country">
      {!iso3 ? <Text style={type.small}>{t('farm.unknownCountry')}</Text> : null}
      {iso3 && !data ? <Text style={type.small}>{t('farm.noCountry')}</Text> : null}
      {data ? (
        <>
          <View style={s.stats}>
            <Stat icon="resize" color={colors.primary} label={t('farm.harvested')} value={fmtArea(t, data.areaHa)} />
            <Stat icon="cash" color={colors.sun} label={t('farm.prodValue')} value={formatLargeMoney(data.valueUsd, currency, (big, v) => t(big ? 'farm.bn' : 'farm.mn', { v }), rates)} />
            <Stat icon="water" color={colors.secondary} label={t('farm.irrigated')} value={`${fmt(data.irrigatedShare * 100)}%`} />
          </View>
          <Text style={s.subhead}>{t('farm.topCrops')}</Text>
          {byArea.map((c) => (
            <ShareRow
              key={c.code}
              label={t(`gaez.${c.code}` as TranslationKey)}
              share={c.areaHa / byArea[0].areaHa}
              right={`${fmt((c.areaHa / data.areaHa) * 100, 0)}% · ${fmtArea(t, c.areaHa)}`}
              testID={`country-crop-${c.code}`}
            />
          ))}
          <Text style={s.subhead}>{t('farm.valueRank')}</Text>
          {byValue.map((c) => (
            <ShareRow
              key={c.code}
              label={`${t(`gaez.${c.code}` as TranslationKey)}${GAEZ_GROUPS.has(c.code) ? ` (${t('farm.group')})` : ''}`}
              share={c.valuePerHa! / maxValue}
              right={t('farm.perHa', { v: money(c.valuePerHa!) })}
              color={colors.sun}
              testID={`country-value-${c.code}`}
            />
          ))}
          <Text style={s.subhead}>{t('farm.prices')}</Text>
          <View style={s.priceGrid}>
            {byArea
              .filter((c) => GAEZ_PRICES[c.code] !== null)
              .map((c) => (
                <View key={c.code} style={s.priceCell}>
                  <Text style={s.priceName} numberOfLines={1}>
                    {t(`gaez.${c.code}` as TranslationKey)}
                  </Text>
                  <Text style={s.priceValue}>{money(GAEZ_PRICES[c.code]!)}</Text>
                </View>
              ))}
          </View>
        </>
      ) : null}
      <Text style={s.subhead}>{t('farm.otherCountry')}</Text>
      <View style={s.searchBox}>
        <Ionicons name="search" size={18} color={colors.secondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('farm.searchCountry')}
          placeholderTextColor={colors.textFaint}
          style={s.searchInput}
          accessibilityLabel={t('farm.searchCountry')}
          testID="country-search"
        />
      </View>
      {results.length ? (
        <View style={s.chipWrap}>
          {results.map((r) => {
            const code = r.id.replace('country:', '');
            return (
              <Chip
                key={r.id}
                label={localName(r, language) ?? r.name}
                selected={code === iso3}
                onPress={() => {
                  setIso3(code);
                  setQuery('');
                }}
                testID={`country-pick-${code}`}
              />
            );
          })}
        </View>
      ) : null}
      <SourceInfo section={{ status: 'ok', source: 'gaez', fetchedAt, data: null }} />
    </Card>
  );
}

const s = StyleSheet.create({
  glance: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm, ...shadow.card },
  glanceTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  glanceRow: { flexDirection: 'row', gap: spacing.sm },
  glanceStat: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, gap: 2 },
  glanceValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  glanceLabel: { fontSize: 11, color: colors.textMuted },
  glanceSub: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: spacing.xs },
  glanceCrop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 2 },
  glanceCropName: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.text },
  glanceCropMeta: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  nowText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  screen: { flex: 1, backgroundColor: colors.background },
  seasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  seasonIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  seasonName: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  seasonSpan: { fontSize: 13.5, fontWeight: '500', color: colors.textMuted },
  content: { padding: spacing.lg, gap: spacing.xs },
  hero: {
    backgroundColor: colors.primaryDark,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  heroLabel: { color: '#bfe3cf', fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  heroTitle: { color: colors.white, fontSize: 21, fontWeight: '700', marginTop: 4 },
  heroSub: { color: '#d7efe1', fontSize: 12, marginTop: 2 },
  heroRow: { flexDirection: 'row', marginTop: spacing.md },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  heroBadgeText: { color: colors.white, fontSize: 13, fontWeight: '600' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 36 },
  stepText: { flex: 1, fontSize: 13, color: colors.text },
  missing: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.sm },
  unit: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  statValue: { fontSize: 15.5, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 12.5, color: colors.textMuted },
  subhead: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  shareRow: { marginBottom: spacing.xs },
  shareHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  shareLabel: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.text },
  shareRight: { fontSize: 13.5, color: colors.textMuted },
  shareTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, marginTop: 3, overflow: 'hidden' },
  shareFill: { height: 8, borderRadius: 4 },
  priceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  priceCell: { width: '48%', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm },
  priceName: { fontSize: 13, color: colors.textMuted },
  priceValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text, paddingVertical: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});

