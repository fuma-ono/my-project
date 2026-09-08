export type EntryType = 'income' | 'expense';

export type Entry = {
  id: string;
  type: EntryType;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  memo: string;
};
