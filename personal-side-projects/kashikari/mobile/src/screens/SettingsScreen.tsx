import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import appJson from '../../app.json';
import Avatar from '../components/Avatar';
import AuthMethods from '../components/AuthMethods';
import AvatarPicker from '../components/AvatarPicker';
import FeedbackModal from '../components/FeedbackModal';
import PrimaryButton from '../components/PrimaryButton';
import Toast from '../components/Toast';
import { useLanguage } from '../i18n';
import type { Lang } from '../i18n';
import { hasLinkedIdentity } from '../lib/socialAuth';
import { colors, fonts } from '../theme';
import type { Profile } from '../types';

type Props = {
  profile: Profile;
  onBack: () => void;
  onChangeDisplayName: (name: string) => Promise<{ error: string | null }>;
  onChangeAvatar: (emoji: string) => Promise<{ error: string | null }>;
  // 「アイコンで自分の写真を使えるようにしてほしい」への対応。デモモードでは
  // 実際のアップロードができないため渡されない(渡されない場合は
  // AvatarPicker側で「写真から選ぶ」ボタン自体を出さない)。
  onChangeAvatarPhoto?: (uri: string) => Promise<{ error: string | null }>;
  onOpenPremium: () => void;
  onOpenUsage: () => void;
  onOpenReport: () => void;
  // デモモードでは実際のSupabase認証が無い(全てローカルstate)ため、
  // 「アカウントを保護する」セクション自体を出さない。
  isDemo?: boolean;
  // 「ログアウト機能が付いてないのはおかしい」への対応。デモモードでは
  // 実際のセッションが無いため呼ばれない(渡されない)。
  onSignOut?: () => Promise<void>;
  // リリース運用の仕組み(99回目)。デモモードでは実際のuser_idが無い
  // ため渡されない(渡されない場合は行自体を出さない、他の項目と同じ方針)。
  onSubmitFeedback?: (message: string) => Promise<{ error: string | null }>;
};

