import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import Avatar from '../components/Avatar';
import AvatarPicker from '../components/AvatarPicker';
import Mark from '../components/Mark';
import PrimaryButton from '../components/PrimaryButton';
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
  const [name, setName] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        <Text style={styles.tagline}>友達との貸し借りを、お金も頼みごとも一緒に記録する</Text>

        {authError && (
          <View style={styles.authErrorBox}>
            <Text style={styles.authErrorTitle}>サインインに失敗しました</Text>
            <Text style={styles.authErrorBody}>{authError}</Text>
            <Text style={styles.authErrorHint}>
              Supabaseの管理画面で Authentication {'>'} Providers {'>'} Anonymous Sign-Ins が有効になっているか確認してください。
            </Text>
          </View>
        )}

        <Text style={styles.label}>あなたの名前</Text>
        <TextInput
          value={name}
          onChangeText={(t) => {
            setName(t);
            setError(null);
          }}
          placeholder="例: たろう"
          placeholderTextColor={colors.muted}
          maxLength={20}
          style={styles.input}
          autoFocus
        />

        <Text style={styles.label}>アイコン</Text>
        <Pressable onPress={() => setPickerOpen(true)} style={styles.avatarRow}>
          <Avatar name={name || '?'} emoji={avatarEmoji} size="md" />
          <Text style={styles.avatarRowText}>{avatarEmoji ? 'アイコンを変える' : 'アイコンを選ぶ(あとで変更できます)'}</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      {/* 内容のすぐ下に小さく左寄せで浮かせるのではなく、幅いっぱいのCTAにする。
          ただし画面の一番下端まで押し下げると逆に遠すぎたため、内容から
          一定の余白を空けた位置に置く(flex:1で下端に固定、はしない)。 */}
      <PrimaryButton title="はじめる" onPress={submit} loading={submitting} disabled={!name.trim()} style={styles.button} />

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
