import { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';

import PrimaryButton from './PrimaryButton';
import { colors, fonts } from '../theme';

type Props = {
  visible: boolean;
  mode: 'create' | 'join';
  onClose: () => void;
  onSubmit: (value: string) => Promise<{ error: string | null }>;
};

export default function GroupFormModal({ visible, mode, onClose, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setValue('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    setSubmitting(true);
    const res = await onSubmit(value);
    setSubmitting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    close();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{mode === 'create' ? '新しいグループ' : '招待コードで参加'}</Text>
          <TextInput
            value={value}
            onChangeText={(t) => {
              setValue(mode === 'join' ? t.toUpperCase() : t);
              setError(null);
            }}
            placeholder={mode === 'create' ? '例: 大学の友達' : '例: A1B2C3'}
            placeholderTextColor={colors.muted}
            autoCapitalize={mode === 'join' ? 'characters' : 'none'}
            maxLength={mode === 'create' ? 30 : 6}
            style={styles.input}
            autoFocus
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.actions}>
            <PrimaryButton title="キャンセル" variant="ghost" onPress={close} />
            <PrimaryButton title={mode === 'create' ? '作成する' : '参加する'} onPress={submit} loading={submitting} disabled={!value.trim()} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', backgroundColor: colors.surface, borderRadius: 18, padding: 20 },
  title: { fontFamily: fonts.display, fontSize: 19, color: colors.ink, marginBottom: 14 },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
});
