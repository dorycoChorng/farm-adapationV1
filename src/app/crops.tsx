import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CropPhoto } from '../components/CropPhoto';
import { CurrencyPicker } from '../components/CurrencyPicker';
import { RangeBar, ScoreRing } from '../components/env/charts';
import { LandBlocked } from '../components/env/LandBlocked';
import { MonthStrip, SEASON_STYLE, useSeasonNow, useSeasonText } from '../components/env/Seasons';
import { Badge, Banner, Button, Card, Chip, EmptyState, FadeIn, Ionicons, PressableScale, Segmented, tapFeedback } from '../components/ui';
import { getSummary, recommend, type StoredSummary } from '../db/envRepository';
import { ageInDays } from '../env/analyze';
import { cropValue, type CropValue, isCommonCrop } from '../env/gaez';
import { countryAt } from '../geo/countryAt';
import {
  CROP_CATEGORIES,
  type CropCategory,
  cropById,
  cropEmoji,
  cropName,
  CROPS,
  cycleMonths,
  type FactorKey,
  searchCrops,
} from '../env/crops';
import { type PlantNowCrop, plantNow, type SeasonalAssessment, type SeasonCropResult, seasonalAssessment, WAIT_GAP } from '../env/seasons';
import { STALE_AFTER_DAYS } from '../env/sources';
import { classify, type CropResult, goodSowMonths, landCheck, monthRuns, rankCrops, siteWarnings } from '../env/suitability';
import { useI18n } from '../i18n';
import { useMoney } from '../money/MoneyProvider';
import { formatDate } from '../i18n/format';
import type { TranslationKey } from '../i18n/en';
import { countryByIso3 } from '../search/countries';
import { colors, radius, spacing, suitabilityColors, type } from '../theme/colors';

const FACTORS: FactorKey[] = ['rain', 'temp', 'ph'];
const FACTOR_FORMAT: Record<FactorKey, (v: number) => string> = {
  rain: (v) => `${Math.round(v).toLocaleString('en-US')} mm`,
  temp: (v) => `${v.toFixed(1)} °C`,
  ph: (v) => v.toFixed(1),
};
const FACTOR_ICON = { rain: 'rainy', temp: 'thermometer', ph: 'flask' } as const;
const PAGE = 20;

type Mode = 'now' | 'seasons' | 'ranking' | 'compare' | 'value';
type Filter = 'all' | CropCategory;

const scoreColor = (score: number | null) => suitabilityColors[classify(score)];

