import { Stack } from 'expo-router';
import type { ComponentType } from 'react';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { migrate } from '../db/migrations';
import { startSpeedInsights } from '../insights/speedInsights';
import { I18nProvider, useI18n } from '../i18n';
import { MoneyProvider } from '../money/MoneyProvider';
import { AppStateProvider } from '../state/AppState';
import { colors, TOUCH_TARGET } from '../theme/colors';

// Import Vercel Analytics only for web platform
let Analytics: ComponentType | null = null;
if (Platform.OS === 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Analytics: WebAnalytics } = require('@vercel/analytics/react');
    Analytics = WebAnalytics;
  } catch {
    // Analytics package not available, continue without it
  }
}

startSpeedInsights();

function LanguageToggle() {
  const { language, setLanguage, t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('offline.language')}
      onPress={() => setLanguage(language === 'en' ? 'km' : 'en')}
      style={{ minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET, justifyContent: 'center', alignItems: 'center' }}
    >
      <View style={{ backgroundColor: colors.primaryLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Text style={{ color: colors.primaryDark, fontSize: 12, fontWeight: '700' }}>{t('languageToggle')}</Text>
      </View>
    </Pressable>
  );
}

function Screens() {
  const { t } = useI18n();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primaryDark,
        headerTitleStyle: { fontWeight: '700', color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
        headerRight: () => <LanguageToggle />,
      }}
    >
      <Stack.Screen name="index" options={{ title: t('appName'), headerShown: false }} />
      <Stack.Screen name="search" options={{ title: t('search.title') }} />
      <Stack.Screen name="my-location" options={{ title: t('loc.title') }} />
      <Stack.Screen name="local-map" options={{ title: t('local.title') }} />
      <Stack.Screen name="parcel-draw" options={{ title: t('draw.title') }} />
      <Stack.Screen name="saved" options={{ title: t('saved.title') }} />
      <Stack.Screen name="offline" options={{ title: t('offline.title') }} />
      <Stack.Screen name="analysis" options={{ title: t('nav.analysis') }} />
      <Stack.Screen name="crops" options={{ title: t('nav.crops') }} />
      <Stack.Screen name="credits" options={{ title: t('credits.title') }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName="farm-adaptation.db" onInit={migrate}>
        <I18nProvider>
          <MoneyProvider>
            <AppStateProvider>
              <StatusBar style="dark" />
              <Screens />
              {Analytics && <Analytics />}
            </AppStateProvider>
          </MoneyProvider>
        </I18nProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
