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
    Alert.alert('レシートを添付', undefined, [
      {
        text: 'カメラで撮る',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) return Alert.alert('カメラへのアクセスが許可されていません');
          const result = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
          if (!result.canceled) setPhotoUri(result.assets[0].uri);
        },
      },
      {
        text: 'アルバムから選ぶ',
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) return Alert.alert('写真へのアクセスが許可されていません');
          const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'] });
          if (!result.canceled) setPhotoUri(result.assets[0].uri);
        },
      },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  };

  const submit = async () => {
    if (!fromId || !toId || fromId === toId) {
      Alert.alert('貸した人と借りた人は別のメンバーを選んでください');
      return;
    }
    if (type === 'money') {
      const n = Number(amount);
      if (!n || n <= 0) {
        Alert.alert('金額を入力してください');
        return;
      }
    } else if (!desc.trim()) {
      Alert.alert('頼みごとの内容を入力してください', '例: 引っ越し手伝った');
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
      Alert.alert('記録できませんでした', error);
      return;
    }
    close();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <ScrollView style={styles.sheet} contentContainerStyle={styles.content}>
        <Text style={styles.title}>貸し借りを記録</Text>

        <Text style={styles.label}>誰から誰へ</Text>
        <View style={styles.pickerRow}>
          <PersonPicker members={members} selectedId={fromId} onSelect={setFromId} />
          <Text style={styles.arrow}>→</Text>
          <PersonPicker members={members} selectedId={toId} onSelect={setToId} />
        </View>

        <Text style={styles.label}>種類</Text>
        <View style={styles.typeToggle}>
          <Pressable
            onPress={() => setType('money')}
            style={[styles.typeBtn, type === 'money' && styles.typeBtnActiveMoney]}
          >
            <Text style={[styles.typeText, type === 'money' && { color: colors.accent }]}>💰 お金</Text>
          </Pressable>
          <Pressable
            onPress={() => setType('favor')}
            style={[styles.typeBtn, type === 'favor' && styles.typeBtnActiveFavor]}
          >
            <Text style={[styles.typeText, type === 'favor' && { color: colors.favor }]}>🤝 頼みごと</Text>
          </Pressable>
        </View>

        {type === 'money' && (
          <>
            <Text style={styles.label}>金額</Text>
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
              placeholder="金額"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </>
        )}

        <Text style={styles.label}>内容</Text>
        <TextInput
          value={desc}
          onChangeText={setDesc}
          placeholder="例: ラーメン奢った / 引っ越し手伝った"
          placeholderTextColor={colors.muted}
          maxLength={60}
          style={styles.input}
        />

        <Pressable onPress={pickPhoto} style={styles.photoBtn}>
          <Text style={styles.photoBtnText}>📷 レシートを撮る/添付</Text>
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
          <PrimaryButton title="キャンセル" variant="ghost" onPress={close} />
          <PrimaryButton title="記録する" onPress={submit} loading={submitting} />
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
  const selected = members.find((m) => m.id === selectedId);
  const open = () => {
    Alert.alert(
      '選ぶ',
      undefined,
      members.map((m) => ({ text: m.display_name, onPress: () => onSelect(m.id) })).concat([{ text: 'キャンセル', style: 'cancel' } as any])
    );
  };
  return (
    <Pressable onPress={open} style={styles.personPicker}>
      {selected && <Avatar name={selected.display_name} size="sm" />}
      <Text style={styles.personName} numberOfLines={1}>
        {selected?.display_name ?? '選択'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 8 },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.ink, marginBottom: 8 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 12.5, color: colors.muted, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
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
  personName: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink, flexShrink: 1 },
  arrow: { color: colors.muted, fontSize: 16 },
  typeToggle: { flexDirection: 'row', gap: 8 },
  typeBtn: { flex: 1, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  typeBtnActiveMoney: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  typeBtnActiveFavor: { borderColor: colors.favor, backgroundColor: colors.favorSoft },
  typeText: { fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: colors.muted },
  currencyRow: { flexDirection: 'row' },
  currencyChip: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, marginRight: 6 },
  currencyChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  currencyText: { fontFamily: fonts.displayMedium, fontSize: 13, color: colors.muted },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    marginTop: 6,
  },
  photoBtn: { backgroundColor: colors.favorSoft, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start', marginTop: 12 },
  photoBtnText: { fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: colors.favor },
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