export default function CropsScreen() {
  const { summaryId, q } = useLocalSearchParams<{ summaryId?: string; q?: string }>();
  const router = useRouter();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { t, language } = useI18n();
  const [stored, setStored] = useState<StoredSummary | null | undefined>(undefined);
  const [mode, setMode] = useState<Mode>('now');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState(q ?? '');
  const [open, setOpen] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  // The short list of crops farmers in this country actually grow, unless the user asks for all.
  const [commonOnly, setCommonOnly] = useState(true);

  // A plant identified on the scan screen comes back as a search.
  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    if (q) setQuery(q);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = summaryId ? await getSummary(db, summaryId) : null;
      if (cancelled) return;
      setStored(s);
      // Keeps the crop catalogue and this recommendation in SQLite; nothing is stored off farmland.
      if (s) await recommend(db, s, CROPS);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, summaryId]);

  // Scores are recomputed from the saved data every visit, so this works offline.
  const farmland = !!stored && landCheck(stored.summary).ok;
  const results = useMemo(() => (stored && farmland ? rankCrops(stored.summary, CROPS) : []), [stored, farmland]);
  const byId = useMemo(() => new Map(results.map((r) => [r.cropId, r])), [results]);
  const seasonal = useMemo(() => (stored && farmland ? seasonalAssessment(stored.summary, results) : []), [stored, farmland, results]);
  // Typical value per hectare (GAEZ yield × FAO international price), for the Earnings tab and badges.
  const values = useMemo(() => {
    const map = new Map<string, CropValue>();
    if (!stored || !farmland) return map;
    const prod = stored.summary.production?.status === 'ok' ? stored.summary.production.data : null;
    const iso3 = prod?.country ?? countryAt(stored.summary.location);
    for (const crop of CROPS) {
      const v = cropValue(crop, prod, iso3);
      if (v) map.set(crop.id, v);
    }
    return map;
  }, [stored, farmland]);
  const iso3 = stored ? ((stored.summary.production?.status === 'ok' ? stored.summary.production.data.country : null) ?? countryAt(stored.summary.location)) : null;
  // What to sow this month or next, by the phone's date.
  const month = new Date().getMonth();
  const now = useMemo(() => plantNow(results, month, (id) => values.get(id)?.valuePerHa ?? null), [results, month, values]);
  const common = useMemo(() => new Set(CROPS.filter((c) => isCommonCrop(c, iso3)).map((c) => c.id)), [iso3]);

  if (stored === undefined) return <View style={s.screen} />;
  if (stored && !farmland) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
        <View style={s.hero}>
          <Text style={s.heroLabel}>{t('crops.title')}</Text>
          <Text style={s.heroTitle}>{t('land.toCropsBlocked')}</Text>
        </View>
        <LandBlocked summary={stored.summary} />
      </ScrollView>
    );
  }
  if (!stored) {
    return (
      <View style={[s.screen, { justifyContent: 'center' }]}>
        <EmptyState icon="leaf-outline" title={t('crops.noSummary')} />
      </View>
    );
  }

  const age = ageInDays(stored.summary.createdAt, new Date());
  const date = formatDate(stored.summary.createdAt, language);
  const best = results.find((r) => r.score !== null && r.score > 0 && (!commonOnly || common.has(r.cropId)));
  const inCategory = (id: string) => filter === 'all' || cropById(id)?.category === filter;
  const inFilter = (id: string) => inCategory(id) && (!commonOnly || common.has(id));
  const countryName = iso3 ? (countryByIso3(iso3)?.[language === 'km' ? 'nameKm' : 'name'] ?? countryByIso3(iso3)?.name ?? null) : null;
  const monthly = results.some((r) => r.months.length === 12);
  const view: Mode = (mode === 'seasons' && !seasonal.length) || (mode === 'now' && !monthly) ? 'ranking' : mode;
  const activeSeason = seasonal.find((x) => x.season.id === seasonId) ?? seasonal[0];
  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => (o === id ? null : id));
  };
  const resetPaging = () => setLimit(PAGE);

  const matches = query.trim()
    ? searchCrops(query)
        // A search looks through every crop, not only the common ones.
        .filter((m) => inCategory(m.crop.id))
        // Among equally good name matches, the better-suited crop first.
        .sort((a, b) => a.rank - b.rank || (byId.get(b.crop.id)?.score ?? -1) - (byId.get(a.crop.id)?.score ?? -1))
    : null;
  const ranked = results.filter((r) => inFilter(r.cropId));

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xxl }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.hero}>
        <View style={{ flex: 1 }}>
          <Text style={s.heroLabel}>{t('crops.title')}</Text>
          {best ? (
            <Text style={s.heroTitle}>
              {cropEmoji(cropById(best.cropId)!)} {t('crops.bestFit', { crop: cropName(cropById(best.cropId)!, language) })}
            </Text>
          ) : (
            <Text style={s.heroTitle}>{t('crops.noScores')}</Text>
          )}
          <Text style={s.heroSub}>{t('crops.basedOn', { date })}</Text>
          <Text style={s.heroSub}>{t('crops.catalogue', { n: CROPS.length })}</Text>
        </View>
        {/* Photo of the best crop; tap it to open the zoomable viewer. */}
        {best ? <CropPhoto crop={cropById(best.cropId)!} size={112} hideIfMissing /> : null}
      </View>

      {age > STALE_AFTER_DAYS ? <Banner kind="warning">{t('env.stale', { n: age })}</Banner> : null}
      {siteWarnings(stored.summary).map((w) => (
        <Banner key={w.key} kind="warning">
          {t(`env.warn.${w.key}` as TranslationKey, { pct: Math.round(w.value * 100), deg: w.value.toFixed(0) })}
        </Banner>
      ))}
      <Banner kind="info" icon="school-outline">
        {t('crops.indicative')}
      </Banner>
      {stored.summary.soilTest?.ph == null ? (
        <Banner kind="info" icon="flask-outline">
          {t('crops.noPh')}
        </Banner>
      ) : (
        <Banner kind="success" icon="flask">
          {t('crops.withPh', { ph: stored.summary.soilTest.ph })}
        </Banner>
      )}

      <View style={s.searchBox}>
        <Ionicons name="search" size={20} color={colors.primary} />
        <TextInput
          value={query}
          onChangeText={(q) => {
            setQuery(q);
            resetPaging();
          }}
          placeholder={t('crops.searchPlaceholder')}
          placeholderTextColor={colors.textFaint}
          returnKeyType="search"
          style={s.searchInput}
          accessibilityLabel={t('crops.searchPlaceholder')}
          testID="crop-search"
        />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('crops.searchClear')} onPress={() => setQuery('')} hitSlop={12}>
            <Ionicons name="close-circle" size={20} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>

      <Button
        label={t('scan.button')}
        icon="scan"
        variant="soft"
        onPress={() => router.push({ pathname: '/scan', params: { summaryId: stored.id } })}
        testID="open-scan"
        style={{ marginTop: spacing.sm }}
      />

      <View style={s.commonRow} testID="common-toggle">
        <Chip
          icon="flag"
          label={countryName ? t('crops.commonIn', { country: countryName, n: common.size }) : t('crops.commonOnly', { n: common.size })}
          selected={commonOnly}
          onPress={() => {
            setCommonOnly(true);
            resetPaging();
          }}
          testID="crops-common"
        />
        <Chip
          label={t('crops.allCrops', { n: CROPS.length })}
          selected={!commonOnly}
          onPress={() => {
            setCommonOnly(false);
            resetPaging();
          }}
          testID="crops-all"
        />
      </View>
      {commonOnly ? <Text style={[type.small, { marginTop: 4 }]}>{t('crops.commonNote')}</Text> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow} keyboardShouldPersistTaps="handled">
        {(['all', ...CROP_CATEGORIES] as Filter[]).map((c) => (
          <Chip
            key={c}
            label={t(`crops.cat.${c}` as TranslationKey)}
            selected={filter === c}
            onPress={() => {
              setFilter(c);
              resetPaging();
            }}
            testID={`crop-cat-${c}`}
          />
        ))}
      </ScrollView>

      {matches ? (
        <View testID="crop-search-results">
          <Text style={[type.small, { marginBottom: spacing.sm }]}>
            {matches.length ? t('crops.searchCount', { n: matches.length }) : t('crops.searchNone', { q: query.trim() })}
          </Text>
          {matches.slice(0, limit).map((m) => {
            const r = byId.get(m.crop.id);
            return r ? (
              <CropCard key={m.crop.id} result={r} matched={m.matched} value={values.get(m.crop.id)} open={open === m.crop.id} onToggle={() => toggle(m.crop.id)} />
            ) : null;
          })}
          <MoreButton left={matches.length - limit} onPress={() => setLimit((n) => n + PAGE)} />
        </View>
      ) : (
        <>
          <Segmented<Mode>
            value={view}
            onChange={(m) => {
              setMode(m);
              resetPaging();
            }}
            options={[
              ...(monthly ? [{ value: 'now' as const, label: t('crops.tab.now'), icon: 'today' as const }] : []),
              ...(seasonal.length ? [{ value: 'seasons' as const, label: t('crops.tab.seasons'), icon: 'calendar' as const }] : []),
              { value: 'ranking', label: t('crops.yearly'), icon: 'podium' },
              { value: 'compare', label: t('crops.compare'), icon: 'grid' },
              { value: 'value', label: t('crops.tab.value'), icon: 'cash' },
            ]}
          />
          <View style={{ height: spacing.sm }} />

          {view === 'now' ? (
            <PlantNowView
              crops={now.filter((c) => inFilter(c.cropId))}
              results={byId}
              month={month}
              seasonal={seasonal}
              values={values}
              limit={limit}
              onMore={() => setLimit((n) => n + PAGE)}
            />
          ) : view === 'seasons' && activeSeason ? (
            <SeasonsView
              seasonal={seasonal}
              active={activeSeason}
              onPick={(id) => {
                setSeasonId(id);
                resetPaging();
              }}
              filter={inFilter}
              limit={limit}
              onMore={() => setLimit((n) => n + PAGE)}
            />
          ) : view === 'ranking' ? (
            <>
              {ranked.slice(0, limit).map((r, i) => (
                <FadeIn key={r.cropId} delay={Math.min(i, 10) * 40}>
                  <CropCard
                    result={r}
                    rank={r.score === null ? null : i + 1}
                    value={values.get(r.cropId)}
                    open={open === r.cropId}
                    onToggle={() => toggle(r.cropId)}
                  />
                </FadeIn>
              ))}
              <MoreButton left={ranked.length - limit} onPress={() => setLimit((n) => n + PAGE)} />
            </>
          ) : view === 'value' ? (
            <EarningsView results={ranked} values={values} iso3={iso3} limit={limit} onMore={() => setLimit((n) => n + PAGE)} />
          ) : (
            <CompareTable results={ranked.slice(0, 12)} />
          )}
        </>
      )}

      <Card title={t('crops.methodTitle')} icon="calculator" iconColor={colors.secondary} iconBg={colors.secondaryLight}>
        <Text style={type.body}>{t('crops.method')}</Text>
        {seasonal.length ? <Text style={[type.body, { marginTop: spacing.sm }]}>{t('crops.seasonMethod')}</Text> : null}
        <Text style={[type.small, { marginTop: spacing.sm }]}>{t('crops.profileSource')}</Text>
      </Card>
    </ScrollView>
  );
}

