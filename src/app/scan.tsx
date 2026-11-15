import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Banner, Button, Card, Chip, Ionicons, tapFeedback } from '../components/ui';
import { cropEmoji, cropName } from '../env/crops';
import { useOnline } from '../hooks/useOnline';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n/en';
import { catalogueCrop, CONFIDENT, identifyPlant, type IdentifyResult, type Organ, type Photo } from '../plants/identify';
import { colors, radius, spacing, type } from '../theme/colors';

const ORGANS: Organ[] = ['leaf', 'flower', 'fruit', 'auto'];

/**
 * Identify a plant from one photo. The photo stays on the phone until the user taps
 * Identify; it is then sent to Pl@ntNet through this app's own server, which holds the key.
 */
export default function ScanScreen() {
  const { summaryId } = useLocalSearchParams<{ summaryId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const { t, language } = useI18n();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [organ, setOrgan] = useState<Organ>('leaf');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [denied, setDenied] = useState(false);

  const pick = async (camera: boolean) => {
    setDenied(false);
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setDenied(true);
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsEditing: false };
    const res = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setPhoto({ uri: a.uri, mimeType: a.mimeType, fileName: a.fileName, file: a.file ?? null });
    setResult(null);
  };

  const send = async () => {
    if (!photo) return;
    setBusy(true);
    try {
      setResult(await identifyPlant(photo, organ, language));
      tapFeedback('success');
    } finally {
      setBusy(false);
    }
  };

  const matches = result?.status === 'ok' ? result.matches : [];
  const confident = matches.filter((m) => m.score >= CONFIDENT);

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
      <Card title={t('scan.title')} icon="scan" iconColor={colors.primary} iconBg={colors.primaryLight}>
        <Text style={type.body}>{t('scan.intro')}</Text>
        <View style={s.row}>
          <Button label={t('scan.camera')} icon="camera" onPress={() => void pick(true)} testID="scan-camera" />
          <Button label={t('scan.library')} icon="images" variant="soft" onPress={() => void pick(false)} testID="scan-library" />
        </View>
        {denied ? <Banner kind="warning">{t('scan.denied')}</Banner> : null}
      </Card>

      {photo ? (
        <Card title={t('scan.organ')} icon="leaf" iconColor={colors.primary} iconBg={colors.primaryLight}>
          <Image source={{ uri: photo.uri }} style={s.preview} resizeMode="cover" accessibilityIgnoresInvertColors testID="scan-preview" />
          <View style={s.chips}>
            {ORGANS.map((o) => (
              <Chip key={o} label={t(`scan.organ.${o}` as TranslationKey)} selected={organ === o} onPress={() => setOrgan(o)} testID={`organ-${o}`} />
            ))}
          </View>
          <Button
            label={t('scan.send')}
            icon="search"
            onPress={() => void send()}
            busy={busy}
            disabled={online === false}
            testID="scan-send"
            style={{ marginTop: spacing.md }}
          />
          <Text style={[type.small, { marginTop: spacing.xs }]}>{online === false ? t('scan.offline') : t('scan.sendNote')}</Text>
        </Card>
      ) : null}

      {busy ? (
        <View style={s.working}>
          <ActivityIndicator color={colors.primary} />
          <Text style={type.body}>{t('scan.working')}</Text>
        </View>
      ) : null}

      {result && result.status !== 'ok' ? (
        <Banner kind={result.status === 'not-configured' ? 'info' : 'error'}>
          {result.status === 'not-configured'
            ? t('scan.notConfigured')
            : result.status === 'offline'
              ? t('scan.offline')
              : result.reason === 'quota'
                ? t('scan.quota')
                : t('scan.error', { reason: result.reason })}
        </Banner>
      ) : null}

      {result?.status === 'ok' ? (
        <Card title={t('scan.results')} icon="list" iconColor={colors.secondary} iconBg={colors.secondaryLight} testID="scan-results">
          {!confident.length ? <Banner kind="warning">{t('scan.lowConfidence')}</Banner> : null}
          {matches.map((m, i) => {
            const crop = catalogueCrop(m);
            const name = crop ? cropName(crop, language) : (m.commonNames[0] ?? m.scientific);
            return (
              <View key={`${m.scientific}-${i}`} style={s.match} testID={`scan-match-${i}`}>
                <View style={s.matchHead}>
                  <Text style={s.matchName}>
                    {crop ? `${cropEmoji(crop)} ` : ''}
                    {name}
                  </Text>
                  <Badge
                    label={m.score >= CONFIDENT ? t('scan.confidence', { pct: Math.round(m.score * 100) }) : t('scan.uncertain')}
                    color={m.score >= CONFIDENT ? colors.primary : colors.textMuted}
                  />
                </View>
                {name !== m.scientific ? <Text style={s.scientific}>{m.scientific}</Text> : null}
                {m.family ? <Text style={type.small}>{m.family}</Text> : null}
                {crop && summaryId ? (
                  <Button
                    label={t('scan.inCatalogue')}
                    icon="leaf"
                    variant="soft"
                    onPress={() => router.dismissTo({ pathname: '/crops', params: { summaryId, q: crop.en ?? crop.scientific } })}
                    testID={`scan-open-${crop.id}`}
                    style={{ marginTop: spacing.sm }}
                  />
                ) : !crop ? (
                  <Text style={[type.small, { marginTop: 2 }]}>{t('scan.notInCatalogue')}</Text>
                ) : null}
              </View>
            );
          })}
          <View style={s.credit}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
            <Text style={type.small}>{t('scan.credit')}</Text>
          </View>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  working: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  match: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  matchHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  matchName: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.text },
  scientific: { fontSize: 13.5, fontStyle: 'italic', color: colors.textMuted },
  credit: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
});
