import { useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMoney } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { Entry } from '../types';
import { useReceiptUrl } from '../hooks/useReceiptUrl';

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

type Props = {
  entry: Entry;
  nameOf: (id: string) => string;
  onToggleSettled: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
};

export default function EntryRow({ entry, nameOf, onToggleSettled, onDelete }: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const photoUrl = useReceiptUrl(entry.photo_path);
  const settled = entry.settled;

  const openMenu = () => {
    Alert.alert(
      '',
      undefined,
      [
        { text: settled ? '未精算に戻す' : '精算済みにする', onPress: () => onToggleSettled(entry) },
        { text: '削除', style: 'destructive', onPress: () => onDelete(entry) },
        { text: 'キャンセル', style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  return (
    <View style={[styles.row, settled && styles.rowSettled]}>
      <View style={[styles.badge, { backgroundColor: entry.type === 'money' ? colors.accentSoft : colors.favorSoft }]}>
        <Text style={styles.badgeEmoji}>{entry.type === 'money' ? '💰' : '🤝'}</Text>
      </View>

      <View style={styles.main}>
        <Text style={[styles.who, settled && styles.strike]} numberOfLines={1}>
          {nameOf(entry.from_user)} <Text style={styles.arrow}>→</Text> {nameOf(entry.to_user)}
        </Text>
        <Text style={styles.desc} numberOfLines={1}>
          {entry.description ? entry.description + ' ・ ' : ''}
          {formatDate(entry.created_at)}
        </Text>
      </View>

      {photoUrl && (
        <Pressable onPress={() => setLightboxOpen(true)}>
          <Image source={{ uri: photoUrl }} style={styles.thumb} />
        </Pressable>
      )}

      <Text style={[styles.amount, settled && styles.strike]}>
        {entry.type === 'money' ? formatMoney(entry.amount ?? 0, entry.currency) : '1件'}
      </Text>

      <Pressable onPress={openMenu} hitSlop={8} style={styles.menuBtn}>
        <Text style={styles.menuDots}>⋯</Text>
      </Pressable>

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
    padding: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  rowSettled: { borderStyle: 'dashed' },
  badge: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeEmoji: { fontSize: 17 },
  main: { flex: 1, minWidth: 0 },
  who: { fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: colors.ink },
  arrow: { color: colors.muted },
  desc: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  thumb: { width: 36, height: 36, borderRadius: 9 },
  amount: { fontFamily: fonts.display, fontSize: 15, color: colors.ink },
  strike: { textDecorationLine: 'line-through', opacity: 0.5 },
  menuBtn: { padding: 4 },
  menuDots: { fontSize: 18, color: colors.muted },
  lightboxBg: { flex: 1, backgroundColor: 'rgba(20,15,10,0.9)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  lightboxImg: { width: '100%', height: '100%' },
});
