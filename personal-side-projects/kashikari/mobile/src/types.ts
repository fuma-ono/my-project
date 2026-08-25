export type Profile = {
  id: string;
  display_name: string;
  avatar_emoji: string | null;
};

export type Group = {
  id: string;
  name: string;
  invite_code: string;
  icon_emoji: string | null;
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

// 「自動精算」で使う、グループ全体を最小の支払い回数にまとめた結果の1行。
// BalanceRowと違い、必ずしも実際にentriesとして記録された相手同士の
// 組み合わせとは限らない(例: A→B, B→Cの2件がA→Cの1件にまとまる)。
export type SimplifiedTransaction = {
  debtor: string; // profile id (支払う側)
  creditor: string; // profile id (受け取る側)
  amount: number;
  currency: string;
};
