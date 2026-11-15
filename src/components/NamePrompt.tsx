import { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';

import { useI18n } from '../i18n';
import { colors, spacing } from '../theme/colors';
import { Button, Row } from './ui';

export function NamePrompt({
  visible,
  title,
  initialValue,
  placeholder,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  placeholder?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        {/* Mounted per opening, so the field always starts from the current initial value. */}
        {visible ? <NameForm title={title} initialValue={initialValue} placeholder={placeholder} onSubmit={onSubmit} onCancel={onCancel} /> : null}
      </View>
    </Modal>
  );
}

function NameForm({
  title,
  initialValue,
  placeholder,
  onSubmit,
  onCancel,
}: {
  title: string;
  initialValue: string;
  placeholder?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);
  return (
    <View style={s.sheet}>
      <Text style={s.title}>{title}</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        style={s.input}
        autoFocus
        accessibilityLabel={t('common.name')}
      />
      <Row>
        <Button label={t('common.cancel')} variant="outline" onPress={onCancel} />
        <Button label={t('common.save')} icon="checkmark" disabled={!value.trim()} onPress={() => onSubmit(value.trim())} />
      </Row>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.xl },
  sheet: { backgroundColor: colors.surface, borderRadius: 22, padding: spacing.xl, gap: spacing.md },
  title: { fontSize: 17.5, fontWeight: '700', color: colors.text },
  input: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: colors.primarySoft,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.text,
  },
});
