import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme';

// AvatarPicker(人のアイコン)とGroupIconPicker(グループのアイコン)で
// 見た目・挙動が同じなため共通化した、絵文字グリッド選択モーダルの本体。
type Props = {
  visible: boolean;
  title: string;
  options: readonly string[];
  selected: string | null;
  cellBackground: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  // 「アイコンで自分の写真を使えるようにしてほしい。写真かアイコンかを
  // 選択できるように」への対応。渡すと絵文字グリッドの上に「写真から
  // 選ぶ」ボタンを出す(AvatarPicker/GroupIconPicker側で実際の撮影/
  // 選択・アップロードを行う)。
  photoButtonLabel?: string;
  onPickPhoto?: () => void;
};

export default function EmojiGridPicker({
  visible,
  title,
  options,
  selected,
  cellBackground,
  onSelect,
  onClose,
  photoButtonLabel,
  onPickPhoto,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
          {onPickPhoto && (
            <Pressable onPress={onPickPhoto} style={styles.photoButton}>
              <Ionicons name="image-outline" size={18} color={colors.accent} />
              <Text style={styles.photoButtonText}>{photoButtonLabel}</Text>
            </Pressable>
          )}
          <ScrollView contentContainerStyle={styles.grid}>
            {options.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => onSelect(emoji)}
                style={[styles.cell, { backgroundColor: cellBackground }, selected === emoji && styles.cellSelected]}
              >
                <Text style={styles.emoji}>{emoji}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, maxHeight: '70%', backgroundColor: colors.surface, borderRadius: 20, padding: 20 },
  title: { ...fonts.displayMedium, fontSize: 18, color: colors.ink, marginBottom: 14 },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 14,
  },
  photoButtonText: { ...fonts.bodySemiBold, fontSize: 14, color: colors.accent },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.55,
  },
  cellSelected: { opacity: 1, borderWidth: 3, borderColor: colors.ink },
  emoji: { fontSize: 28 },
});
