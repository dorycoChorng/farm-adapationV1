import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { NetworkBanner } from '../components/NetworkBanner';
import { Banner, Button, Chip, type IconName, Ionicons, PressableScale, styles as ui } from '../components/ui';
import { geocode } from '../config';
import { searchSavedLocations } from '../db/repositories';
import { formatDecimalPair, parseCoordinatePair } from '../geo/format';
import { useOnline } from '../hooks/useOnline';
import { useI18n } from '../i18n';
import { localName } from '../i18n/format';
import { cambodia, searchCountries } from '../search/countries';
import { GeocoderError } from '../search/geocoder';
import type { PlaceResult, PlaceSource } from '../search/types';
import { useAppState } from '../state/AppState';
import { colors, spacing, TOUCH_TARGET } from '../theme/colors';

const SOURCE_STYLE: Record<PlaceSource, { icon: IconName; fg: string; bg: string }> = {
  nominatim: { icon: 'location', fg: colors.secondary, bg: colors.secondaryLight },
  'country-index': { icon: 'flag', fg: colors.primary, bg: colors.primaryLight },
  saved: { icon: 'bookmark', fg: colors.sun, bg: colors.sunLight },
  coordinates: { icon: 'navigate', fg: colors.soil, bg: colors.soilLight },
};

export default function SearchScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { t, language } = useI18n();
  const online = useOnline();
  const { select } = useAppState();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = async () => {
    const q = query.trim();
    if (!q) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);

    const local: PlaceResult[] = [];
    const typed = parseCoordinatePair(q);
    if (typed) {
      local.push({
        id: 'typed',
        name: formatDecimalPair(typed),
        displayName: t('search.coordinates'),
        latitude: typed.latitude,
        longitude: typed.longitude,
        bbox: null,
        kind: 'coordinates',
        source: 'coordinates',
      });
    }
    const saved = await searchSavedLocations(db, q);
    local.push(
      ...saved.map<PlaceResult>((l) => ({
        id: `saved:${l.id}`,
        name: l.name,
        displayName: l.sourceDetail ?? formatDecimalPair(l),
        latitude: l.latitude,
        longitude: l.longitude,
        bbox: null,
        kind: 'saved',
        source: 'saved',
      })),
    );

    let remote: PlaceResult[] = [];
    if (online !== false && !typed) {
      try {
        remote = await geocode(q, { language: language === 'km' ? 'km,en' : 'en', signal: controller.signal });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError(
          e instanceof GeocoderError && e.kind === 'rate-limited'
            ? t('search.rateLimited')
            : t('search.error', { reason: (e as Error).message }),
        );
      }
    }
    // Country index fills in offline, and when the geocoder failed.
    const countries = remote.length === 0 ? searchCountries(q) : [];
    setResults([...local, ...remote, ...countries]);
    setBusy(false);
  };

  const choose = (p: PlaceResult) => {
    select(
      {
        latitude: p.latitude,
        longitude: p.longitude,
        name: p.source === 'coordinates' ? null : p.name,
        nameKm: p.nameKm ?? null,
        source: p.source,
        accuracyMeters: null,
        bbox: p.bbox,
      },
      { fly: true },
    );
    router.back();
  };

  const sourceLabel = (p: PlaceResult) =>
    p.source === 'nominatim'
      ? `${t('search.online')} · ${p.kind}`
      : p.source === 'country-index'
        ? t('search.country')
        : p.source === 'saved'
          ? t('search.saved')
          : t('search.coordinates');

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <NetworkBanner />
        <View style={s.searchRow}>
          <View style={s.inputWrap}>
          <Ionicons name="search" size={20} color={colors.primary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={run}
            placeholder={t('search.placeholder')}
            returnKeyType="search"
            style={s.input}
            autoFocus
            accessibilityLabel={t('search.placeholder')}
            testID="search-input"
          />
          </View>
          <Button label={t('search.submit')} onPress={run} busy={busy} grow={false} />
        </View>
        <View style={s.chips}>
          <Chip icon="flag" label={t('globe.cambodia')} onPress={() => choose(cambodia())} />
          <Chip icon="locate" label={t('nav.myLocation')} color={colors.secondary} onPress={() => router.replace('/my-location')} />
          <Chip
            icon="hand-left"
            label={t('search.selectOnMap')}
            onPress={() => {
              select(null);
              router.back();
            }}
          />
        </View>
        {online === false ? <Banner kind="info">{t('search.offlineNote')}</Banner> : null}
        {error ? <Banner kind="error">{error}</Banner> : null}
      </View>
      <FlatList
        data={results ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}
        ListEmptyComponent={results && !busy ? <Text style={ui.muted}>{t('search.noResults')}</Text> : undefined}
        renderItem={({ item }) => (
          <PressableScale accessibilityRole="button" onPress={() => choose(item)} scaleTo={0.98} style={s.result}>
            <View style={[s.resultIcon, { backgroundColor: SOURCE_STYLE[item.source].bg }]}>
              <Ionicons name={SOURCE_STYLE[item.source].icon} size={20} color={SOURCE_STYLE[item.source].fg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.resultName}>{localName(item, language)}</Text>
              <Text style={s.resultDetail} numberOfLines={2}>
                {item.displayName}
              </Text>
              <Text style={s.resultMeta}>
                {formatDecimalPair(item, 5)} · {sourceLabel(item)}
              </Text>
            </View>
          </PressableScale>
        )}
        ListFooterComponent={
          results?.some((r) => r.source === 'nominatim') ? <Text style={ui.muted}>{t('search.attribution')}</Text> : undefined
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg, gap: spacing.sm },
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
  },
  input: { flex: 1, minHeight: TOUCH_TARGET, fontSize: 14, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  result: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  resultIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  resultName: { fontSize: 14, fontWeight: '700', color: colors.text },
  resultDetail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  resultMeta: { fontSize: 13, color: colors.secondary, marginTop: 4 },
});
