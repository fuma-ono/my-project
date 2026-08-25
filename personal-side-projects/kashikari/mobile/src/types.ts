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

// 招待した記録(誰を招待し、まだ参加していないか)。招待コード自体は
// Groupが1つ持つだけで変わらない。参加が確認できると status が
// 'joined' になる(FIFOでの簡易的なマッチング。詳細はschema.sql参照)。
export type GroupInvite = {
  id: string;
  group_id: string;
  invited_name: string;
  status: 'pending' | 'joined';
  created_by: string;
  created_at: string;
  joined_user_id: string | null;
  joined_at: string | null;
};

export type EntryType = 'money' | 'favor';

// unpaid: 未精算 / paid: 支払う側が「支払った」を押した(受け取る側の確認待ち) /
// confirmed: 受け取る側が「受け取った」を押した(双方確認済み=完了)
export type SettleStatus = 'unpaid' | 'paid' | 'confirmed';

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
  settle_status: SettleStatus;
  paid_at: string | null;
  confirmed_at: string | null;
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
  oldestUnsettledAt: string; // この相手×通貨(頼みごとは相手×向き)で最初に未精算になった記録のcreated_at
  // このペア(相手×通貨)の未精算(confirmed以外)の記録が、全て「支払った」
  // 済みかどうか。頼みごとには「支払う」という概念が無いため常にunpaid固定
  // (頼みごとは従来通り一括の「精算」ボタンで直接confirmedにする)。
  status: 'unpaid' | 'paid';
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
