import { useState } from 'react';
import { Modal, Text, TextInput, View, StyleSheet } from 'react-native';

import PrimaryButton from './PrimaryButton';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (message: string) => Promise<{ error: string | null }>;
};

// リリース運用の仕組み(99回目)。「ご意見・不具合報告」フォーム。
// 送信後は本人にも読み返せない投書箱方式(schema.sql参照)なので、
// 送信できたことだけをその場で分かりやすく伝える作りにしている。
export default function FeedbackModal({ visible, onClose, onSubmit }: Props) {
  const t = useT();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const close = () => {
    setMessage('');
    setError(null);
    setSent(false);
    onClose();
  };

  const submit = async () => {
    setSubmitting(true);
    const res = await onSubmit(message);
    setSubmitting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setSent(true);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {sent ? (
            <>
              <Text style={styles.title}>{t.feedback.sentTitle}</Text>
              <Text style={styles.sentBody}>{t.feedback.sentBody}</Text>
              <View style={styles.actions}>
                <PrimaryButton title={t.common.close} onPress={close} />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>{t.feedback.title}</Text>
              <Text style={styles.subtitle}>{t.feedback.subtitle}</Text>
              <TextInput
                value={message}
                onChangeText={(v) => {
                  setMessage(v);
                  setError(null);
                }}
                placeholder={t.feedback.placeholder}
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={5}
                maxLength={2000}
                style={styles.input}
                autoFocus
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <View style={styles.actions}>
                <PrimaryButton title={t.common.cancel} variant="ghost" onPress={close} />
                <PrimaryButton title={t.feedback.submitButton} onPress={submit} loading={submitting} disabled={!message.trim()} />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', backgroundColor: colors.surface, borderRadius: 18, padding: 20 },
  title: { ...fonts.display, fontSize: 19, color: colors.ink, marginBottom: 6 },
  subtitle: { ...fonts.body, fontSize: 13.5, color: colors.muted, marginBottom: 14, lineHeight: 19 },
  sentBody: { ...fonts.body, fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 4 },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...fonts.body,
    fontSize: 15,
    color: colors.ink,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  error: { color: colors.danger, ...fonts.body, fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
});
