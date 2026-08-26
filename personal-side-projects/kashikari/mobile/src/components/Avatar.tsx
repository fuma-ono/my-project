import { StyleSheet, Text, View } from 'react-native';

import { avatarColor, avatarInitial } from '../theme';

type Props = {
  name: string;
  emoji?: string | null;
  size?: 'sm' | 'md' | 'lg';
};

// emojiが選ばれていれば絵文字アバター、なければ従来通り頭文字を表示する
// (絵文字選択前の既存ユーザーや、フォールバック用)。
// lgは「メンバーのアイコンを少し大きくする」という指摘を受けて追加した
// (グループ画面のメンバー行専用。他の画面のmdサイズはそのまま)。
export default function Avatar({ name, emoji, size = 'md' }: Props) {
  // 「人のアイコンを大きくするんじゃなくて」という指摘を受け、
  // 一度48に拡大したlgを44に戻した(拡大より残高カード側を
  // 大きくする方向に変更)。
  const dim = size === 'sm' ? 24 : size === 'lg' ? 44 : 34;
  return (
    <View style={[styles.base, { width: dim, height: dim, borderRadius: dim / 2, backgroundColor: avatarColor(name) }]}>
      {emoji ? (
        <Text style={{ fontSize: dim * 0.58 }}>{emoji}</Text>
      ) : (
        <Text style={[styles.text, { fontSize: size === 'sm' ? 11.5 : size === 'lg' ? 18 : 14 }]}>{avatarInitial(name)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff', fontWeight: '600' },
});