function MoreButton({ left, onPress }: { left: number; onPress: () => void }) {
  const { t } = useI18n();
  if (left <= 0) return null;
  return <Button label={t('crops.showMore', { n: left })} icon="chevron-down" variant="soft" onPress={onPress} testID="crops-more" style={{ marginBottom: spacing.md }} />;
}

/** Suitable crops ranked by the typical value of a hectare's harvest. */
function EarningsView({
  results,
  values,
  iso3,
  limit,
  onMore,
}: {
  results: CropResult[];
  values: Map<string, CropValue>;
  iso3: string | null;
  limit: number;
  onMore: () => void;
}) {
  const { t, language } = useI18n();
  const { money } = useMoney();
  const rows = results
    .filter((r) => r.score !== null && r.score >= 50 && values.has(r.cropId))
    .map((r) => ({ r, v: values.get(r.cropId)! }))
    .sort((a, b) => b.v.valuePerHa - a.v.valuePerHa || b.r.score! - a.r.score!);
  const top = rows[0]?.v.valuePerHa ?? 1;
  return (
    <View testID="earnings-view">
      <CurrencyPicker iso3={iso3} />
      <Text style={[type.small, { marginBottom: spacing.sm }]}>{t('crops.valueIntro')}</Text>
      {!rows.length ? <EmptyState icon="cash-outline" title={t('crops.valueNone')} /> : null}
      {rows.slice(0, limit).map(({ r, v }, i) => {
        const crop = cropById(r.cropId)!;
        const color = scoreColor(r.score);
        return (
          <FadeIn key={r.cropId} delay={Math.min(i, 10) * 40}>
            <View style={s.cropCard} testID={`value-${crop.id}`}>
              <View style={s.cropRow}>
                <ScoreRing score={r.score} color={color} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.cropName}>
                    {cropEmoji(crop)} {cropName(crop, language)}
                  </Text>
                  <Text style={s.valueBig}>{t('farm.perHa', { v: money(v.valuePerHa) })}</Text>
                  <View style={s.valueTrack}>
                    <View style={[s.valueFill, { width: `${Math.max(3, (v.valuePerHa / top) * 100)}%` }]} />
                  </View>
                </View>
              </View>
              <Text style={s.limiting}>
                {t('crops.valueFrom', { yield: v.yieldT.toFixed(1), price: money(v.price) })}
                {v.from === 'country' ? ` · ${t('crops.valueCountry')}` : ` · ${t('crops.valueLocal')}`}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {v.group ? <Badge label={t('crops.valueGroup', { group: t(`gaez.${v.code}` as TranslationKey).toLowerCase() })} color={colors.textMuted} /> : null}
                {v.localShare !== null && v.localShare >= 0.01 ? <Badge label={t('farm.grownHere')} color={colors.primary} /> : null}
              </View>
            </View>
          </FadeIn>
        );
      })}
      <MoreButton left={rows.length - limit} onPress={onMore} />
      <Text style={[type.small, { marginBottom: spacing.md }]}>{t('farm.priceNote')}</Text>
    </View>
  );
}

