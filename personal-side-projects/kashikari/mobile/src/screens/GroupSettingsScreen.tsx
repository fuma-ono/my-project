import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import GroupIconPicker from '../components/GroupIconPicker';
import Mark from '../components/Mark';
import PrimaryButton from '../components/PrimaryButton';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';
import type { Group } from '../types';

// 「グループ内の設定ボタンを押したら、グループの設定(アイコンやグループ名
// など)を変更できるようにした方がいい」という指摘への対応(86回目)。
// 以前はグループ詳細画面の歯車アイコンから個人設定(SettingsScreen、
// 言語・自分のアイコン・ログイン方法・ログアウトなど)を開いていたが、
// 今どのグループを見ているかに関係のない個人設定がここに出るのは
// 分かりにくいという指摘を受け、この専用画面(アイコン・グループ名のみ)
// に差し替えた。個人設定はホーム画面の歯車から引き続き開ける。
//
// グループアイコンの変更自体は以前、グループ詳細画面のヘッダーで
// グループ名をタップすると開く形になっていたが、この画面に一本化する
// ため撤去した(入り口が2つあると分かりにくいため)。
type Props = {
  group: Group;
  onBack: () => void;
  onChangeName: (name: string) => Promise<{ error: string | null }>;
  onChangeIcon: (emoji: string) => Promise<{ error: string | null }>;
  // デモモードでは実際のアップロードができないため渡されない
  // (渡されない場合はGroupIconPicker側で「写真から選ぶ」ボタン自体を出さない)。
  onChangeIconPhoto?: (uri: string) => Promise<{ error: string | null }>;
};

export default function GroupSettingsScreen({ group, onBack, onChangeName, onChangeIcon, onChangeIconPhoto }: Props) {
  const t = useT();
  const [name, setName] = useState(group.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const nameDirty = name.trim() !== group.name && name.trim().length > 0;

  const saveName = async () => {
    setSaving(true);
    setSavedNote(false);
    const res = await onChangeName(name);
    setSaving(false);
    if (res.error) {
      setNameError(res.error);
      return;
    }
    setNameError(null);
    setSavedNote(true);
  };

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t.groupSettings.back}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
        </View>
        <Text style={styles.title}>{t.groupSettings.title}</Text>

        <Text style={styles.sectionLabel}>{t.groupSettings.icon}</Text>
        <Pressable onPress={() => setIconPickerOpen(true)} style={styles.iconRow}>
          <Mark size={48} glyph={group.icon_emoji ?? undefined} photoPath={group.icon_photo_path} />
          <Text style={styles.iconRowText}>{t.groupForm.changeIcon}</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>{t.groupSettings.name}</Text>
        <TextInput
          value={name}
          onChangeText={(v) => {
            setName(v);
            setNameError(null);
            setSavedNote(false);
          }}
          placeholder={t.groupSettings.namePlaceholder}
          placeholderTextColor={colors.muted}
          maxLength={30}
          style={styles.input}
        />
        {nameError && <Text style={styles.error}>{nameError}</Text>}
        {savedNote && !nameError && <Text style={styles.savedNote}>{t.groupSettings.savedNote}</Text>}
        <PrimaryButton title={t.common.save} onPress={saveName} loading={saving} disabled={!nameDirty} style={styles.saveButton} />
      </ScrollView>

      <GroupIconPicker
        visible={iconPickerOpen}
        selected={group.icon_emoji}
        onSelect={async (emoji) => {
          setIconPickerOpen(false);
          await onChangeIcon(emoji);
        }}
        onSelectPhoto={
          onChangeIconPhoto &&
          (async (uri) => {
            setIconPickerOpen(false);
            await onChangeIconPhoto(uri);
          })
        }
        onClose={() => setIconPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  headerRow: { marginBottom: 4 },
  title: { ...fonts.display, fontSize: 26, color: colors.ink, marginTop: 4, marginBottom: 20 },
  sectionLabel: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 24,
    marginBottom: 10,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  iconRowText: { ...fonts.bodyMedium, fontSize: 14, color: colors.ink, flexShrink: 1 },
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
  savedNote: { color: colors.positive, ...fonts.body, fontSize: 13, marginTop: 8 },
  saveButton: { marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 28 },
});
