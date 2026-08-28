import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import Avatar from '../components/Avatar';
import AuthMethods from '../components/AuthMethods';
import AvatarPicker from '../components/AvatarPicker';
import LoginSheet from '../components/LoginSheet';
import Mark from '../components/Mark';
import PrimaryButton from '../components/PrimaryButton';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

// 「サインイン前提で作成してくれない?」への対応(45回目)でサインインを
// 必須にし、続けて「ボタンで選べるように、サインインとログインを
// 分けた方がよくない?」への対応(47回目)でwelcome画面を追加した。
// さらに「ログインの時はページではなく、ボタンを押したら下から
// ログイン項目が出てくる感じがいいんじゃないかな?」という指摘を受け、
// 「ログイン」は独立したページ(account相当)ではなく、下から出る
// シート(LoginSheet.tsx)に変更した。新規登録は名前・アイコン登録へと
// 続く「一連の流れ」なのでページ遷移のまま、ログインは(成功すれば
// それだけで完了する)単発の操作なのでシート、と使い分けている。
//
// welcome(「新しく始める」ボタン+「ログイン」リンク)→account(新規登録用の
// サインイン、ページ)→name(名前・アイコン登録)。ログインを選んだ場合は
// LoginSheetの中で完結し、成功すればApp.tsx側がprofile読み込み後に
// この画面自体を抜ける(新規のアカウントだった場合だけ、この画面に
// 残ったままnameステップへ進む)。
type Step = 'welcome' | 'account' | 'name';

export default function OnboardingScreen({
  onSubmit,
  authError,
}: {
  onSubmit: (name: string, avatarEmoji: string | null) => Promise<{ error: string | null }>;
  // プロフィール取得など、サインイン後に起きたエラー(通信エラー等)。
  authError?: string | null;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>('welcome');
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);
  const [name, setName] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
          </View>
        )}

        {step === 'welcome' && (
          <View style={styles.welcomeButtons}>
            <PrimaryButton title={t.onboarding.welcomeSignupButton} onPress={() => setStep('account')} style={styles.welcomeButton} />
            <Pressable onPress={() => setLoginSheetOpen(true)} style={styles.welcomeLoginButton}>
              <Text style={styles.welcomeLoginButtonText}>{t.onboarding.welcomeLoginButton}</Text>
            </Pressable>
          </View>
        )}

        {step === 'account' && (
          <>
            <Text style={styles.label}>{t.onboarding.accountStepTitleSignup}</Text>
            <Text style={styles.signInDescription}>{t.onboarding.accountStepDescriptionSignup}</Text>
            <AuthMethods
              mode="signin"
              onDone={(message) => {
                setSignInNote(message);
                // 名前が未登録(=新規サインアップ)の場合はuseAuth側で
                // profileがnullのままなので、App.tsx側は自動的にこの
                // コンポーネントをnameステップの状態に保つ…わけではなく、
                // ここは同じマウントを維持したままなので、明示的に
                // 次のステップへ進める。既存アカウントで名前登録済みの
                // 場合はApp.tsx側がprofile非nullを検知してこの画面自体を
                // 抜けるため、この行は実行されても実害は無い。
                setStep('name');
              }}
            />
            {signInNote && <Text style={styles.signInNote}>{signInNote}</Text>}
            <Pressable onPress={() => setStep('welcome')} style={styles.backLink} hitSlop={8}>
              <Ionicons name="chevron-back" size={16} color={colors.muted} />
              <Text style={styles.backLinkText}>{t.onboarding.backToWelcome}</Text>
            </Pressable>
          </>
        )}

        {step === 'name' && (
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
          </>
        )}
      </View>

      {/* 内容のすぐ下に小さく左寄せで浮かせるのではなく、幅いっぱいのCTAにする。
          ただし画面の一番下端まで押し下げると逆に遠すぎたため、内容から
          一定の余白を空けた位置に置く(flex:1で下端に固定、はしない)。
          名前ステップ以外では、この登録用ボタン自体を隠す。 */}
      {step === 'name' && (
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

      <LoginSheet
        visible={loginSheetOpen}
        onClose={() => setLoginSheetOpen(false)}
        onSignedIn={() => {
          setLoginSheetOpen(false);
          // ログインしたつもりが実は初めてのアカウントだった場合(=まだ
          // 名前未登録)、App.tsx側はprofileがnullのままこの画面を
          // 抜けないので、そのままnameステップに進めて名前を登録して
          // もらう。既存アカウントでログインできた場合はApp.tsx側が
          // profile読み込み後にこの画面自体を抜けるため無害。
          setStep('name');
        }}
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
  signInNote: { ...fonts.bodyMedium, fontSize: 13, color: colors.positive, marginTop: 16 },
  welcomeButtons: { gap: 12 },
  welcomeButton: { width: '100%' },
  welcomeLoginButton: {
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  welcomeLoginButtonText: { ...fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 16, alignSelf: 'flex-start' },
  backLinkText: { ...fonts.bodySemiBold, fontSize: 13.5, color: colors.muted },
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
  button: { width: '100%' },
});
