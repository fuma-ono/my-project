import { Modal, StyleSheet, Text, View } from 'react-native';

import PrimaryButton from './PrimaryButton';
import { colors, fonts } from '../theme';

type Props = {
  visible: boolean;
  emoji?: string;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  // <Modal>が実際に閉じ終わった瞬間(iOS専用)に呼ばれる。呼び出し側は、
  // このモーダルを閉じた直後に別のネイティブUI(次のモーダル・招待
  // シート等)を開きたい場合、必ずこのコールバックまで待つこと
  // (InviteModal.tsx/ShareChannelSheet.tsxと同じ理由・同じパターン)。
  onDismiss?: () => void;
};

// 「精算完了」時の紹介ダイアログ・レビュー依頼ダイアログ用(99回目)。
// 元々はAlert.alertを連続で呼ぶ実装だったが、実機で「閉じるを押すと
// 真っ白い画面のまま固まる」「紹介するを押しても何も出てこない」という
// 報告を受けた。iOSのネイティブAlertは、1つ目を閉じている最中に
// 2つ目のAlertや別のネイティブ画面を提示しようとすると競合しやすく、
// setTimeoutで遅延させる程度の対処では実機で再現し続けた。
// このアプリでは既に「独自の<Modal>+onDismiss」でこの種の競合を
// 確実に回避できている(InviteModal/ShareChannelSheet)ため、Alertを
// やめてこちらに統一する。
export default function CelebrationModal({ visible, emoji, title, message, cancelLabel, confirmLabel, onCancel, onConfirm, onDismiss }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} onDismiss={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {emoji && <Text style={styles.emoji}>{emoji}</Text>}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <PrimaryButton title={cancelLabel} variant="ghost" onPress={onCancel} />
            <PrimaryButton title={confirmLabel} onPress={onConfirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', backgroundColor: colors.surface, borderRadius: 18, padding: 24, alignItems: 'center' },
  emoji: { fontSize: 40, marginBottom: 8 },
  title: { ...fonts.display, fontSize: 19, color: colors.ink, marginBottom: 8, textAlign: 'center' },
  message: { ...fonts.body, fontSize: 14.5, color: colors.muted, textAlign: 'center', lineHeight: 21 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 20 },
});
