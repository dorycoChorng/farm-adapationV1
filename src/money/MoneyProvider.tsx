import { useSQLiteContext } from 'expo-sqlite';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getSetting, setSetting } from '../db/repositories';
import { BUNDLED_RATES, fetchRates, formatMoney, type Rates } from './currency';

interface MoneyValue {
  /** ISO 4217 code; US$ unless the user picked another. */
  currency: string;
  setCurrency(code: string): void;
  rates: Rates;
  /** A US-dollar amount in the chosen currency. */
  money(usd: number, digits?: number): string;
}

const MoneyContext = createContext<MoneyValue | null>(null);

export function MoneyProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [currency, setCurrencyState] = useState('USD');
  const [rates, setRates] = useState<Rates>(BUNDLED_RATES);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, cached] = await Promise.all([getSetting(db, 'currency'), getSetting(db, 'fxRates')]);
      if (cancelled) return;
      if (stored) setCurrencyState(stored);
      let best = BUNDLED_RATES;
      try {
        const c = cached ? (JSON.parse(cached) as Rates) : null;
        if (c && c.date > best.date) best = c;
      } catch {
        // ignore a damaged cache
      }
      setRates(best);
      // Newer rates when online; the bundled or cached ones keep working offline.
      const fresh = await fetchRates();
      if (!cancelled && fresh && fresh.date >= best.date) {
        setRates(fresh);
        void setSetting(db, 'fxRates', JSON.stringify(fresh));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const setCurrency = useCallback(
    (code: string) => {
      setCurrencyState(code);
      void setSetting(db, 'currency', code);
    },
    [db],
  );
  const money = useCallback((usd: number, digits = 0) => formatMoney(usd, currency, rates, digits), [currency, rates]);
  const value = useMemo(() => ({ currency, setCurrency, rates, money }), [currency, setCurrency, rates, money]);
  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>;
}

export function useMoney(): MoneyValue {
  const ctx = useContext(MoneyContext);
  if (!ctx) throw new Error('useMoney must be used inside MoneyProvider');
  return ctx;
}