/** Crops to sow this month or next, from the phone's date and the site's month-by-month scores. */
function PlantNowView({
  crops,
  results,
  month,
  seasonal,
  values,
  limit,
  onMore,
}: {
  crops: PlantNowCrop[];
  results: Map<string, CropResult>;
  month: number;
  seasonal: SeasonalAssessment[];
  values: Map<string, CropValue>;
  limit: number;
  onMore: () => void;
}) {
  const { t } = useI18n();
  const text = useSeasonText();
  const { line, current } = useSeasonNow(seasonal.map((x) => x.season));
  const sown = crops.filter((c) => !c.yearRound);
  const perennial = crops.filter((c) => c.yearRound);
  const style = current ? SEASON_STYLE[current.kind] : null;
  return (
    <View testID="plant-now-view">
      <View style={[s.seasonHead, { borderColor: style ? `${style.color}55` : colors.border }]}>
        <View style={s.seasonTitleRow}>
          <View style={[s.seasonIcon, { backgroundColor: style?.color ?? colors.primary }]}>
            <Ionicons name={style?.icon ?? 'today'} size={20} color={colors.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.seasonName}>{t('crops.nowTitle', { month: text.months[month], next: text.months[(month + 1) % 12] })}</Text>
            {line ? (
              <Text style={type.small} testID="plant-now-season">
                {line}
              </Text>
            ) : null}
          </View>
        </View>
        {current ? <MonthStrip kinds={seasonal.map((x) => x.season)} now={month} /> : null}
        <Text style={[type.small, { marginTop: spacing.xs }]}>{t('crops.nowIntro', { min: 50 })}</Text>
      </View>
      {!crops.length ? <EmptyState icon="calendar-outline" title={t('crops.nowNone', { min: 50 })} /> : null}
      {sown.slice(0, limit).map((c, i) => (
        <FadeIn key={c.cropId} delay={Math.min(i, 10) * 40}>
          <PlantNowCard item={c} result={results.get(c.cropId)} value={values.get(c.cropId)} />
        </FadeIn>
      ))}
      <MoreButton left={sown.length - limit} onPress={onMore} />
      {perennial.length ? (
        <>
          <Text style={s.nowHead}>{t('crops.nowPerennials')}</Text>
          {perennial.slice(0, 6).map((c) => (
            <PlantNowCard key={c.cropId} item={c} result={results.get(c.cropId)} value={values.get(c.cropId)} />
          ))}
        </>
      ) : null}
    </View>
  );
}

