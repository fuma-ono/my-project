import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import PrimaryButton from './PrimaryButton';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  // 招待した相手の名前を「招待中」一覧に出すために必須にしている。
  // 成功したら呼び出し側で共有シートを開く。
  onSubmit: (invitedName: string) => Promise<{ error: string | null }>;
  // <Modal>が実際に閉じ終わった瞬間(iOS専用)に呼ばれる。招待成功後、
  // このモーダルの閉じるアニメーション中にOS標準の共有シートを開こうと
  // すると、iOSでは「モーダルを閉じている最中に別のモーダルを開こうと
  // する」形になり共有シートが表示されないまま消えてしまうため、
  // 呼び出し側はこのコールバックまで共有シートを開くのを待つ。
  onDismiss?: () => void;
};

export default function InviteModal({ visible, onClose, onSubmit, onDismiss }: Props) {
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} onDismiss={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconHeader}>
            <View style={styles.iconBadge}>
              <Ionicons name="mail" size={28} color={colors.accent} />
            </View>
            <View style={styles.addBadge}>
              <Ionicons name="add" size={14} color="#fff" />
            </View>
            <Ionicons name="sparkles" size={14} color={colors.accent} style={styles.sparkleTopRight} />
            <Ionicons name="sparkles" size={10} color={colors.plum} style={styles.sparkleBottomLeft} />
          </View>

          <Text style={styles.title}>{t.group.inviteModalTitle}</Text>
          <Text style={styles.subtitle}>{t.group.inviteModalSubtitle}</Text>

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
          <Text style={styles.hint}>{t.group.inviteModalNameHint}</Text>
          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <PrimaryButton title={t.group.inviteModalSubmit} onPress={submit} loading={submitting} disabled={!name.trim()} style={styles.fullWidthBtn} />
            <Pressable onPress={close} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>{t.common.cancel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', backgroundColor: colors.surface, borderRadius: 18, padding: 20, alignItems: 'center' },
  iconHeader: { width: 64, height: 64, marginBottom: 14, alignItems: 'center', justifyContent: 'center' },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3c2814',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  addBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: colors.favor,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  sparkleTopRight: { position: 'absolute', top: -4, right: -6 },
  sparkleBottomLeft: { position: 'absolute', bottom: -2, left: -8 },
  title: { ...fonts.display, fontSize: 19, color: colors.ink, textAlign: 'center' },
  subtitle: { ...fonts.bodyMedium, fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 4, marginBottom: 18 },
  input: {
    width: '100%',
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  hint: { ...fonts.bodyMedium, fontSize: 12, color: colors.muted, alignSelf: 'flex-start', marginTop: 6 },
  error: { color: colors.danger, ...fonts.body, fontSize: 13, marginTop: 8, alignSelf: 'flex-start' },
  actions: { width: '100%', marginTop: 18, gap: 10 },
  fullWidthBtn: { width: '100%' },
  cancelBtn: {
    width: '100%',
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  cancelBtnText: { ...fonts.bodySemiBold, fontSize: 15, color: colors.muted },
});
