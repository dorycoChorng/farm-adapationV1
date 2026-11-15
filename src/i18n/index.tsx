import { getLocales } from 'expo-localization';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getSetting, setSetting } from '../db/repositories';
import { en, type TranslationKey } from './en';
import { km } from './km';

export type Language = 'en' | 'km';
const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { en, km };

export function translate(
  language: Language,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  let text = DICTIONARIES[language][key] ?? en[key];
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

function deviceLanguage(): Language {
  try {
    return getLocales()[0]?.languageCode === 'km' ? 'km' : 'en';
  } catch {
    return 'en';
  }
}

interface I18nValue {
  language: Language;
  setLanguage(language: Language): void;
  t(key: TranslationKey, params?: Record<string, string | number>): string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [language, setLanguageState] = useState<Language>(deviceLanguage);

  useEffect(() => {
    getSetting(db, 'language').then((stored) => {
      if (stored === 'en' || stored === 'km') setLanguageState(stored);
    });
  }, [db]);

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next);
      void setSetting(db, 'language', next);
    },
    [db],
  );

  const t = useCallback<I18nValue['t']>((key, params) => translate(language, key, params), [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
