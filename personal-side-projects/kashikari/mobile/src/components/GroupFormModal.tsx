import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import GroupIconPicker from './GroupIconPicker';
import Mark from './Mark';
import PrimaryButton from './PrimaryButton';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

type Props = {
  visible: boolean;
  mode: 'create' | 'join';
  onClose: () => void;
  // join時はiconEmojiは常にnull(招待コードで参加する側はアイコンを選べない。
  // グループのアイコンは作成者が決め、参加者は後から見るだけ)。
  onSubmit: (value: string, iconEmoji: string | null) => Promise<{ error: string | null }>;
};

export default function GroupFormModal({ visible, mode, onClose, onSubmit }: Props) {
  const t = useT();
  const [value, setValue] = useState('');
  const [iconEmoji, setIconEmoji] = useState<string | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setValue('');
    setIconEmoji(null);
    setError(null);
    onClose();
  };

  const submit = async () => {
    setSubmitting(true);
    const res = await onSubmit(value, mode === 'create' ? iconEmoji : null);
    setSubmitting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    close();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{mode === 'create' ? t.groupForm.createTitle : t.groupForm.joinTitle}</Text>

          {mode === 'create' && (
            <Pressable onPress={() => setIconPickerOpen(true)} style={styles.iconRow}>
              <Mark size={44} glyph={iconEmoji ?? undefined} />
              <Text style={styles.iconRowText}>{iconEmoji ? t.groupForm.changeIcon : t.groupForm.pickIcon}</Text>
            </Pressable>
          )}

          <TextInput
            value={value}
            onChangeText={(v) => {
              setValue(mode === 'join' ? v.toUpperCase() : v);
              setError(null);
            }}
            placeholder={mode === 'create' ? t.groupForm.namePlaceholder : t.groupForm.codePlaceholder}
            placeholderTextColor={colors.muted}
            autoCapitalize={mode === 'join' ? 'characters' : 'none'}
            maxLength={mode === 'create' ? 30 : 6}
            style={styles.input}
            autoFocus
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.actions}>
            <PrimaryButton title={t.common.cancel} variant="ghost" onPress={close} />
            <PrimaryButton
              title={mode === 'create' ? t.groupForm.createButton : t.groupForm.joinButton}
              onPress={submit}
              loading={submitting}
              disabled={!value.trim()}
            />
          </View>
        </View>
      </View>

      {mode === 'create' && (
        <GroupIconPicker
          visible={iconPickerOpen}
          selected={iconEmoji}
          onSelect={(emoji) => {
            setIconEmoji(emoji);
            setIconPickerOpen(false);
          }}
          onClose={() => setIconPickerOpen(false)}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,15,10,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', backgroundColor: colors.surface, borderRadius: 18, padding: 20 },
  title: { ...fonts.display, fontSize: 19, color: colors.ink, marginBottom: 14 },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  iconRowText: { ...fonts.bodyMedium, fontSize: 13.5, color: colors.ink, flexShrink: 1 },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  error: { color: colors.danger, ...fonts.body, fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
});
