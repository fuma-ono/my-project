import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Entry, EntryType } from '../types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../categories';

type Props = {
  onSave: (entry: Entry) => void;
  onCancel: () => void;
};

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(date: string, deltaDays: number) {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export default function AddEntryScreen({ onSave, onCancel }: Props) {
  const [type, setType] = useState<EntryType>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [date, setDate] = useState(todayString());
  const [memo, setMemo] = useState('');

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  const selectType = (next: EntryType) => {
    setType(next);
    setCategory(next === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]);
  };

  const canSave = Number(amount) > 0;

  const save = () => {
    if (!canSave) return;
    onSave({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      amount: Number(amount),
      category,
      date,
      memo,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>記録する</Text>

      <View style={styles.typeRow}>
        <Pressable
          style={[styles.typeButton, type === 'expense' && styles.typeButtonExpenseActive]}
          onPress={() => selectType('expense')}
        >
          <Text style={[styles.typeButtonText, type === 'expense' && styles.typeButtonTextActive]}>支出</Text>
        </Pressable>
        <Pressable
          style={[styles.typeButton, type === 'income' && styles.typeButtonIncomeActive]}
          onPress={() => selectType('income')}
        >
          <Text style={[styles.typeButtonText, type === 'income' && styles.typeButtonTextActive]}>収入</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>金額</Text>
      <TextInput
        style={styles.amountInput}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor="#5a5a70"
        value={amount}
        onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, ''))}
      />

      <Text style={styles.label}>勘定科目</Text>
      <View style={styles.chipRow}>
        {categories.map((c) => (
          <Pressable
            key={c}
            style={[styles.chip, category === c && styles.chipActive]}
            onPress={() => setCategory(c)}
          >
            <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>日付</Text>
      <View style={styles.dateRow}>
        <Pressable style={styles.dateStep} onPress={() => setDate(shiftDate(date, -1))}>
          <Text style={styles.dateStepText}>−1日</Text>
        </Pressable>
        <Text style={styles.dateText}>{date}</Text>
        <Pressable style={styles.dateStep} onPress={() => setDate(shiftDate(date, 1))}>
          <Text style={styles.dateStepText}>+1日</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>メモ(任意)</Text>
      <TextInput
        style={styles.memoInput}
        placeholder="例: クライアントとの打ち合わせ"
        placeholderTextColor="#5a5a70"
        value={memo}
        onChangeText={setMemo}
      />

      <Pressable style={[styles.saveButton, !canSave && styles.saveButtonDisabled]} onPress={save} disabled={!canSave}>
        <Text style={styles.saveButtonText}>保存する</Text>
      </Pressable>
      <Pressable onPress={onCancel}>
        <Text style={styles.cancel}>キャンセル</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0e1a' },
  content: { paddingTop: 64, paddingHorizontal: 20, paddingBottom: 60 },
  header: { color: 'white', fontSize: 22, fontWeight: '700', marginBottom: 24 },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  typeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  typeButtonExpenseActive: { backgroundColor: '#ff8a8a' },
  typeButtonIncomeActive: { backgroundColor: '#6fe3a0' },
  typeButtonText: { color: '#c8c8e0', fontWeight: '700' },
  typeButtonTextActive: { color: '#0b0e1a' },
  label: { color: '#9a9ab0', fontSize: 12, marginBottom: 8, marginTop: 4 },
  amountInput: {
    color: 'white',
    fontSize: 32,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: '#5b3df0' },
  chipText: { color: '#c8c8e0', fontSize: 13 },
  chipTextActive: { color: 'white', fontWeight: '700' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  dateStep: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  dateStepText: { color: '#d8d8ea', fontSize: 13 },
  dateText: { color: 'white', fontSize: 15, fontWeight: '600' },
  memoInput: {
    color: 'white',
    fontSize: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 28,
  },
  saveButton: { backgroundColor: '#5b3df0', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '700' },
  cancel: { color: '#9a9ab0', fontSize: 14, textAlign: 'center', marginTop: 20 },
});
