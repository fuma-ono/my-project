import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import Avatar from '../components/Avatar';
import AuthMethods from '../components/AuthMethods';
import AvatarPicker from '../components/AvatarPicker';
import Mark from '../components/Mark';
import PrimaryButton from '../components/PrimaryButton';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

// 「サインイン前提で作成してくれない?」という指摘への対応。以前は
// 匿名サインインが裏で自動的に済んでおり、Google/Apple/LINE/メールでの
// 連携は「あとから追加できる任意のおまけ」でしかなかった。今は
// useAuth側で匿名サインインを撤廃し、ここが本当の意味での必須の
// サインイン画面になる(スキップする手段は無い)。
// account(サインイン、必須)→name(名前・アイコン登録)の2画面構成。
// signInWithOAuth/signInWithIdToken/OTPはいずれも「既存アカウントなら
// ログイン、無ければ新規作成」を自動でやってくれるため、新規登録用と
// 復帰用の画面を分ける必要が無くなり、以前あった「既にアカウントを
// お持ちの方はこちら」の切り替えも不要になった。
type Step = 'account' | 'name';

export default function OnboardingScreen({
  onSubmit,
  authError,
}: {
  onSubmit: (name: string, avatarEmoji: string | null) => Promise<{ error: string | null }>;
  // プロフィール取得など、サインイン後に起きたエラー(通信エラー等)。
  authError?: string | null;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>('account');
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

        {step === 'account' ? (
          <>
            <Text style={styles.label}>{t.onboarding.accountStepTitle}</Text>
            <Text style={styles.signInDescription}>{t.onboarding.accountStepDescription}</Text>
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
