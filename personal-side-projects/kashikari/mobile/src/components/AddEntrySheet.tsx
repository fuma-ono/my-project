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
import { CURRENCIES, formatMoney } from '../lib/currency';
import { colors, fonts } from '../theme';
import type { EntryType, Profile } from '../types';

type Mode = EntryType | 'split';

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
  onSubmitSplit: (input: {
    payer: string;
    participantIds: string[];
    totalAmount: number;
    currency: string;
    description: string;
    photoUri: string | null;
  }) => Promise<{ error: string | null }>;
};

export default function AddEntrySheet({ visible, members, meId, onClose, onSubmit, onSubmitSplit }: Props) {
  const t = useT();
  const others = members.filter((m) => m.id !== meId);
  const [fromId, setFromId] = useState<string | null>(meId ?? members[0]?.id ?? null);
  const [toId, setToId] = useState<string | null>(others[0]?.id ?? members[1]?.id ?? null);
  const [mode, setMode] = useState<Mode>('money');
  const [currency, setCurrency] = useState('JPY');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [payerId, setPayerId] = useState<string | null>(meId ?? members[0]?.id ?? null);
  const [participantIds, setParticipantIds] = useState<string[]>(members.map((m) => m.id));

  const reset = () => {
    setFromId(meId ?? members[0]?.id ?? null);
    setToId(others[0]?.id ?? members[1]?.id ?? null);
    setMode('money');
    setCurrency('JPY');
    setAmount('');
    setDesc('');
    setPhotoUri(null);
    setPayerId(meId ?? members[0]?.id ?? null);
    setParticipantIds(members.map((m) => m.id));
  };

  const close = () => {
    reset();
    onClose();
  };

  const toggleParticipant = (id: string) => {
    setParticipantIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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

  const submitSplit = async () => {
    const n = Number(amount);
    if (!n || n <= 0) {
      Alert.alert(t.addEntry.amountRequiredError);
      return;
    }
    if (!payerId) {
      Alert.alert(t.addEntry.differentPeopleError);
      return;
    }
    if (participantIds.filter((id) => id !== payerId).length === 0) {
      Alert.alert(t.addEntry.splitNeedOthersError);
      return;
    }
    setSubmitting(true);
    const { error } = await onSubmitSplit({
      payer: payerId,
      participantIds,
      totalAmount: n,
      currency,
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

  const submit = async () => {
    if (mode === 'split') return submitSplit();

    if (!fromId || !toId || fromId === toId) {
      Alert.alert(t.addEntry.differentPeopleError);
      return;
    }
    if (mode === 'money') {
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
      type: mode,
      amount: mode === 'money' ? Number(amount) : null,
      currency: mode === 'money' ? currency : null,
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

  const perPersonShare = participantIds.length > 0 ? (Number(amount) || 0) / participantIds.length : 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <ScrollView style={styles.sheet} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{mode === 'split' ? t.addEntry.splitTitle : t.addEntry.title}</Text>

        <Text style={styles.label}>{t.addEntry.type}</Text>
        <View style={styles.typeToggle}>
          <Pressable onPress={() => setMode('money')} style={[styles.typeBtn, mode === 'money' && styles.typeBtnActiveMoney]}>
            <Text style={[styles.typeText, mode === 'money' && { color: colors.accent }]}>{t.addEntry.moneyType}</Text>
          </Pressable>
          <Pressable onPress={() => setMode('favor')} style={[styles.typeBtn, mode === 'favor' && styles.typeBtnActiveFavor]}>
            <Text style={[styles.typeText, mode === 'favor' && { color: colors.favor }]}>{t.addEntry.favorType}</Text>
          </Pressable>
          <Pressable onPress={() => setMode('split')} style={[styles.typeBtn, mode === 'split' && styles.typeBtnActiveMoney]}>
            <Text style={[styles.typeText, mode === 'split' && { color: colors.accent }]}>{t.addEntry.splitType}</Text>
          </Pressable>
        </View>

        {mode !== 'split' && (
          <>
            <Text style={styles.label}>{t.addEntry.fromTo}</Text>
            <View style={styles.pickerRow}>
              <PersonPicker members={members} selectedId={fromId} onSelect={setFromId} />
              <Text style={styles.arrow}>→</Text>
              <PersonPicker members={members} selectedId={toId} onSelect={setToId} />
            </View>
          </>
        )}

        {mode === 'split' && (
          <>
            <Text style={styles.label}>{t.addEntry.splitPayerLabel}</Text>
            <PersonPicker members={members} selectedId={payerId} onSelect={setPayerId} />
          </>
        )}

        {(mode === 'money' || mode === 'split') && (
          <>
            <Text style={styles.label}>{mode === 'split' ? t.addEntry.splitTotalLabel : t.addEntry.amountLabel}</Text>
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

        {mode === 'split' && (
          <>
            <Text style={styles.label}>{t.addEntry.splitParticipantsLabel}</Text>
            <View style={styles.participantList}>
              {members.map((m) => {
                const checked = participantIds.includes(m.id);
                return (
                  <Pressable key={m.id} onPress={() => toggleParticipant(m.id)} style={styles.participantRow}>
                    <Avatar name={m.display_name} emoji={m.avatar_emoji} size="sm" />
                    <Text style={styles.participantName}>{m.display_name}</Text>
                    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                      {checked && <Text style={styles.checkboxMark}>✓</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {!!Number(amount) && participantIds.length > 0 && (
              <Text style={styles.splitHint}>{t.addEntry.splitPerPersonHint(formatMoney(perPersonShare, currency))}</Text>
            )}
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
  participantList: { gap: 6 },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  participantName: { ...fonts.bodyMedium, fontSize: 14, color: colors.ink, flex: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkboxMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  splitHint: { ...fonts.body, fontSize: 12.5, color: colors.muted, marginTop: 8 },
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
