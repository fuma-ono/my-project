import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme';

type Props = {
  message: string;
  visible: boolean;
  onHide: () => void;
  duration?: number;
};

// 汎用の軽量トースト。Alertと違ってタップ不要で自動的に消えるため、
// 「押した」以上の意思決定を求めない一言メッセージ(Premiumの「興味が
// ある」への謝辞など)に向いている。今のところ呼び出し元は1画面だけ
// なので、グローバルなキュー等は持たずローカルstateで完結させている。
export default function Toast({ message, visible, onHide, duration = 2600 }: Props) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onHide, duration);
    return () => clearTimeout(timer);
  }, [visible, duration, onHide]);

  if (!visible) return null;

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.bubble}>
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 40, alignItems: 'center', paddingHorizontal: 24 },
  bubble: {
    backgroundColor: colors.ink,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    maxWidth: '100%',
  },
  text: { ...fonts.bodyMedium, fontSize: 13.5, color: '#fff', textAlign: 'center' },
});
