import * as ExpoLocation from 'expo-location';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Animated, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NamePrompt } from '../components/NamePrompt';
import { NetworkBanner } from '../components/NetworkBanner';
import { Banner, Button, Card, InfoRow, Ionicons, Row, styles as ui, tapFeedback } from '../components/ui';
import { insertLocation } from '../db/repositories';
import { formatCoordinate } from '../geo/format';
import { useOnline } from '../hooks/useOnline';
import { useI18n } from '../i18n';
import { formatDate } from '../i18n/format';
import {
  getCurrentLocation,
  isLowAccuracy,
  LOW_ACCURACY_THRESHOLD_METERS,
  type LocationFix,
  type LocationResult,
} from '../location/locationService';
import { useAppState } from '../state/AppState';
import { colors, spacing } from '../theme/colors';

type Phase = { kind: 'explain' } | { kind: 'requesting' } | { kind: 'done'; result: LocationResult; at: number };

function ageText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}

export default function MyLocationScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { t, language } = useI18n();
  const online = useOnline();
  const { select, setUserFix } = useAppState();
  const [phase, setPhase] = useState<Phase>({ kind: 'explain' });
  const [naming, setNaming] = useState(false);
  const [saved, setSaved] = useState(false);
  const [manualFix, setManualFix] = useState<LocationFix | null>(null);

  const request = async () => {
    setPhase({ kind: 'requesting' });
    setSaved(false);
    setManualFix(null);
    const result = await getCurrentLocation();
    tapFeedback(result.ok ? 'success' : 'warning');
    setPhase({ kind: 'done', result, at: Date.now() });
  };

  const fix: LocationFix | null =
    manualFix ?? (phase.kind === 'done' && phase.result.ok ? phase.result.fix : null);
  const approximate = phase.kind === 'done' && phase.result.ok && phase.result.precision === 'approximate';

  const showOnMap = () => {
    if (!fix) return;
    setUserFix(fix);
    select(
      {
        latitude: fix.latitude,
        longitude: fix.longitude,
        name: null,
        source: 'gps',
        accuracyMeters: fix.accuracyMeters,
        bbox: null,
      },
      { fly: true, zoom: 17 },
    );
    router.dismissTo('/');
  };

  const saveStart = async (name: string) => {
    if (!fix) return;
    await insertLocation(db, {
      name,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyMeters: fix.accuracyMeters,
      altitudeMeters: fix.altitudeMeters,
      source: 'gps',
      sourceDetail: null,
      isFarmStart: true,
    });
    setNaming(false);
    setSaved(true);
  };

  const failure = phase.kind === 'done' && !phase.result.ok ? phase.result : null;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <NetworkBanner />
      <Card>
        <View style={st.hero}>
          <Pulse active={phase.kind === 'requesting'} />
          <Text style={st.heroTitle}>{t('loc.whyTitle')}</Text>
        </View>
        <View style={st.privacy}>
          <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
          <Text style={[ui.body, { flex: 1 }]}>{t('loc.whyBody')}</Text>
        </View>
        {phase.kind === 'explain' ? (
          <Button label={t('loc.continue')} icon="locate" variant="secondary" onPress={request} style={{ marginTop: spacing.md }} testID="loc-continue" />
        ) : null}
        {phase.kind === 'requesting' ? (
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            <Button label={t('loc.continue')} variant="secondary" onPress={() => {}} busy />
            <Text style={ui.body}>{t('loc.requesting')}</Text>
            {online === false ? <Text style={ui.muted}>{t('loc.offlineHint')}</Text> : null}
          </View>
        ) : null}
      </Card>

      {failure ? (
        <Card>
          <Banner kind="error">{t(`loc.err.${failure.reason}`)}</Banner>
          {failure.reason === 'timeout' && online === false ? <Text style={ui.muted}>{t('loc.offlineHint')}</Text> : null}
          {failure.reason === 'timeout' && failure.lastKnown && !manualFix ? (
            <>
              <Text style={ui.body}>{t('loc.lastKnown', { age: ageText((phase.kind === 'done' ? phase.at : 0) - failure.lastKnown.timestamp) })}</Text>
              <Button label={t('loc.useLastKnown')} variant="outline" onPress={() => setManualFix(failure.lastKnown!)} />
            </>
          ) : null}
          <Row>
            {failure.reason === 'permission-blocked' ? (
              <Button label={t('loc.openSettings')} onPress={() => void Linking.openSettings()} />
            ) : null}
            {failure.reason === 'services-disabled' && Platform.OS === 'android' ? (
              <Button
                label={t('loc.enableServices')}
                onPress={async () => {
                  try {
                    // Shows the system "turn on location" dialog; the user decides.
                    await ExpoLocation.enableNetworkProviderAsync();
                    await request();
                  } catch {
                    // User declined; nothing else to do.
                  }
                }}
              />
            ) : null}
            {failure.reason === 'services-disabled' && Platform.OS !== 'android' ? (
              <Button label={t('loc.openSettings')} onPress={() => void Linking.openSettings()} />
            ) : null}
            <Button label={t('common.retry')} variant="outline" onPress={request} />
          </Row>
        </Card>
      ) : null}

      {fix ? (
        <Card
          title={manualFix ? t('loc.useLastKnown') : t('loc.title')}
          icon="navigate"
          iconColor={colors.secondary}
          iconBg={colors.secondaryLight}
        >
          <InfoRow label={t('common.latitude')} value={formatCoordinate(fix.latitude, 'N', 'S')} />
          <InfoRow label={t('common.longitude')} value={formatCoordinate(fix.longitude, 'E', 'W')} />
          <InfoRow
            label={t('loc.accuracy')}
            value={
              fix.accuracyMeters == null
                ? t('loc.accuracyUnknown')
                : t('loc.accuracyValue', { m: Math.round(fix.accuracyMeters) })
            }
          />
          {fix.altitudeMeters != null ? (
            <InfoRow
              label={t('loc.altitude')}
              value={`${Math.round(fix.altitudeMeters)} m${
                fix.altitudeAccuracyMeters != null ? ` (± ${Math.round(fix.altitudeAccuracyMeters)} m)` : ''
              }`}
            />
          ) : null}
          <InfoRow label={t('loc.time')} value={formatDate(fix.timestamp, language, true)} />
          {approximate ? <Banner kind="warning">{t('loc.approximate')}</Banner> : null}
          {!approximate && isLowAccuracy(fix) ? (
            <Banner kind="warning">{t('loc.lowAccuracy', { m: LOW_ACCURACY_THRESHOLD_METERS })}</Banner>
          ) : null}
          {saved ? <Banner kind="success">{t('loc.saved')}</Banner> : null}
          <Row>
            <Button label={t('loc.showOnMap')} icon="map" onPress={showOnMap} testID="loc-show" />
            <Button label={t('loc.saveStart')} icon="flag" variant="outline" onPress={() => setNaming(true)} disabled={saved} />
          </Row>
          {!manualFix ? <Button label={t('common.retry')} icon="refresh" variant="ghost" onPress={request} /> : null}
        </Card>
      ) : null}

      <NamePrompt
        visible={naming}
        title={t('loc.saveStart')}
        initialValue=""
        placeholder={t('draw.namePlaceholder')}
        onCancel={() => setNaming(false)}
        onSubmit={(name) => void saveStart(name)}
      />
    </ScrollView>
  );
}

/** Location icon with radar rings that pulse while waiting for a GPS fix. */
function Pulse({ active }: { active: boolean }) {
  const v = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (!active) {
      v.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1400, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [active, v]);
  return (
    <View style={st.pulseWrap}>
      <Animated.View
        style={[
          st.ring,
          { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.6] }) }] },
        ]}
      />
      <View style={st.disc}>
        <Ionicons name="locate" size={34} color={colors.white} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  heroTitle: { fontSize: 16.5, fontWeight: '700', color: colors.text, textAlign: 'center' },
  privacy: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: 12, padding: spacing.md, marginTop: spacing.sm },
  pulseWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: colors.secondary },
  disc: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.secondary, alignItems: 'center', justifyContent: 'center' },
});