function PlantNowCard({ item, result, value }: { item: PlantNowCrop; result?: CropResult; value?: CropValue }) {
  const { t, language } = useI18n();
  const { money } = useMoney();
  const { months } = useSeasonText();
  const crop = cropById(item.cropId)!;
  const o = item.option;
  const suit = classify(o.score);
  const waitPays = !item.yearRound && item.bestMonth !== null && item.bestScore - o.score >= WAIT_GAP;
  return (
    <View style={s.cropCard} testID={`now-${crop.id}`}>
      <View style={s.cropRow}>
        <ScoreRing score={o.score} color={suitabilityColors[suit]} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.cropName}>
            {cropEmoji(crop)} {cropName(crop, language)}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={item.yearRound ? t('crops.nowAnyTime') : t('crops.sowNow', { month: months[o.month] })} color={colors.primary} />
            {item.irrigated ? <Badge label={t('crops.needsWater')} color={colors.secondary} /> : null}
            {value && !value.group ? <Badge label={t('farm.cropBadge', { v: money(value.valuePerHa) })} color={colors.sun} /> : null}
            {waitPays ? (
              <Badge label={t('crops.betterLater', { month: months[item.bestMonth!], score: item.bestScore })} color={colors.textMuted} />
            ) : !item.yearRound && o.score >= item.bestScore ? (
              <Badge label={t('crops.nowBest')} color={colors.primaryDark} />
            ) : null}
          </View>
        </View>
        <CropPhoto crop={crop} />
      </View>
      {result ? <SowWindow result={result} perennial={item.yearRound} /> : null}
      <Text style={s.limiting}>{t('crops.cycle', { rain: o.rainMm.toLocaleString('en-US'), n: cycleMonths(crop), temp: o.tempC.toFixed(1) })}</Text>
    </View>
  );
}

/** When to sow: "any month", or the runs of months that score 50 or more, e.g. "November – February, June". */
function SowWindow({ result, perennial }: { result: CropResult; perennial: boolean }) {
  const { t } = useI18n();
  const { months } = useSeasonText();
  if (result.months.length !== 12) return null;
  const good = goodSowMonths(result);
  let text: string;
  if (perennial) text = good.length ? t('crops.plantAnyTime') : t('crops.sowNoGoodMonth');
  else if (good.length === 12) text = t('crops.sowAnyMonth');
  else if (!good.length) text = t('crops.sowNoGoodMonth');
  else
    text = t('crops.sowWindow', {
      months: monthRuns(good)
        .map(([a, b]) => (a === b ? months[a] : `${months[a]} – ${months[b]}`))
        .join(', '),
    });
  return (
    <View style={s.sowWindow} testID={`sow-window-${result.cropId}`}>
      <Ionicons name="calendar-outline" size={15} color={colors.primary} />
      <Text style={s.sowWindowText}>{text}</Text>
    </View>
  );
}

