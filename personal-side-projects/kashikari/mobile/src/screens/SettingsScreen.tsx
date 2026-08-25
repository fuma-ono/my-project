import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import appJson from '../../app.json';
import Avatar from '../components/Avatar';
import AvatarPicker from '../components/AvatarPicker';
import PrimaryButton from '../components/PrimaryButton';
import { useLanguage } from '../i18n';
import type { Lang } from '../i18n';
import { colors, fonts } from '../theme';
import type { Profile } from '../types';

type Props = {
  profile: Profile;
  onBack: () => void;
  onChangeDisplayName: (name: string) => Promise<{ error: string | null }>;
  onChangeAvatar: (emoji: string) => Promise<{ error: string | null }>;
};

export default function SettingsScreen({ profile, onBack, onChangeDisplayName, onChangeAvatar }: Props) {
  const { lang, setLang, t } = useLanguage();
  const [name, setName] = useState(profile.display_name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  const nameDirty = name.trim() !== profile.display_name && name.trim().length > 0;

  const saveName = async () => {
    setSaving(true);
    setSavedNote(false);
    const res = await onChangeDisplayName(name);
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
          <Pressable onPress={onBack} hitSlop={10}>
            <Text style={styles.back}>{t.settings.back}</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>{t.settings.title}</Text>

        <Text style={styles.sectionLabel}>{t.settings.language}</Text>
        <View style={styles.langRow}>
          <LangButton label={t.settings.languageJa} active={lang === 'ja'} onPress={() => setLang('ja')} />
          <LangButton label={t.settings.languageEn} active={lang === 'en'} onPress={() => setLang('en')} />
        </View>

        <Text style={styles.sectionLabel}>{t.settings.icon}</Text>
        <Pressable onPress={() => setAvatarPickerOpen(true)} style={styles.iconRow}>
          <Avatar name={profile.display_name} emoji={profile.avatar_emoji} size="md" />
          <Text style={styles.iconRowText}>{profile.avatar_emoji ? t.onboarding.changeIcon : t.onboarding.pickIcon}</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>{t.settings.displayName}</Text>
        <TextInput
          value={name}
          onChangeText={(v) => {
            setName(v);
            setNameError(null);
            setSavedNote(false);
          }}
          placeholder={t.settings.displayNamePlaceholder}
          placeholderTextColor={colors.muted}
          maxLength={20}
          style={styles.input}
        />
        {nameError && <Text style={styles.error}>{nameError}</Text>}
        {savedNote && !nameError && <Text style={styles.savedNote}>{t.settings.savedNote}</Text>}
        <PrimaryButton title={t.common.save} onPress={saveName} loading={saving} disabled={!nameDirty} style={styles.saveButton} />

        <Text style={styles.sectionLabel}>{t.settings.about}</Text>
        <Text style={styles.aboutText}>kashikari</Text>
        <Text style={styles.aboutVersion}>{t.settings.version(appJson.expo.version)}</Text>
      </ScrollView>

      <AvatarPicker
        visible={avatarPickerOpen}
        name={profile.display_name}
        selected={profile.avatar_emoji}
        onSelect={async (emoji) => {
          setAvatarPickerOpen(false);
          await onChangeAvatar(emoji);
        }}
        onClose={() => setAvatarPickerOpen(false)}
      />
    </View>
  );
}

function LangButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.langBtn, active && styles.langBtnActive]}>
      <Text style={[styles.langBtnText, active && styles.langBtnTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  headerRow: { marginBottom: 4 },
  back: { ...fonts.bodySemiBold, fontSize: 15, color: colors.accent },
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
  langRow: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: 12, padding: 4, gap: 4 },
  langBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  langBtnActive: {
    backgroundColor: colors.surface,
    shadowColor: '#3c2814',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  langBtnText: { ...fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  langBtnTextActive: { color: colors.ink },
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
  aboutText: { ...fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  aboutVersion: { ...fonts.body, fontSize: 13, color: colors.muted, marginTop: 4 },
});
