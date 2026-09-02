import { useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import EditEntrySheet from './EditEntrySheet';
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
  onUpdate: (
    entry: Entry,
    input: { amount: number | null; currency: string | null; description: string; photoUri?: string | null; removePhoto?: boolean }
  ) => Promise<{ error: string | null }>;
  onDelete: (entry: Entry) => void;
};

// 自分以外の誰かが精算状態や内容を変更してから、まだこのくらいの
// 時間内なら「最近変わった」とみなして印を付ける(68回目)。ずっと
// 表示され続けると気付いた後もノイズになるため、既読管理はせず
// 一定時間で自然に消えるだけの簡易な仕組みにしている。
const RECENTLY_CHANGED_WINDOW_MS = 48 * 60 * 60 * 1000; // 48時間

// Venmo/Cash Appのアクティビティフィードに寄せ、カード感(枠線・影)をやめて
// フラットな一覧行にした。金額の色は残高と同じ意味付け(緑=受け取る/赤=払う)を
// 使い、自分が関係しない記録はニュートラルにする。
export default function EntryRow({ entry, nameOf, meId, onToggleSettled, onUpdate, onDelete }: Props) {
  const t = useT();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const photoUrl = useReceiptUrl(entry.photo_path);
  const settled = entry.settle_status === 'confirmed';

  // from_user = 貸した人(あとで受け取る側)、to_user = 借りた人(あとで払う側)
  const fromKey = entryFromKey(entry);
  const toKey = entryToKey(entry);
  const iAmReceiver = fromKey === meId;
  const iAmPayer = toKey === meId;

  // グループ内はメンバーなら誰でも他人の記録に触れてよいので(schema.sql
  // 参照)、押しつけのプッシュ通知だけでなく、台帳を見た時にも「これ、
  // 自分以外の誰かが最近変えたんだ」と一目で分かるようにする。対象は
  // 自分が当事者・記録者である記録だけ(通知を送る相手と同じ集合)。
  const isRecentlyChangedByOther =
    !!entry.updated_by &&
    entry.updated_by !== meId &&
    (entry.created_by === meId || iAmReceiver || iAmPayer) &&
    !!entry.updated_at &&
    Date.now() - new Date(entry.updated_at).getTime() < RECENTLY_CHANGED_WINDOW_MS;

  const amountColor = settled ? colors.muted : iAmPayer ? colors.negative : iAmReceiver ? colors.positive : colors.ink;

  // グループ内は「メンバーなら誰でも他人の記録に触れてよい」という
  // 信頼前提(schema.sql参照)。66回目で一度、当事者・記録者だけに
  // 絞ったが、「相手の記録に触れてもいいから、誰が変更したか分かる
  // ようにしてほしい」というオーナーの意向を受けて68回目で元に戻した。
  // 代わりに、ここでの操作(精算済み/未精算の切り替え・削除)は
  // useGroupData.ts側で当事者・記録者に通知される。
  const openMenu = () => {
    Alert.alert(
      '',
      undefined,
      [
        { text: settled ? t.entryRow.markUnsettled : t.entryRow.markSettled, onPress: () => onToggleSettled(entry) },
        { text: t.entryRow.edit, onPress: () => setEditOpen(true) },
        { text: t.entryRow.delete, style: 'destructive', onPress: () => onDelete(entry) },
        { text: t.common.cancel, style: 'cancel' },
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

      <View style={styles.amountCol}>
        <Text style={[styles.amount, { color: amountColor }, settled && styles.strike]}>
          {entry.type === 'money' ? formatMoney(entry.amount ?? 0, entry.currency) : t.common.favorCount(1)}
        </Text>
        {isRecentlyChangedByOther && <Text style={styles.recentlyChangedTag}>{t.entryRow.recentlyChanged}</Text>}
      </View>

      <Pressable onPress={openMenu} hitSlop={8} style={styles.menuBtn}>
        <Text style={styles.menuDots}>⋯</Text>
      </Pressable>

      <Modal visible={lightboxOpen} transparent animationType="fade" onRequestClose={() => setLightboxOpen(false)}>
        <Pressable style={styles.lightboxBg} onPress={() => setLightboxOpen(false)}>
          {photoUrl && <Image source={{ uri: photoUrl }} style={styles.lightboxImg} resizeMode="contain" />}
        </Pressable>
      </Modal>

      <EditEntrySheet visible={editOpen} entry={editOpen ? entry : null} onClose={() => setEditOpen(false)} onSubmit={onUpdate} />
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
  amountCol: { alignItems: 'flex-end' },
  amount: { ...fonts.display, fontSize: 15 },
  // 自分以外の誰かが最近変更した記録に付ける小さな印(68回目は金額の
  // 色を変えていたが、「色より分かりやすいマーク・文字にしてほしい」
  // という指摘を受けて71回目でこちらに変更した)。
  recentlyChangedTag: {
    ...fonts.bodySemiBold,
    fontSize: 10.5,
    color: colors.accent,
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    paddingVertical: 1,
    paddingHorizontal: 6,
    marginTop: 3,
  },
  strike: { textDecorationLine: 'line-through', opacity: 0.6 },
  menuBtn: { padding: 4 },
  menuDots: { fontSize: 18, color: colors.muted },
  lightboxBg: { flex: 1, backgroundColor: 'rgba(20,15,10,0.9)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  lightboxImg: { width: '100%', height: '100%' },
});
