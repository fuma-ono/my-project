import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { colors, fonts } from '../theme';

export type GroupTab = 'balance' | 'ledger' | 'history';

type Props = {
  tab: GroupTab;
  onChange: (tab: GroupTab) => void;
};

const ITEMS: { key: GroupTab; icon: keyof typeof Ionicons.glyphMap; iconActive: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'balance', icon: 'home-outline', iconActive: 'home' },
  { key: 'history', icon: 'time-outline', iconActive: 'time' },
  { key: 'ledger', icon: 'document-text-outline', iconActive: 'document-text' },
];

// 参考UIに合わせて、上部のセグメントコントロールから画面下固定の
// タブバー(アイコン+ラベル)に変更した。iOS/Android標準アプリでよく
// 見る形で、片手操作の親指の届く位置に主要ナビゲーションを置ける。
export default function BottomTabBar({ tab, onChange }: Props) {
  const t = useT();
  const labelOf = (key: GroupTab) => (key === 'balance' ? t.group.tabBalance : key === 'history' ? t.group.tabHistory : t.group.tabLedger);

  return (
    <View style={styles.wrap}>
      {ITEMS.map((item) => {
        const active = tab === item.key;
        return (
          <Pressable key={item.key} onPress={() => onChange(item.key)} style={styles.btn} hitSlop={4}>
            {/* 「選択中のタブは背景＋文字色で明確にする」という指摘を受け、
                色の変化だけでなく、アイコン+ラベルの背後に薄い背景ピルを
                添えて選択状態をより分かりやすくした。 */}
            <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
              <Ionicons name={active ? item.iconActive : item.icon} size={26} color={active ? colors.accent : colors.muted} />
            </View>
            <Text style={[styles.label, active && styles.labelActive]}>{labelOf(item.key)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // 【重要な気づき】wrapはbottom:0で画面下端に固定されているため、
  // paddingTopを増やしても「バーの高さ(=上端の位置)」が上に伸びる
  // だけで、中のアイコン・ラベル自体の画面上の位置は変わらない
  // (btnはalignItems:'center'で横方向は揃えるが、中身はデフォルトで
  // 上詰めのため、アイコン・ラベルの実際の位置はpaddingBottom側で
  // 決まる)。そのため前回までpaddingTopを8→14→20と増やし続けても
  // 「まだ下がってない」という指摘が続き、むしろバーの上端(罫線)が
  // 上に伸びて＋ボタン(FAB)と重なってしまっていた。
  // 今回「アイコンと名前をまだ下げて」「上線も＋が見えるくらいまで
  // 下げて」という指摘を受け、根本原因を踏まえて逆方向に修正:
  // paddingBottomを22→14に減らしてアイコン・ラベルを実際に下へ
  // 動かし、paddingTopも20→10に戻してバー自体の高さを縮め、上端の
  // 罫線をFABの下まで下げた。
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
    paddingBottom: 14,
  },
  btn: { flex: 1, alignItems: 'center', gap: 5 },
  iconWrap: { paddingHorizontal: 18, paddingVertical: 3, borderRadius: 999 },
  iconWrapActive: { backgroundColor: colors.accentSoft },
  label: { ...fonts.bodyMedium, fontSize: 11, color: colors.muted },
  labelActive: { ...fonts.bodySemiBold, color: colors.accent },
});
