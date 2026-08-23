import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import Mark from '../components/Mark';
import PrimaryButton from '../components/PrimaryButton';
import { colors, fonts } from '../theme';

export default function OnboardingScreen({
  onSubmit,
}: {
  onSubmit: (name: string) => Promise<{ error: string | null }>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    const res = await onSubmit(name);
    setSubmitting(false);
    if (res.error) setError(res.error);
  };

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.markWrap}>
        <Mark size={64} />
      </View>
      <Text style={styles.wordmark}>kashikari</Text>
      <Text style={styles.tagline}>友達との貸し借りを、お金も頼みごとも一緒に記録する</Text>

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
      {error && <Text style={styles.error}>{error}</Text>}

      <PrimaryButton title="はじめる" onPress={submit} loading={submitting} disabled={!name.trim()} style={styles.button} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center' },
  markWrap: { marginBottom: 16 },
  wordmark: { fontFamily: fonts.display, fontSize: 38, color: colors.ink },
  tagline: { fontFamily: fonts.body, fontSize: 14.5, color: colors.muted, marginTop: 8, marginBottom: 32 },
  label: {
    fontFamily: fonts.bodySemiBold,
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
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.ink,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: 13, marginTop: 8 },
  button: { marginTop: 24, alignSelf: 'flex-start', paddingHorizontal: 28 },
});
