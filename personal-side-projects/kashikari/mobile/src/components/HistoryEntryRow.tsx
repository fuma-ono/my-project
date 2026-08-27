import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { entryFromKey, entryToKey } from '../lib/balances';
import { formatMoney } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { Entry } from '../types';

type Props = {
  entry: Entry; // settle_status === 'confirmed' の記録だけを渡す想定
  nameOf: (id: string) => string;
  meId: string | null;
};

// 履歴タブ専用の行。台帳(EntryRow)と違って編集操作は持たず、
// 「双方確認が完了した」ことをお祝いする緑の完了表示に徹する
// (from_user=貸した人=あとで受け取る側、to_user=借りた人=あとで払う側、
// という既存の向きの規約のまま、確認済み後の視点で文章化する)。
export default function HistoryEntryRow({ entry, nameOf, meId }: Props) {
  const t = useT();
  const amountLabel = entry.type === 'money' ? formatMoney(entry.amount ?? 0, entry.currency) : t.common.favorCount(1);

  const fromKey = entryFromKey(entry);
  const toKey = entryToKey(entry);
  let sentence: string;
  if (fromKey === meId) {
    sentence = t.history.receivedFrom(nameOf(toKey));
  } else if (toKey === meId) {
    sentence = t.history.paidTo(nameOf(fromKey));
  } else {
    sentence = `${nameOf(fromKey)} → ${nameOf(toKey)}`;
  }

  return (
    <View style={styles.row}>
      <View style={styles.badge}>
        <Text style={styles.badgeEmoji}>✅</Text>
      </View>
      <View style={styles.main}>
        <Text style={styles.badgeLabel}>{t.history.completedBadge}</Text>
        <Text style={styles.sentence} numberOfLines={1}>
          {sentence}
        </Text>
        {!!entry.description && (
          <Text style={styles.desc} numberOfLines={1}>
            {entry.description}
          </Text>
        )}
      </View>
      <Text style={styles.amount}>{amountLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  badge: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.positiveSoft },
  badgeEmoji: { fontSize: 16 },
  main: { flex: 1, minWidth: 0 },
  badgeLabel: { ...fonts.bodySemiBold, fontSize: 11, color: colors.positive, textTransform: 'uppercase', letterSpacing: 0.4 },
  sentence: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink, marginTop: 1 },
  desc: { ...fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { ...fonts.display, fontSize: 15, color: colors.positive },
});
