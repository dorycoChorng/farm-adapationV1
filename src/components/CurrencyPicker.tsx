import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { countryCurrency, CURRENCY_NAMES } from '../money/currency';
import { useMoney } from '../money/MoneyProvider';
import { colors, spacing, type } from '../theme/colors';
import { Chip } from './ui';

/** US$ (the default) or the money of the country being looked at. */
export function CurrencyPicker({ iso3 }: { iso3: string | null }) {
  const { t, language } = useI18n();
  const { currency, setCurrency, rates } = useMoney();
  const local = countryCurrency(iso3);
  const options = [...new Set(['USD', local, currency].filter((c): c is string => !!c))];
  const label = (code: string) => (code === 'KHR' && language === 'km' ? 'រៀល (KHR)' : `${CURRENCY_NAMES[code] ?? code} (${code})`);
  return (
    <View style={s.box} testID="currency-picker">
      <Text style={s.title}>{t('money.title')}</Text>
      <View style={s.row}>
        {options.map((code) => (
          <Chip key={code} label={label(code)} selected={currency === code} onPress={() => setCurrency(code)} testID={`currency-${code}`} />
        ))}
      </View>
      {currency !== 'USD' ? <Text style={type.small}>{t('money.rate', { date: rates.date })}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
  title: { fontSize: 12, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
