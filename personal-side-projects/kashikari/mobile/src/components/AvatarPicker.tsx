import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AVATAR_EMOJI_OPTIONS, avatarColor, colors, fonts } from '../theme';

type Props = {
  visible: boolean;
  name: string; // 選択肢の背景色を、既存のアバター配色と揃えるために使う
  selected: string | null;
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

export default function AvatarPicker({ visible, name, selected, onSelect, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>アイコンを選ぶ</Text>
          <ScrollView contentContainerStyle={styles.grid}>
            {AVATAR_EMOJI_OPTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => onSelect(emoji)}
                style={[styles.cell, { backgroundColor: avatarColor(name) }, selected === emoji && styles.cellSelected]}
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
