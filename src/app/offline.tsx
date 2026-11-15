import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Banner, Button, Card, Ionicons, Segmented, styles as ui } from '../components/ui';
import { clearUserData, storageStats, type StorageStats } from '../db/repositories';
import { useOnline } from '../hooks/useOnline';
import { useI18n } from '../i18n';
import { colors, radius, spacing } from '../theme/colors';

export default function OfflineScreen() {
  const db = useSQLiteContext();
  const { t, language, setLanguage } = useI18n();
  const online = useOnline();
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [cleared, setCleared] = useState(false);

  const reload = useCallback(() => {
    storageStats(db).then(setStats);
  }, [db]);
  useFocusEffect(reload);

  const clear = () => {
    const run = () =>
      clearUserData(db).then(() => {
        setCleared(true);
        reload();
      });
    if (Platform.OS === 'web') {
      if (window.confirm(t('offline.confirmClear'))) void run();
      return;
    }
    Alert.alert(t('offline.confirmClear'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void run() },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
      <View style={st.statusRow}>
        <View style={[st.statusCard, { backgroundColor: online === false ? colors.warningBg : colors.primaryLight }]}>
          <Ionicons name={online === false ? 'cloud-offline' : 'cloud-done'} size={26} color={online === false ? colors.warning : colors.primary} />
          <Text style={st.statusLabel}>{t('offline.status')}</Text>
          <Text style={st.statusValue}>{online === false ? t('offline.offlineNow') : online ? t('offline.online') : '…'}</Text>
        </View>
        <View style={[st.statusCard, { backgroundColor: colors.secondaryLight }]}>
          <Ionicons name="phone-portrait" size={26} color={colors.secondary} />
          <Text style={st.statusLabel}>{t('offline.stored')}</Text>
          <Text style={st.statusValue}>
            {stats ? t('offline.counts', { locations: stats.locations, parcels: stats.parcels, analyses: stats.analyses }) : '…'}
          </Text>
        </View>
      </View>
      <Card title={t('offline.worksOffline')} icon="checkmark-circle">
        <Text style={ui.body}>{t('offline.worksOfflineList')}</Text>
      </Card>
      <Card title={t('offline.needsInternet')} icon="wifi" iconColor={colors.secondary} iconBg={colors.secondaryLight}>
        <Text style={ui.body}>{t('offline.needsInternetList')}</Text>
        <Text style={[ui.muted, { marginTop: spacing.sm }]}>{t('offline.tiles')}</Text>
      </Card>
      <Card title={t('offline.language')} icon="language" iconColor={colors.sun} iconBg={colors.sunLight}>
        <Segmented
          value={language}
          onChange={setLanguage}
          options={[
            { value: 'en', label: 'English' },
            { value: 'km', label: 'ខ្មែរ' },
          ]}
        />
      </Card>
      {cleared ? <Banner kind="success">{t('offline.cleared')}</Banner> : null}
      <Button label={t('offline.clear')} icon="trash" variant="danger" onPress={clear} />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  statusRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  statusCard: { flex: 1, borderRadius: radius.lg, padding: spacing.lg, gap: 4 },
  statusLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted, marginTop: spacing.xs },
  statusValue: { fontSize: 13, fontWeight: '700', color: colors.text },
});
