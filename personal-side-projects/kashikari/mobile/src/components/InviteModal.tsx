import { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';

import PrimaryButton from './PrimaryButton';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  // 招待した相手の名前を「招待中」一覧に出すために必須にしている。
  // 成功したら呼び出し側で共有シートを開く。
  onSubmit: (invitedName: string) => Promise<{ error: string | null }>;
};

export default function InviteModal({ visible, onClose, onSubmit }: Props) {
  const t = useT();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setName('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t.group.inviteModalNameRequiredError);
      return;
    }
    setSubmitting(true);
    const res = await onSubmit(trimmed);
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
          <Text style={styles.title}>{t.group.inviteModalTitle}</Text>
          <TextInput
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError(null);
            }}
            placeholder={t.group.inviteModalNamePlaceholder}
            placeholderTextColor={colors.muted}
            maxLength={20}
            style={styles.input}
            autoFocus
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.actions}>
            <PrimaryButton title={t.common.cancel} variant="ghost" onPress={close} />
            <PrimaryButton title={t.group.inviteModalSubmit} onPress={submit} loading={submitting} disabled={!name.trim()} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', backgroundColor: colors.surface, borderRadius: 18, padding: 20 },
  title: { ...fonts.display, fontSize: 19, color: colors.ink, marginBottom: 14 },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  error: { color: colors.danger, ...fonts.body, fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
});
