export type Profile = {
  id: string;
  display_name: string;
  avatar_emoji: string | null;
  // 「アイコンで自分の写真を使えるようにしてほしい」への対応。
  // avatar_emojiと排他(どちらか一方だけが入る)。storageのavatarsバケット
  // 内のパス(useSignedUrlで署名付きURLに変換して表示する)。
  avatar_photo_path: string | null;
  // 通知ベルの未読マーク用。この時刻より新しいnotification_logがあれば
  // 未読とみなす。通知ページを開くたびに今の時刻に更新する。
  notifications_seen_at: string;
};

export type Group = {
  id: string;
  name: string;
  invite_code: string;
  icon_emoji: string | null;
  // icon_emojiと同じく排他。グループのアイコン写真。
  icon_photo_path: string | null;
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
  // 「招待した相手が参加する前でも記録できる」対応。相手が実メンバーなら
  // from_user/to_user、まだ参加していない招待中の相手ならfrom_invite/
  // to_invite(group_invites.id)に入る。片方だけが必ず入っている
  // (DB側のCHECK制約で保証)。招待が実際の参加に変わったタイミングで、
  // join_group RPC側がfrom_invite/to_invite→from_user/to_userに
  // 付け替える。相手を1つのIDとして扱いたい箇所はlib/balances.tsの
  // entryFromKey/entryToKeyを経由すること。
  from_user: string | null;
  to_user: string | null;
  from_invite: string | null;
  to_invite: string | null;
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
  // 精算状態を最後に変更した人・時刻(68回目)。「グループ内は誰でも
  // 他人の記録に触れてよい」代わりに、自分以外の誰かが変更したことに
  // 台帳画面で気づけるようにするための情報(EntryRowのハイライト表示)。
  // 作成時点ではnull(作成しただけでは「変更」扱いしない)。
  updated_by: string | null;
  updated_at: string | null;
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

// アプリ内の通知履歴(notification_logテーブル)。send-push(Edge
// Function)が、実際にOSのプッシュ通知を送れたかに関わらず対象メンバー
// 1人につき1行書き込む。詳細はsupabase/schema.sqlのコメント参照。
export type NotificationLogItem = {
  id: string;
  group_id: string | null;
  group_name: string;
  title: string;
  body: string;
  created_at: string;
};
