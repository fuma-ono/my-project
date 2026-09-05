import { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import PrimaryButton from './PrimaryButton';
import { useT } from '../i18n';
import { CURRENCIES } from '../lib/currency';
import { colors, fonts } from '../theme';
import { useReceiptUrl } from '../hooks/useReceiptUrl';
import type { Entry } from '../types';

type Props = {
  visible: boolean;
  entry: Entry | null;
  onClose: () => void;
  onSubmit: (
    entry: Entry,
    input: { amount: number | null; currency: string | null; description: string; photoUri?: string | null; removePhoto?: boolean }
  ) => Promise<{ error: string | null }>;
};

// 記録の内容(金額・通貨・メモ・レシート)を編集する画面。誰から誰へ・
// 種類(お金/頼みごと)はAddEntrySheetと違い変更できない(残高計算・
// 割り勘の前提が崩れるため。開き直す=削除して作り直すことでしか
// 変えられない)。フォームの見た目・文言はAddEntrySheetをできるだけ
// 踏襲している。
export default function EditEntrySheet({ visible, entry, onClose, onSubmit }: Props) {
  const t = useT();
  const isMoney = entry?.type === 'money';
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('JPY');
  const [desc, setDesc] = useState('');
  // 新しく選び直した写真(アップロード対象)。nullのままなら既存の
  // レシートを維持、photoRemoved=trueなら既存のレシートを外す。
  const [newPhotoUri, setNewPhotoUri] = useState<string | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const existingPhotoUrl = useReceiptUrl(entry?.photo_path ?? null);

  // entryが変わる(=開き直す)たびにフォームを初期値に戻す。
  useEffect(() => {
    if (!entry) return;
    setAmount(entry.amount != null ? String(entry.amount) : '');
    setCurrency(entry.currency ?? 'JPY');
    setDesc(entry.description ?? '');
    setNewPhotoUri(null);
    setPhotoRemoved(false);
  }, [entry]);

  if (!entry) return null;

  const displayPhotoUri = newPhotoUri ?? (photoRemoved ? null : existingPhotoUrl);

  const pickPhoto = () => {
    Alert.alert(t.addEntry.photoAlertTitle, undefined, [
      {
        text: t.addEntry.takePhoto,
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) return Alert.alert(t.addEntry.cameraPermissionDenied);
          const result = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
          if (!result.canceled) {
            setNewPhotoUri(result.assets[0].uri);
            setPhotoRemoved(false);
          }
        },
      },
      {
        text: t.addEntry.pickFromLibrary,
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) return Alert.alert(t.addEntry.libraryPermissionDenied);
          const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'] });
          if (!result.canceled) {
            setNewPhotoUri(result.assets[0].uri);
            setPhotoRemoved(false);
          }
        },
      },
      { text: t.common.cancel, style: 'cancel' },
    ]);
  };

  const removePhoto = () => {
    setNewPhotoUri(null);
    setPhotoRemoved(true);
  };

  const submit = async () => {
    if (isMoney) {
      const n = Number(amount);
      if (!n || n <= 0) {
        Alert.alert(t.addEntry.amountRequiredError);
        return;
      }
    }
    setSubmitting(true);
    const { error } = await onSubmit(entry, {
      amount: isMoney ? Number(amount) : null,
      currency: isMoney ? currency : null,
      description: desc.trim(),
      photoUri: newPhotoUri,
      removePhoto: photoRemoved,
    });
    setSubmitting(false);
    if (error) {
      Alert.alert(t.editEntry.submitFailedTitle, error);
      return;
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={styles.sheet} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t.editEntry.title}</Text>

        {isMoney && (
          <>
            <Text style={styles.label}>{t.addEntry.amountLabel}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.currencyRow}>
              {CURRENCIES.map((c) => (
                <Pressable
                  key={c.code}
                  onPress={() => setCurrency(c.code)}
                  style={[styles.currencyChip, currency === c.code && styles.currencyChipActive]}
                >
                  <Text style={[styles.currencyText, currency === c.code && { color: colors.accent }]}>{c.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder={t.addEntry.amountPlaceholder}
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </>
        )}

        <Text style={styles.label}>{t.addEntry.descriptionLabel}</Text>
        <TextInput
          value={desc}
          onChangeText={setDesc}
          placeholder={t.addEntry.descriptionPlaceholder}
          placeholderTextColor={colors.muted}
          maxLength={60}
          style={styles.input}
        />

        <Pressable onPress={pickPhoto} style={styles.photoBtn}>
          <Text style={styles.photoBtnText}>{t.addEntry.attachReceipt}</Text>
        </Pressable>
        {displayPhotoUri && (
          <View style={styles.photoPreviewWrap}>
            <Image source={{ uri: displayPhotoUri }} style={styles.photoPreview} />
            <Pressable onPress={removePhoto} style={styles.photoRemove}>
              <Text style={styles.photoRemoveText}>✕</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.actions}>
          <PrimaryButton title={t.common.cancel} variant="ghost" onPress={onClose} />
          <PrimaryButton title={t.editEntry.submit} onPress={submit} loading={submitting} />
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 8 },
  title: { ...fonts.display, fontSize: 22, color: colors.ink, marginBottom: 8 },
  label: { ...fonts.bodySemiBold, fontSize: 12.5, color: colors.muted, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  currencyRow: { flexDirection: 'row' },
  currencyChip: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, marginRight: 6 },
  currencyChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  currencyText: { ...fonts.displayMedium, fontSize: 13, color: colors.muted },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    ...fonts.body,
    fontSize: 15,
    color: colors.ink,
    marginTop: 6,
  },
  photoBtn: { backgroundColor: colors.favorSoft, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start', marginTop: 12 },
  photoBtnText: { ...fonts.bodySemiBold, fontSize: 13.5, color: colors.favor },
  photoPreviewWrap: { marginTop: 10 },
  photoPreview: { width: 64, height: 64, borderRadius: 12 },
  photoRemove: {
    position: 'absolute',
    top: -6,
    left: 52,
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: { color: colors.bg, fontSize: 11 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 24, marginBottom: 40 },
});
