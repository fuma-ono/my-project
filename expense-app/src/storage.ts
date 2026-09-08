import AsyncStorage from '@react-native-async-storage/async-storage';
import { Entry } from './types';

const STORAGE_KEY = 'sakutto-keihi.entries.v1';

export async function loadEntries(): Promise<Entry[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Entry[];
    return parsed.sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch {
    return [];
  }
}

async function persist(entries: Entry[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export async function addEntry(entry: Entry): Promise<Entry[]> {
  const entries = await loadEntries();
  const next = [entry, ...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
  await persist(next);
  return next;
}

export async function deleteEntry(id: string): Promise<Entry[]> {
  const entries = await loadEntries();
  const next = entries.filter((e) => e.id !== id);
  await persist(next);
  return next;
}

export function monthKey(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

export function summarizeMonth(entries: Entry[], key: string) {
  const monthEntries = entries.filter((e) => monthKey(e.date) === key);
  const income = monthEntries
    .filter((e) => e.type === 'income')
    .reduce((sum, e) => sum + e.amount, 0);
  const expense = monthEntries
    .filter((e) => e.type === 'expense')
    .reduce((sum, e) => sum + e.amount, 0);
  return { income, expense, balance: income - expense };
}

export function toCsv(entries: Entry[]): string {
  const header = '日付,種別,勘定科目,金額,メモ';
  const rows = entries.map((e) =>
    [e.date, e.type === 'income' ? '収入' : '支出', e.category, e.amount, e.memo.replace(/,/g, '、')].join(',')
  );
  return [header, ...rows].join('\n');
}
