import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useT } from '../i18n';
import {
  isAppleSignInAvailable,
  sendEmailCode,
  signInWithApple,
  signInWithGoogle,
  signInWithLine,
  verifyEmailCode,
  type AuthMode,
} from '../lib/socialAuth';
import { supabase } from '../lib/supabase';
import { colors, fonts } from '../theme';

type Props = {
  // 'link': 今の(匿名の)アカウントにログイン方法を後付けする(設定画面)。
  // 'signin': 別のアカウントとしてサインインし直す(オンボーディング、
  // 機種変更・再インストール後の復旧用)。
  mode: AuthMode;
  onDone: (message: string) => void;
};

// Google/Apple/LINE/メールでのログインをまとめた共通UI。設定画面
// (mode:'link')・オンボーディング(mode:'signin')の両方から使う。
export default function AuthMethods({ mode, onDone }: Props) {
  const t = useT();
  const [linkedProviders, setLinkedProviders] = useState<string[]>([]);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable);
    if (mode === 'link') {
      supabase.auth.getUserIdentities().then(({ data }) => {
        if (data) setLinkedProviders(data.identities.map((i) => i.provider));
      });
    }
  }, [mode]);

  const run = async (provider: string, action: () => Promise<{ error: string | null }>) => {
    setError(null);
    setBusyProvider(provider);
    const res = await action();
    setBusyProvider(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    onDone(mode === 'link' ? t.authMethods.linkSuccessToast : t.authMethods.signInSuccessToast);
  };

  const sendCode = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t.authMethods.emailRequiredError);
      return;
    }
    setError(null);
    setBusyProvider('email');
    const res = await sendEmailCode(trimmed, mode);
    setBusyProvider(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setCodeSentTo(trimmed);
  };

  const verifyCode = async () => {
    if (!codeSentTo) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setError(t.authMethods.codeRequiredError);
      return;
    }
    await run('email', () => verifyEmailCode(codeSentTo, trimmed, mode));
  };

  const isLinked = (provider: string) => mode === 'link' && linkedProviders.includes(provider);

  return (
    <View style={styles.wrap}>
      <View style={styles.buttons}>
        <ProviderButton
          icon="logo-google"
          label={t.authMethods.googleButton}
          linked={isLinked('google')}
          linkedLabel={t.authMethods.linkedBadge}
          busy={busyProvider === 'google'}
          onPress={() => run('google', () => signInWithGoogle(mode))}
        />
        {appleAvailable && (
          <ProviderButton
            icon="logo-apple"
            label={t.authMethods.appleButton}
            linked={isLinked('apple')}
            linkedLabel={t.authMethods.linkedBadge}
            busy={busyProvider === 'apple'}
            onPress={() => run('apple', () => signInWithApple(mode))}
          />
        )}
        <ProviderButton
          icon="chatbubble"
          iconColor="#06C755"
          label={t.authMethods.lineButton}
          linked={isLinked('custom:line')}
          linkedLabel={t.authMethods.linkedBadge}
          busy={busyProvider === 'custom:line'}
          onPress={() => run('custom:line', () => signInWithLine(mode))}
        />
      </View>

      <Text style={styles.emailLabel}>{t.authMethods.emailLabel}</Text>
      <View style={styles.emailRow}>
        <TextInput
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setError(null);
          }}
          placeholder={t.authMethods.emailPlaceholder}
          placeholderTextColor={colors.muted}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!codeSentTo}
          style={[styles.input, codeSentTo && styles.inputDisabled]}
        />
        {!codeSentTo && (
          <Pressable onPress={sendCode} style={styles.emailBtn} disabled={busyProvider === 'email'}>
            {busyProvider === 'email' ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.emailBtnText}>{t.authMethods.sendCodeButton}</Text>}
          </Pressable>
        )}
      </View>

      {codeSentTo && (
        <>
          <Text style={styles.codeSentNote}>{t.authMethods.codeSentNote(codeSentTo)}</Text>
          <Text style={styles.emailLabel}>{t.authMethods.codeLabel}</Text>
          <View style={styles.emailRow}>
            <TextInput
              value={code}
              onChangeText={(v) => {
                setCode(v);
                setError(null);
              }}
              placeholder={t.authMethods.codePlaceholder}
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={6}
              style={styles.input}
            />
            <Pressable onPress={verifyCode} style={styles.emailBtn} disabled={busyProvider === 'email'}>
              {busyProvider === 'email' ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.emailBtnText}>{t.authMethods.verifyButton}</Text>}
            </Pressable>
          </View>
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function ProviderButton({
  icon,
  iconColor,
  label,
  linked,
  linkedLabel,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  linked: boolean;
  linkedLabel: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={busy || linked} style={[styles.providerBtn, linked && styles.providerBtnLinked]}>
      <Ionicons name={icon} size={18} color={iconColor ?? colors.ink} />
      <Text style={styles.providerBtnText} numberOfLines={1}>
        {label}
      </Text>
      {busy ? (
        <ActivityIndicator size="small" color={colors.muted} style={styles.providerRight} />
      ) : linked ? (
        <View style={[styles.linkedBadge, styles.providerRight]}>
          <Text style={styles.linkedBadgeText}>{linkedLabel}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  buttons: { gap: 8 },
  providerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  providerBtnLinked: { opacity: 0.6 },
  providerBtnText: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink, flex: 1 },
  providerRight: { marginLeft: 'auto' },
  linkedBadge: { backgroundColor: colors.positiveSoft, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
  linkedBadgeText: { ...fonts.bodySemiBold, fontSize: 11, color: colors.positive },
  emailLabel: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
  },
  emailRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    // flexアイテムの初期値min-width:autoのせいで、狭い画面幅では
    // TextInputが縮まずに右のボタンごと画面外へはみ出す(react-native-web
    // 特有のflexboxの罠)。明示的にminWidth:0を指定して縮めるようにする。
    minWidth: 0,
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  inputDisabled: { opacity: 0.6 },
  emailBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16 },
  emailBtnText: { ...fonts.bodySemiBold, fontSize: 13.5, color: colors.accentInk },
  codeSentNote: { ...fonts.body, fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  error: { color: colors.danger, ...fonts.body, fontSize: 13 },
});