function SeasonsView({
  seasonal,
  active,
  onPick,
  filter,
  limit,
  onMore,
}: {
  seasonal: SeasonalAssessment[];
  active: SeasonalAssessment;
  onPick: (id: string) => void;
  filter: (id: string) => boolean;
  limit: number;
  onMore: () => void;
}) {
  const { t, language } = useI18n();
  const text = useSeasonText();
  const style = SEASON_STYLE[active.season.kind];
  const crops = active.crops.filter((c) => filter(c.cropId));
  const top = crops.find((c) => c.rainfed && c.rainfed.score > 0);
  return (
    <View testID="seasons-view">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
        {seasonal.map((x) => (
          <Chip
            key={x.season.id}
            label={text.name(x.season)}
            icon={SEASON_STYLE[x.season.kind].icon}
            selected={x.season.id === active.season.id}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              onPick(x.season.id);
            }}
            testID={`season-${x.season.id}`}
          />
        ))}
      </ScrollView>
      <View style={[s.seasonHead, { borderColor: `${style.color}55` }]}>
        <View style={s.seasonTitleRow}>
          <View style={[s.seasonIcon, { backgroundColor: style.color }]}>
            <Ionicons name={style.icon} size={20} color={colors.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.seasonName}>{text.name(active.season)}</Text>
            {text.span(active.season) ? <Text style={type.small}>{text.span(active.season)}</Text> : null}
          </View>
        </View>
        <MonthStrip season={active.season} />
        <Text style={[type.small, { marginTop: spacing.sm }]}>
          {t('season.stats', {
            rain: active.season.rainMm === null ? '–' : Math.round(active.season.rainMm).toLocaleString('en-US'),
            temp: active.season.meanTempC === null ? '–' : active.season.meanTempC.toFixed(1),
          })}
        </Text>
        {top ? (
          <Text style={s.seasonBest}>
            {t('crops.seasonBest')}: {cropEmoji(cropById(top.cropId)!)} {cropName(cropById(top.cropId)!, language)}
          </Text>
        ) : null}
      </View>
      {crops.slice(0, limit).map((r, i) => (
        <FadeIn key={`${active.season.id}-${r.cropId}`} delay={Math.min(i, 10) * 40}>
          <SeasonCropCard result={r} />
        </FadeIn>
      ))}
      <MoreButton left={crops.length - limit} onPress={onMore} />
    </View>
  );
}

function SeasonCropCard({ result }: { result: SeasonCropResult }) {
  const { t, language } = useI18n();
  const { months } = useSeasonText();
  const crop = cropById(result.cropId)!;
  const color = suitabilityColors[result.suitability];
  const o = result.rainfed;
  return (
    <View style={s.cropCard} testID={`season-crop-${crop.id}`}>
      <View style={s.cropRow}>
        <ScoreRing score={o ? o.score : null} color={color} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.cropName}>
            {cropEmoji(crop)} {cropName(crop, language)}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={t(`suit.${result.suitability}` as TranslationKey)} color={color} />
            {o && !result.yearRound ? <Badge label={t('crops.sowIn', { month: months[o.month] })} color={colors.primary} /> : null}
            {result.yearRound ? <Badge label={t('season.yearRound')} color={colors.textMuted} /> : null}
          </View>
        </View>
        <CropPhoto crop={crop} size={64} />
      </View>
      {o ? (
        <>
          <Text style={s.limiting}>
            {t('crops.cycle', {
              rain: o.rainMm.toLocaleString('en-US'),
              n: cycleMonths(crop),
              temp: o.tempC.toFixed(1),
            })}
          </Text>
          <Text style={[type.small, { marginTop: 2 }]}>
            {o.rainShort && o.limiting === 'rain'
              ? t('crops.rainShort')
              : o.limiting
                ? t('crops.limitedByShort', { factor: t(`factor.${o.limiting}` as TranslationKey).toLowerCase() })
                : t('crops.allOptimal')}
          </Text>
          {result.irrigated ? <IrrigationNote score={result.irrigated.score} month={months[result.irrigated.month]} /> : null}
        </>
      ) : (
        <Text style={s.limiting}>{t('crops.seasonNone')}</Text>
      )}
    </View>
  );
}

function IrrigationNote({ score, month }: { score: number; month: string }) {
  const { t } = useI18n();
  return (
    <View style={s.irrigation}>
      <Ionicons name="water" size={16} color={colors.secondary} />
      <Text style={s.irrigationText}>
        {t('crops.withIrrigation', { score, month })} · {t(`suit.${classify(score)}` as TranslationKey)}
      </Text>
    </View>
  );
}