export default function SettingsScreen({
  profile,
  onBack,
  onChangeDisplayName,
  onChangeAvatar,
  onChangeAvatarPhoto,
  onOpenPremium,
  onOpenUsage,
  onOpenReport,
  isDemo,
  onSignOut,
  onSubmitFeedback,
}: Props) {
  const { lang, setLang, t } = useLanguage();
  const [name, setName] = useState(profile.display_name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [authToastMessage, setAuthToastMessage] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const nameDirty = name.trim() !== profile.display_name && name.trim().length > 0;

  // 「通常のアプリの基本的要素なのになんでログアウトが無いのか」への対応。
  // Google/Apple/LINE/メールのいずれとも連携していない(=匿名のみの)
  // アカウントでログアウトすると、次に開いたときに作られる匿名アカウントは
  // 完全な別人扱いになり、今のグループのデータへ二度とアクセスできなく
  // なる。そのため連携の有無で警告文を出し分け、未連携の場合はより強い
  // 確認を挟む。
  const confirmLogout = async () => {
    if (!onSignOut) return;
    setLoggingOut(true);
    const linked = await hasLinkedIdentity();
    setLoggingOut(false);
    if (linked) {
      Alert.alert(t.settings.logoutConfirmTitle, t.settings.logoutConfirmMessage, [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.settings.logoutConfirmButton, style: 'destructive', onPress: onSignOut },
      ]);
    } else {
      Alert.alert(t.settings.logoutUnsafeTitle, t.settings.logoutUnsafeMessage, [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.settings.logoutUnsafeButton, style: 'destructive', onPress: onSignOut },
      ]);
    }
  };

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
          {/* グループ画面の「‹」アイコンに合わせて、テキストの矢印
              ("‹ 戻る")からIonicons(chevron-back)に統一した。 */}
          <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t.settings.back}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
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
          <Avatar name={profile.display_name} emoji={profile.avatar_emoji} photoPath={profile.avatar_photo_path} size="md" />
          <Text style={styles.iconRowText}>{profile.avatar_emoji || profile.avatar_photo_path ? t.onboarding.changeIcon : t.onboarding.pickIcon}</Text>
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

        {/* 「アカウントは今どう作られている？Google/Apple/LINE/メールで
            ログインできるようにした方がいい」という提案への対応。今は
            端末に紐づく匿名アカウントしか無く、機種変更等でグループ
            データに二度とアクセスできなくなるリスクがあるため、ここで
            ログイン方法を後付けできるようにした(デモモードには実際の
            認証が無いため出さない)。 */}
        {!isDemo && (
          <>
            <Text style={styles.sectionLabel}>{t.authMethods.protectTitle}</Text>
            <Text style={styles.authDescription}>{t.authMethods.protectDescription}</Text>
            <AuthMethods mode="link" onDone={setAuthToastMessage} />
          </>
        )}

        <Pressable onPress={onOpenPremium} style={styles.premiumRow}>
          <Text style={styles.premiumRowText}>{t.settings.premiumRow}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>

        {/* 会計レポート(96回目、Premium特典)。無課金でも入り口自体は
            見せておき、中身の出し分けはReportScreen側で行う。 */}
        <Pressable onPress={onOpenReport} style={[styles.premiumRow, styles.usageRow]}>
          <Text style={styles.usageRowText}>{t.settings.reportRow}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>

        <Pressable onPress={onOpenUsage} style={[styles.premiumRow, styles.usageRow]}>
          <Text style={styles.usageRowText}>{t.settings.usageRow}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>

        {onSubmitFeedback && (
          <Pressable onPress={() => setFeedbackOpen(true)} style={[styles.premiumRow, styles.usageRow]}>
            <Text style={styles.usageRowText}>{t.settings.feedbackRow}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        )}

        <Text style={styles.sectionLabel}>{t.settings.about}</Text>
        <Text style={styles.aboutText}>kashikari</Text>
        <Text style={styles.aboutVersion}>{t.settings.version(appJson.expo.version)}</Text>

        {!isDemo && onSignOut && (
          <Pressable onPress={confirmLogout} disabled={loggingOut} style={styles.logoutRow}>
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.logoutRowText}>{t.settings.logoutRow}</Text>
          </Pressable>
        )}
      </ScrollView>

      <AvatarPicker
        visible={avatarPickerOpen}
        name={profile.display_name}
        selected={profile.avatar_emoji}
        onSelect={async (emoji) => {
          setAvatarPickerOpen(false);
          await onChangeAvatar(emoji);
        }}
        onSelectPhoto={
          onChangeAvatarPhoto &&
          (async (uri) => {
            setAvatarPickerOpen(false);
            await onChangeAvatarPhoto(uri);
          })
        }
        onClose={() => setAvatarPickerOpen(false)}
      />
      <Toast message={authToastMessage ?? ''} visible={authToastMessage !== null} onHide={() => setAuthToastMessage(null)} />
      {onSubmitFeedback && (
        <FeedbackModal visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} onSubmit={onSubmitFeedback} />
      )}
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
  authDescription: { ...fonts.body, fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 10 },
  savedNote: { color: colors.positive, ...fonts.body, fontSize: 13, marginTop: 8 },
  saveButton: { marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 28 },
  premiumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 28,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  premiumRowText: { ...fonts.bodySemiBold, fontSize: 15, color: colors.plum },
  usageRow: { marginTop: 10 },
  usageRowText: { ...fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  // 「最初のページのフォントと別のページのkashikariのフォントが違う」
  // という指摘への対応。ここだけfonts.bodySemiBold(通常の太字)を
  // 使っており、ワードマークとして使うべきfonts.display(ロゴ用の
  // 一番太いウェイト、Onboarding/Groups/Splashの各画面と共通)に
  // なっていなかった。
  aboutText: { ...fonts.display, fontSize: 17, color: colors.ink },
  aboutVersion: { ...fonts.body, fontSize: 13, color: colors.muted, marginTop: 4 },
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.danger + '40',
  },
  logoutRowText: { ...fonts.bodySemiBold, fontSize: 15, color: colors.danger },
});
