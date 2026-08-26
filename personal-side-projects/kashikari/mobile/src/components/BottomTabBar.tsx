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
            <Ionicons name={active ? item.iconActive : item.icon} size={22} color={active ? colors.accent : colors.muted} />
            <Text style={[styles.label, active && styles.labelActive]}>{labelOf(item.key)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 8,
    paddingBottom: 26,
  },
  btn: { flex: 1, alignItems: 'center', gap: 3 },
  label: { ...fonts.bodyMedium, fontSize: 11, color: colors.muted },
  labelActive: { ...fonts.bodySemiBold, color: colors.accent },
});