function CropCard({
  result,
  rank,
  matched,
  value,
  open,
  onToggle,
}: {
  result: CropResult;
  rank?: number | null;
  matched?: string | null;
  value?: CropValue;
  open: boolean;
  onToggle: () => void;
}) {
  const { t, language } = useI18n();
  const { money } = useMoney();
  const { months } = useSeasonText();
  const crop = cropById(result.cropId)!;
  const color = suitabilityColors[result.suitability];
  const monthly = result.months.length === 12;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      scaleTo={0.985}
      style={s.cropCard}
      testID={`crop-${crop.id}`}
    >
      <View style={s.cropRow}>
        <ScoreRing score={result.score} color={color} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.cropName}>
            {cropEmoji(crop)} {cropName(crop, language)}
            {rank ? <Text style={s.rank}>  #{rank}</Text> : null}
          </Text>
          {cropName(crop, language) !== crop.scientific ? <Text style={s.scientific}>{crop.scientific}</Text> : null}
          {matched ? <Text style={type.small}>{t('crops.alsoCalled', { name: matched })}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={t(`suit.${result.suitability}` as TranslationKey)} color={color} />
            {result.bestMonth !== null ? <Badge label={t('crops.sowIn', { month: months[result.bestMonth] })} color={colors.primary} /> : null}
            {value && value.localShare !== null && value.localShare >= 0.01 ? <Badge label={t('farm.grownHere')} color={colors.secondary} /> : null}
            {value && !value.group ? <Badge label={t('farm.cropBadge', { v: money(value.valuePerHa) })} color={colors.sun} /> : null}
          </View>
        </View>
        <CropPhoto crop={crop} />
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textFaint} />
      </View>
      {monthly ? <SowWindow result={result} perennial={result.cycleMonths === 12} /> : null}
      <Text style={s.limiting}>
        {result.score === null
          ? t('crops.notEnough')
          : result.limiting
            ? t('crops.limitedBy', { factor: t(`factor.${result.limiting}` as TranslationKey).toLowerCase() })
            : t('crops.allOptimal')}
      </Text>
      {open ? (
        <View style={s.factors}>
          {monthly && result.cycleMonths < 12 ? <SowingCalendar result={result} /> : null}
          <Text style={type.small}>
            {crop.cycleDays && result.cycleMonths < 12
              ? t('crops.growing', { n: result.cycleMonths, min: crop.cycleDays[0], max: crop.cycleDays[1] })
              : t('crops.growingYear')}
          </Text>
          {result.factors.map((f) => (
            <View key={f.key} style={{ gap: 6 }}>
              <View style={s.factorHead}>
                <Ionicons name={FACTOR_ICON[f.key]} size={16} color={colors.textMuted} />
                <Text style={s.factorName}>{t(f.key === 'rain' && monthly ? 'crops.rainCycle' : (`factor.${f.key}` as TranslationKey))}</Text>
                <Text style={s.factorValue}>
                  {f.value === null ? t(f.key === 'ph' ? 'crops.phNotTested' : 'crops.notAssessed') : `${FACTOR_FORMAT[f.key](f.value)} · ${t(`pos.${f.position}` as TranslationKey)}`}
                </Text>
              </View>
              <RangeBar range={f.range} value={f.value} color={f.score === null ? colors.textFaint : suitabilityColors.high} format={FACTOR_FORMAT[f.key]} />
            </View>
          ))}
          <Text style={type.small}>{t('crops.rangeLegend')}</Text>
          {result.irrigated ? <IrrigationNote score={result.irrigated.score} month={months[result.irrigated.month]} /> : null}
          {crop.id === 'rice' ? <Text style={[type.small, { color: colors.text }]}>{t('crop.rice.note')}</Text> : null}
          <Text style={type.small}>{t('crops.ecocrop', { id: crop.ecocropId })}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

/** Twelve cells: the score for sowing in each month, coloured by suitability. */
function SowingCalendar({ result }: { result: CropResult }) {
  const { t } = useI18n();
  const axis = t('env.monthsAxis').split(',');
  const long = t('env.monthsLong').split(',');
  const [picked, setPicked] = useState<number | null>(result.bestMonth);
  const o = picked === null ? null : result.months[picked];
  return (
    <View style={{ gap: 6 }} testID={`calendar-${result.cropId}`}>
      <Text style={s.factorName}>{t('crops.calendar')}</Text>
      <View style={s.calendar}>
        {axis.map((label, m) => {
          const score = result.months[m]?.score ?? null;
          return (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityLabel={`${long[m]}: ${score ?? '–'}`}
              onPress={() => {
                tapFeedback('select');
                setPicked(m);
              }}
              style={[s.calCell, { backgroundColor: `${scoreColor(score)}${m === picked ? 'ff' : '33'}` }]}
            >
              <Text style={[s.calScore, { color: m === picked ? colors.white : scoreColor(score) }]}>{score ?? '–'}</Text>
              <Text style={[s.calLabel, m === picked && { color: colors.white }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {o ? (
        <Text style={type.small}>
          {long[o.month]}: {o.score} · {t('crops.cycle', { rain: o.rainMm.toLocaleString('en-US'), n: result.cycleMonths, temp: o.tempC.toFixed(1) })}
        </Text>
      ) : null}
      <Text style={type.small}>{t('crops.calendarNote', { n: result.cycleMonths })}</Text>
    </View>
  );
}

function CompareTable({ results }: { results: CropResult[] }) {
  const { t, language } = useI18n();
  const cell = (score: number | null) => {
    const c = scoreColor(score);
    return (
      <View style={[s.cell, { backgroundColor: `${c}22` }]}>
        <Text style={[s.cellText, { color: c }]}>{score === null ? '–' : score}</Text>
      </View>
    );
  };
  return (
    <View style={s.table} testID="compare-table">
      <View style={s.tableRow}>
        <Text style={[s.th, { flex: 1.8, textAlign: 'left' }]}>{t('crops.crop')}</Text>
        {FACTORS.map((f) => (
          <View key={f} style={s.thCell}>
            <Ionicons name={FACTOR_ICON[f]} size={16} color={colors.textMuted} />
            <Text style={s.th} numberOfLines={2}>
              {t(`factor.${f}` as TranslationKey)}
            </Text>
          </View>
        ))}
        <Text style={[s.th, s.thCell]}>{t('crops.overall')}</Text>
      </View>
      {results.map((r) => {
        const crop = cropById(r.cropId)!;
        return (
          <View key={r.cropId} style={s.tableRow}>
            <Text style={[s.td, { flex: 1.8 }]} numberOfLines={2}>
              {cropEmoji(crop)} {cropName(crop, language)}
            </Text>
            {FACTORS.map((f) => (
              <View key={f} style={{ flex: 1 }}>
                {cell(r.factors.find((x) => x.key === f)?.score ?? null)}
              </View>
            ))}
            <View style={{ flex: 1 }}>{cell(r.score)}</View>
          </View>
        );
      })}
      <Text style={[type.small, { marginTop: spacing.sm }]}>{t('crops.compareNote')}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xs },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryDark,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  heroLabel: { color: '#bfe3cf', fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  heroTitle: { color: colors.white, fontSize: 19, fontWeight: '700', marginTop: 4 },
  heroSub: { color: '#d7efe1', fontSize: 12, marginTop: 4 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
    marginTop: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.text, paddingVertical: spacing.sm },
  valueBig: { fontSize: 15, fontWeight: '700', color: colors.text },
  valueTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  valueFill: { height: 8, borderRadius: 4, backgroundColor: colors.sun },
  chipRow: { gap: spacing.sm, paddingVertical: spacing.sm },
  commonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  sowWindow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  sowWindowText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.primaryDark },
  cropCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    boxShadow: '0 1px 2px rgba(16, 40, 24, 0.06), 0 4px 14px rgba(16, 40, 24, 0.06)',
  },
  cropRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  seasonHead: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1.5, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  seasonTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  seasonIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  seasonName: { fontSize: 16.5, fontWeight: '700', color: colors.text },
  nowHead: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  seasonBest: { fontSize: 13, fontWeight: '700', color: colors.primaryDark },
  irrigation: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, backgroundColor: colors.secondaryLight, borderRadius: radius.md, padding: spacing.sm },
  irrigationText: { fontSize: 13.5, fontWeight: '600', color: colors.secondary, flex: 1 },
  cropName: { fontSize: 15.5, fontWeight: '700', color: colors.text },
  rank: { fontSize: 12, color: colors.textFaint, fontWeight: '700' },
  scientific: { fontSize: 13, fontStyle: 'italic', color: colors.textMuted },
  limiting: { fontSize: 12, color: colors.text, marginTop: spacing.md },
  factors: { marginTop: spacing.md, gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  factorHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  factorName: { fontSize: 12, fontWeight: '700', color: colors.text, flex: 1 },
  factorValue: { fontSize: 13.5, color: colors.textMuted },
  calendar: { flexDirection: 'row', gap: 3 },
  calCell: { flex: 1, borderRadius: 6, alignItems: 'center', paddingVertical: 6, minHeight: 44, justifyContent: 'center' },
  calScore: { fontSize: 11.5, fontWeight: '700' },
  calLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  table: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  thCell: { flex: 1, alignItems: 'center', gap: 2 },
  th: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textAlign: 'center' },
  td: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  cell: { borderRadius: 8, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  cellText: { fontSize: 13, fontWeight: '700' },
});
