import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import Avatar from '../components/Avatar';
import AuthMethods from '../components/AuthMethods';
import AvatarPicker from '../components/AvatarPicker';
import Mark from '../components/Mark';
import PrimaryButton from '../components/PrimaryButton';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

export default function OnboardingScreen({
  onSubmit,
  authError,
}: {
  onSubmit: (name: string, avatarEmoji: string | null) => Promise<{ error: string | null }>;
  // 匿名サインイン自体が失敗している場合のエラー(例: Supabase側で
  // Anonymous Sign-Insが無効になっている)。以前は「はじめる」を押すまで
  // 一切表示されず、ユーザーが原因不明のまま「未認証です」に遭遇していた。
  authError?: string | null;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 「機種変更・再インストールでアカウントを失う」問題への対応。以前
  // ログイン方法を追加したことがある人は、新規登録フォームの代わりに
  // ここからサインインし直せる(成功すると、useAuth側のセッション監視が
  // 自動的にプロフィールを読み込み、この画面自体が自動的に切り替わる)。
  const [showSignIn, setShowSignIn] = useState(false);
  const [signInNote, setSignInNote] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    const res = await onSubmit(name, avatarEmoji);
    setSubmitting(false);
    if (res.error) setError(res.error);
  };

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <View style={styles.markWrap}>
          <Mark size={64} />
        </View>
        <Text style={styles.wordmark}>kashikari</Text>
        <Text style={styles.tagline}>{t.onboarding.tagline}</Text>

        {authError && (
          <View style={styles.authErrorBox}>
            <Text style={styles.authErrorTitle}>{t.onboarding.signInFailedTitle}</Text>
            <Text style={styles.authErrorBody}>{authError}</Text>
            <Text style={styles.authErrorHint}>{t.onboarding.signInFailedHint}</Text>
          </View>
        )}

        {showSignIn ? (
          <>
            <Text style={styles.label}>{t.authMethods.signInTitle}</Text>
            <Text style={styles.signInDescription}>{t.authMethods.signInDescription}</Text>
            <AuthMethods mode="signin" onDone={setSignInNote} />
            {signInNote && <Text style={styles.signInNote}>{signInNote}</Text>}
            <Pressable onPress={() => setShowSignIn(false)} style={styles.switchLink}>
              <Text style={styles.switchLinkText}>{t.authMethods.switchToSignUp}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.label}>{t.onboarding.nameLabel}</Text>
            <TextInput
              value={name}
              onChangeText={(v) => {
                setName(v);
                setError(null);
              }}
              placeholder={t.onboarding.namePlaceholder}
              placeholderTextColor={colors.muted}
              maxLength={20}
              style={styles.input}
              autoFocus
            />

            <Text style={styles.label}>{t.onboarding.iconLabel}</Text>
            <Pressable onPress={() => setPickerOpen(true)} style={styles.avatarRow}>
              <Avatar name={name || '?'} emoji={avatarEmoji} size="md" />
              <Text style={styles.avatarRowText}>{avatarEmoji ? t.onboarding.changeIcon : t.onboarding.pickIcon}</Text>
            </Pressable>

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable onPress={() => setShowSignIn(true)} style={styles.switchLink}>
              <Text style={styles.switchLinkText}>{t.authMethods.switchToSignIn}</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* 内容のすぐ下に小さく左寄せで浮かせるのではなく、幅いっぱいのCTAにする。
          ただし画面の一番下端まで押し下げると逆に遠すぎたため、内容から
          一定の余白を空けた位置に置く(flex:1で下端に固定、はしない)。
          サインインモードのときは、新規登録用のこのボタン自体を隠す。 */}
      {!showSignIn && (
        <PrimaryButton title={t.onboarding.start} onPress={submit} loading={submitting} disabled={!name.trim()} style={styles.button} />
      )}

      <AvatarPicker
        visible={pickerOpen}
        name={name || '?'}
        selected={avatarEmoji}
        onSelect={(e) => {
          setAvatarEmoji(e);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, paddingTop: 60, paddingHorizontal: 24, paddingBottom: 40 },
  content: { marginBottom: 36 },
  markWrap: { marginBottom: 16 },
  wordmark: { ...fonts.display, fontSize: 38, color: colors.ink },
  tagline: { ...fonts.body, fontSize: 14.5, color: colors.muted, marginTop: 8, marginBottom: 32 },
  label: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    ...fonts.body,
    fontSize: 17,
    color: colors.ink,
    borderWidth: 1.5,
    borderColor: colors.line,
    marginBottom: 20,
  },
  avatarRow: {
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
  avatarRowText: { ...fonts.bodyMedium, fontSize: 14, color: colors.ink, flexShrink: 1 },
  error: { color: colors.danger, ...fonts.body, fontSize: 13, marginTop: 8 },
  signInDescription: { ...fonts.body, fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 14 },
  signInNote: { ...fonts.bodyMedium, fontSize: 13, color: colors.positive, marginTop: 10 },
  switchLink: { marginTop: 16, alignSelf: 'flex-start' },
  switchLinkText: { ...fonts.bodySemiBold, fontSize: 13.5, color: colors.accent },
  authErrorBox: {
    backgroundColor: colors.danger + '14',
    borderWidth: 1,
    borderColor: colors.danger + '40',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
  },
  authErrorTitle: { ...fonts.bodySemiBold, fontSize: 14, color: colors.danger },
  authErrorBody: { ...fonts.body, fontSize: 13, color: colors.danger, marginTop: 4 },
  authErrorHint: { ...fonts.body, fontSize: 12.5, color: colors.muted, marginTop: 8, lineHeight: 18 },
  button: { width: '100%' },
});
