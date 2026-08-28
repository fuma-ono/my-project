import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRef } from 'react';
import { Linking, Modal, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { colors, fonts } from '../theme';

type Action = 'line' | 'email' | 'copy' | 'other';

type Props = {
  visible: boolean;
  // 招待メッセージ・催促メッセージなど、送りたい文面をそのまま渡す。
  message: string;
  onClose: () => void;
  // 「リンクをコピー」を選んだ後、呼び出し側でトースト表示するためのフック。
  onCopied?: () => void;
};

// 「共有するを押したときにLINEやメール、などのリンクを送れるようにして
// ほしい」という要望への対応。以前はOS標準の共有シート(Share.share)を
// 直接開くだけだったが、LINE・メールが一覧の奥に埋もれて分かりづらい、
// という声を受け、この2つを専用ボタンとして手前に出す。「その他の方法」
// で従来通りのOS共有シート(Messages/AirDrop等、端末の全アプリ)にも
// 引き続きアクセスできる。
export default function ShareChannelSheet({ visible, message, onClose, onCopied }: Props) {
  const t = useT();
  // このシート自身も<Modal>のため、閉じるアニメーション中に別の
  // ネイティブ画面(OS共有シートやLINE/メールアプリ)を開こうとすると、
  // InviteModal→共有シートの間で以前踏んだのと同じ「閉じきる前に次を
  // 開こうとして何も表示されない」問題が起きうる。同じ対策(onDismiss
  // まで待つ)を、ここでも一律に適用する。
  const pendingActionRef = useRef<Action | null>(null);

  const runAction = (action: Action) => {
    if (action === 'line') {
      Linking.openURL(`https://line.me/R/msg/text/?${encodeURIComponent(message)}`);
    } else if (action === 'email') {
      Linking.openURL(`mailto:?body=${encodeURIComponent(message)}`);
    } else if (action === 'copy') {
      Clipboard.setStringAsync(message);
      onCopied?.();
    } else {
      Share.share({ message });
    }
  };

  const triggerPending = () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) runAction(action);
  };

  const select = (action: Action) => {
    pendingActionRef.current = action;
    onClose();
    if (Platform.OS !== 'ios') setTimeout(triggerPending, 400);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={triggerPending}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* カード自体のタップがbackdropのonPress(閉じる)まで伝播しないようにする */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{t.group.shareSheetTitle}</Text>
          <Row icon="chatbubble" iconColor="#06C755" label={t.group.shareSheetLine} onPress={() => select('line')} />
          <Row icon="mail" iconColor={colors.accent} label={t.group.shareSheetEmail} onPress={() => select('email')} />
          <Row icon="copy-outline" iconColor={colors.muted} label={t.group.shareSheetCopy} onPress={() => select('copy')} />
          <Row icon="share-social-outline" iconColor={colors.muted} label={t.group.shareSheetOther} onPress={() => select('other')} />
          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelBtnText}>{t.common.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({
  icon,
  iconColor,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: iconColor + '1a' }]}>
        <Ionicons name={icon} size={19} color={iconColor} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.45)', alignItems: 'center', justifyContent: 'flex-end' },
  card: { width: '100%', backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  title: { ...fonts.bodySemiBold, fontSize: 15, color: colors.muted, textAlign: 'center', marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...fonts.bodyMedium, fontSize: 15.5, color: colors.ink, flex: 1 },
  cancelBtn: {
    marginTop: 14,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  cancelBtnText: { ...fonts.bodySemiBold, fontSize: 15, color: colors.muted },
});
