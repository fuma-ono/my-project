import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import AuthMethods from './AuthMethods';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  // サインインが成功した瞬間(=中断ではなく実際にサインインできた)に呼ぶ。
  onSignedIn: () => void;
};

// 「ログインの時はページではなく、ボタンを押したら下からログイン項目が
// 出てくる感じがいいんじゃないかな?」という指摘への対応。新規登録は
// 名前・アイコン登録へと続く「一連の流れ」なのでページ遷移のままにし、
// ログインは(成功すればそれだけで完了する)単発の操作なので、
// ShareChannelSheet.tsxと同じ下から出るシートに変更した。
export default function LoginSheet({ visible, onClose, onSignedIn }: Props) {
  const t = useT();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoider}>
          {/* カード自体のタップがbackdropのonPress(閉じる)まで伝播しないようにする */}
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.grabber} />
            <Text style={styles.title}>{t.onboarding.accountStepTitleLogin}</Text>
            <Text style={styles.description}>{t.onboarding.accountStepDescriptionLogin}</Text>
            <AuthMethods mode="signin" onDone={onSignedIn} />
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>{t.common.cancel}</Text>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.45)', justifyContent: 'flex-end' },
  avoider: { justifyContent: 'flex-end' },
  card: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  grabber: { width: 36, height: 4, borderRadius: 999, backgroundColor: colors.line, alignSelf: 'center', marginBottom: 16 },
  title: { ...fonts.display, fontSize: 19, color: colors.ink, textAlign: 'center' },
  description: { ...fonts.body, fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19, marginTop: 4, marginBottom: 18 },
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
