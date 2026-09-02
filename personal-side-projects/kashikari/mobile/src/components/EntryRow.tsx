import { useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { entryFromKey, entryToKey } from '../lib/balances';
import { formatMoney } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { Entry } from '../types';
import { useReceiptUrl } from '../hooks/useReceiptUrl';

type Props = {
  entry: Entry;
  nameOf: (id: string) => string;
  meId: string | null;
  onToggleSettled: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
};

// Venmo/Cash Appのアクティビティフィードに寄せ、カード感(枠線・影)をやめて
// フラットな一覧行にした。金額の色は残高と同じ意味付け(緑=受け取る/赤=払う)を
// 使い、自分が関係しない記録はニュートラルにする。
export default function EntryRow({ entry, nameOf, meId, onToggleSettled, onDelete }: Props) {
  const t = useT();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const photoUrl = useReceiptUrl(entry.photo_path);
  const settled = entry.settle_status === 'confirmed';

  // from_user = 貸した人(あとで受け取る側)、to_user = 借りた人(あとで払う側)
  const fromKey = entryFromKey(entry);
  const toKey = entryToKey(entry);
  const iAmReceiver = fromKey === meId;
  const iAmPayer = toKey === meId;
  const amountColor = settled ? colors.muted : iAmPayer ? colors.negative : iAmReceiver ? colors.positive : colors.ink;

  // 66回目: グループ内なら誰でも他人の記録を編集・削除できてしまう
  // 状態をやめ、「記録の当事者(貸した人/借りた人)か、記録した本人」だけに
  // 絞った(schema.sqlのentries UPDATE/DELETEポリシーと対応させている)。
  // 削除は記録した本人だけ(間違えて登録した記録を本人が取り消す用途の
  // ため)、精算状態の切り替えは当事者2人のどちらかでも本人でも可。
  const canToggleSettled = entry.created_by === meId || iAmReceiver || iAmPayer;
  const canDelete = entry.created_by === meId;

  const openMenu = () => {
    if (!canToggleSettled && !canDelete) return;
    Alert.alert(
      '',
      undefined,
      [
        ...(canToggleSettled
          ? [{ text: settled ? t.entryRow.markUnsettled : t.entryRow.markSettled, onPress: () => onToggleSettled(entry) }]
          : []),
        ...(canDelete ? [{ text: t.entryRow.delete, style: 'destructive' as const, onPress: () => onDelete(entry) }] : []),
        { text: t.common.cancel, style: 'cancel' as const },
      ],
      { cancelable: true }
    );
  };

  return (
    <View style={styles.row}>
      <View style={[styles.badge, { backgroundColor: entry.type === 'money' ? colors.accentSoft : colors.favorSoft }]}>
        <Text style={styles.badgeEmoji}>{entry.type === 'money' ? '💰' : '🤝'}</Text>
      </View>

      <View style={styles.main}>
        <Text style={[styles.who, settled && styles.strike]} numberOfLines={1}>
          {nameOf(fromKey)} <Text style={styles.arrow}>→</Text> {nameOf(toKey)}
        </Text>
        {!!entry.description && (
          <Text style={styles.desc} numberOfLines={1}>
            {entry.description}
          </Text>
        )}
      </View>

      {photoUrl && (
        <Pressable onPress={() => setLightboxOpen(true)}>
          <Image source={{ uri: photoUrl }} style={styles.thumb} />
        </Pressable>
      )}

      <Text style={[styles.amount, { color: amountColor }, settled && styles.strike]}>
        {entry.type === 'money' ? formatMoney(entry.amount ?? 0, entry.currency) : t.common.favorCount(1)}
      </Text>

      {(canToggleSettled || canDelete) && (
        <Pressable onPress={openMenu} hitSlop={8} style={styles.menuBtn}>
          <Text style={styles.menuDots}>⋯</Text>
        </Pressable>
      )}

      <Modal visible={lightboxOpen} transparent animationType="fade" onRequestClose={() => setLightboxOpen(false)}>
        <Pressable style={styles.lightboxBg} onPress={() => setLightboxOpen(false)}>
          {photoUrl && <Image source={{ uri: photoUrl }} style={styles.lightboxImg} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  badge: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  badgeEmoji: { fontSize: 16 },
  main: { flex: 1, minWidth: 0 },
  who: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink },
  arrow: { color: colors.muted },
  desc: { ...fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  thumb: { width: 34, height: 34, borderRadius: 9 },
  amount: { ...fonts.display, fontSize: 15 },
  strike: { textDecorationLine: 'line-through', opacity: 0.6 },
  menuBtn: { padding: 4 },
  menuDots: { fontSize: 18, color: colors.muted },
  lightboxBg: { flex: 1, backgroundColor: 'rgba(20,15,10,0.9)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  lightboxImg: { width: '100%', height: '100%' },
});
