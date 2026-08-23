export type Profile = {
  id: string;
  display_name: string;
  avatar_emoji: string | null;
};

export type Group = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

export type EntryType = 'money' | 'favor';

export type Entry = {
  id: string;
  group_id: string;
  from_user: string;
  to_user: string;
  type: EntryType;
  amount: number | null;
  currency: string | null;
  description: string | null;
  photo_path: string | null;
  settled: boolean;
  created_by: string;
  created_at: string;
};

export type BalanceRow = {
  debtor: string; // profile id
  creditor: string; // profile id
  type: EntryType;
  amount: number; // money: 金額 / favor: 件数
  currency: string | null;
  mine: boolean;
};
