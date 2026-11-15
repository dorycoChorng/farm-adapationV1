import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type { SoilTest } from '../../env/types';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';
import { colors, radius, spacing, type } from '../../theme/colors';
import { Button, Card, Chip, InfoRow } from '../ui';

const TEXTURES: NonNullable<SoilTest['texture']>[] = ['sandy', 'loam', 'clay'];

/** Accepts "6.5" or "6,5"; blank means "not tested". */
const parse = (text: string): number | null | undefined => {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
};

const inRange = (v: number | null | undefined, lo: number, hi: number) => v === null || (v !== undefined && v >= lo && v <= hi);

/**
 * "My soil test": the farmer types in what a soil or water test showed. Every value is
 * optional; the ones given replace the soil maps in the fixes, the salt check and the crop
 * scores. `onSave(null)` removes the test.
 */
export function SoilTestCard({ test, onSave, disabled }: { test: SoilTest | undefined; onSave: (test: SoilTest | null) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [ph, setPh] = useState('');
  const [om, setOm] = useState('');
  const [ec, setEc] = useState('');
  const [texture, setTexture] = useState<SoilTest['texture']>(null);
  const [error, setError] = useState(false);

  const start = () => {
    setPh(test?.ph != null ? String(test.ph) : '');
    setOm(test?.organicMatterPct != null ? String(test.organicMatterPct) : '');
    setEc(test?.waterEcDsM != null ? String(test.waterEcDsM) : '');
    setTexture(test?.texture ?? null);
    setError(false);
    setEditing(true);
  };

  const save = () => {
    const v = { ph: parse(ph), om: parse(om), ec: parse(ec) };
    if (!inRange(v.ph, 3, 10) || !inRange(v.om, 0, 30) || !inRange(v.ec, 0, 50)) {
      setError(true);
      return;
    }
    const next: SoilTest = {
      ph: v.ph as number | null,
      organicMatterPct: v.om as number | null,
      waterEcDsM: v.ec as number | null,
      texture,
      enteredAt: new Date().toISOString(),
    };
    const empty = next.ph === null && next.organicMatterPct === null && next.waterEcDsM === null && next.texture === null;
    onSave(empty ? null : next);
    setEditing(false);
  };

  return (
    <Card title={t('test.title')} icon="flask" iconColor={colors.soil} iconBg={colors.soilLight} testID="card-soil-test">
      {editing ? (
        <>
          <Field label={t('test.ph')} hint={t('test.phHint')} value={ph} onChange={setPh} testID="test-ph" />
          <Field label={t('test.om')} hint={t('test.omHint')} value={om} onChange={setOm} testID="test-om" />
          <Field label={t('test.ec')} hint={t('test.ecHint')} value={ec} onChange={setEc} testID="test-ec" />
          <Text style={st.label}>{t('test.texture')}</Text>
          <View style={st.chips}>
            {TEXTURES.map((x) => (
              <Chip key={x} label={t(`test.texture.${x}` as TranslationKey)} selected={texture === x} onPress={() => setTexture(texture === x ? null : x)} />
            ))}
          </View>
          {error ? <Text style={[type.small, { color: colors.danger, marginTop: spacing.xs }]}>{t('test.invalid')}</Text> : null}
          <View style={st.buttons}>
            <Button label={t('test.save')} icon="checkmark" onPress={save} testID="test-save" />
            <Button label={t('test.cancel')} variant="ghost" onPress={() => setEditing(false)} grow={false} />
          </View>
        </>
      ) : test ? (
        <>
          <Text style={[type.small, { marginBottom: spacing.xs }]}>{t('test.used')}</Text>
          {test.ph != null ? <InfoRow label={t('test.ph')} value={String(test.ph)} /> : null}
          {test.organicMatterPct != null ? <InfoRow label={t('test.om')} value={`${test.organicMatterPct} %`} /> : null}
          {test.waterEcDsM != null ? <InfoRow label={t('test.ec')} value={`${test.waterEcDsM} dS/m`} /> : null}
          {test.texture ? <InfoRow label={t('test.texture')} value={t(`test.texture.${test.texture}` as TranslationKey)} /> : null}
          <Text style={[type.small, { marginTop: spacing.xs }]}>{t('test.savedOn', { date: test.enteredAt.slice(0, 10) })}</Text>
          <View style={st.buttons}>
            <Button label={t('test.edit')} icon="create-outline" variant="outline" onPress={start} disabled={disabled} testID="test-edit" />
            <Button label={t('test.clear')} variant="ghost" onPress={() => onSave(null)} disabled={disabled} grow={false} testID="test-clear" />
          </View>
        </>
      ) : (
        <>
          <Text style={type.body}>{t('test.intro')}</Text>
          <Text style={[type.small, { marginTop: spacing.xs }]}>{t('test.where')}</Text>
          <Button label={t('test.add')} icon="add" variant="outline" onPress={start} disabled={disabled} style={{ marginTop: spacing.sm }} testID="test-add" />
        </>
      )}
    </Card>
  );
}

function Field({ label, hint, value, onChange, testID }: { label: string; hint: string; value: string; onChange: (v: string) => void; testID: string }) {
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={st.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder={hint}
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={label}
        style={st.input}
        testID={testID}
      />
    </View>
  );
}

const st = StyleSheet.create({
  label: { fontSize: 13.5, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  input: {
    marginTop: 4,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'center' },
});
