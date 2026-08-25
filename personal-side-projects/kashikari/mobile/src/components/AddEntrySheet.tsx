import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import Avatar from './Avatar';
import PrimaryButton from './PrimaryButton';
import { useT } from '../i18n';
import { CURRENCIES } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { EntryType, Profile } from '../types';

type Props = {
  visible: boolean;
  members: Profile[];
  meId: string | null;
  onClose: () => void;
  onSubmit: (input: {
    fromUser: string;
    toUser: string;
    type: EntryType;
    amount: number | null;
    currency: string | null;
    description: string;
    photoUri: string | null;
  }) => Promise<{ error: string | null }>;
};

export default function AddEntrySheet({ visible, members, meId, onClose, onSubmit }: Props) {
  const t = useT();
  const others = members.filter((m) => m.id !== meId);
  const [fromId, setFromId] = useState<string | null>(meId ?? members[0]?.id ?? null);
  const [toId, setToId] = useState<string | null>(others[0]?.id ?? members[1]?.id ?? null);
  const [type, setType] = useState<EntryType>('money');
  const [currency, setCurrency] = useState('JPY');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setFromId(meId ?? members[0]?.id ?? null);
    setToId(others[0]?.id ?? members[1]?.id ?? null);
    setType('money');
    setCurrency('JPY');
    setAmount('');
    setDesc('');
    setPhotoUri(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const pickPhoto = () => {
    Alert.alert(t.addEntry.photoAlertTitle, undefined, [
      {
        text: t.addEntry.takePhoto,
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) return Alert.alert(t.addEntry.cameraPermissionDenied);
          const result = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
          if (!result.canceled) setPhotoUri(result.assets[0].uri);
        },
      },
      {
        text: t.addEntry.pickFromLibrary,
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) return Alert.alert(t.addEntry.libraryPermissionDenied);
          const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'] });
          if (!result.canceled) setPhotoUri(result.assets[0].uri);
        },
      },
      { text: t.common.cancel, style: 'cancel' },
    ]);
  };

  const submit = async () => {
    if (!fromId || !toId || fromId === toId) {
      Alert.alert(t.addEntry.differentPeopleError);
      return;
    }
    if (type === 'money') {
      const n = Number(amount);
      if (!n || n <= 0) {
        Alert.alert(t.addEntry.amountRequiredError);
        return;
      }
    } else if (!desc.trim()) {
      Alert.alert(t.addEntry.favorDescRequiredTitle, t.addEntry.favorDescRequiredMessage);
      return;
    }
    setSubmitting(true);
    const { error } = await onSubmit({
      fromUser: fromId,
      toUser: toId,
      type,
      amount: type === 'money' ? Number(amount) : null,
      currency: type === 'money' ? currency : null,
      description: desc.trim(),
      photoUri,
    });
    setSubmitting(false);
    if (error) {
      Alert.alert(t.addEntry.submitFailedTitle, error);
      return;
    }
    close();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <ScrollView style={styles.sheet} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t.addEntry.title}</Text>

        <Text style={styles.label}>{t.addEntry.fromTo}</Text>
        <View style={styles.pickerRow}>
          <PersonPicker members={members} selectedId={fromId} onSelect={setFromId} />
          <Text style={styles.arrow}>→</Text>
          <PersonPicker members={members} selectedId={toId} onSelect={setToId} />
        </View>

        <Text style={styles.label}>{t.addEntry.type}</Text>
        <View style={styles.typeToggle}>
          <Pressable
            onPress={() => setType('money')}
            style={[styles.typeBtn, type === 'money' && styles.typeBtnActiveMoney]}
          >
            <Text style={[styles.typeText, type === 'money' && { color: colors.accent }]}>{t.addEntry.moneyType}</Text>
          </Pressable>
          <Pressable
            onPress={() => setType('favor')}
            style={[styles.typeBtn, type === 'favor' && styles.typeBtnActiveFavor]}
          >
            <Text style={[styles.typeText, type === 'favor' && { color: colors.favor }]}>{t.addEntry.favorType}</Text>
          </Pressable>
        </View>

        {type === 'money' && (
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
        {photoUri && (
          <View style={styles.photoPreviewWrap}>
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            <Pressable onPress={() => setPhotoUri(null)} style={styles.photoRemove}>
              <Text style={styles.photoRemoveText}>✕</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.actions}>
          <PrimaryButton title={t.common.cancel} variant="ghost" onPress={close} />
          <PrimaryButton title={t.addEntry.submit} onPress={submit} loading={submitting} />
        </View>
      </ScrollView>
    </Modal>
  );
}

function PersonPicker({
  members,
  selectedId,
  onSelect,
}: {
  members: Profile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const selected = members.find((m) => m.id === selectedId);
  const open = () => {
    Alert.alert(
      t.addEntry.pickPersonTitle,
      undefined,
      members
        .map((m) => ({ text: m.avatar_emoji ? `${m.avatar_emoji} ${m.display_name}` : m.display_name, onPress: () => onSelect(m.id) }))
        .concat([{ text: t.common.cancel, style: 'cancel' } as any])
    );
  };
  return (
    <Pressable onPress={open} style={styles.personPicker}>
      {selected && <Avatar name={selected.display_name} emoji={selected.avatar_emoji} size="sm" />}
      <Text style={styles.personName} numberOfLines={1}>
        {selected?.display_name ?? t.addEntry.selectPlaceholder}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 8 },
  title: { ...fonts.display, fontSize: 22, color: colors.ink, marginBottom: 8 },
  label: { ...fonts.bodySemiBold, fontSize: 12.5, color: colors.muted, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  personPicker: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  personName: { ...fonts.bodyMedium, fontSize: 14, color: colors.ink, flexShrink: 1 },
  arrow: { color: colors.muted, fontSize: 16 },
  typeToggle: { flexDirection: 'row', gap: 8 },
  typeBtn: { flex: 1, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  typeBtnActiveMoney: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  typeBtnActiveFavor: { borderColor: colors.favor, backgroundColor: colors.favorSoft },
  typeText: { ...fonts.bodySemiBold, fontSize: 14.5, color: colors.muted },
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
