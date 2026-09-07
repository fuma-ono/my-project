// デモモード専用のダミーデータ。Supabase接続なしでUIを確認するために使う。
// EXPO_PUBLIC_DEMO_MODE=1 のときだけApp.tsxから参照される(本番ビルドには影響しない)。
import type { Entry, Group, NotificationLogItem, Profile } from '../types';

export const DEMO_ME_ID = 'demo-taro';

// 写真アイコン機能(avatar_photo_path/icon_photo_path)はstorageへの実際の
// アップロードを伴うため、デモモードではシミュレートしていない(常にnull。
// updateEntryのレシート写真と同じ考え方)。
export const DEMO_PROFILE: Profile = {
  id: DEMO_ME_ID,
  display_name: 'たろう',
  avatar_emoji: '🦊',
  avatar_photo_path: null,
  notifications_seen_at: new Date(0).toISOString(),
};

export const DEMO_MEMBERS: Profile[] = [
  DEMO_PROFILE,
  { id: 'demo-hanako', display_name: 'はなこ', avatar_emoji: '🐰', avatar_photo_path: null, notifications_seen_at: new Date(0).toISOString() },
  { id: 'demo-jiro', display_name: 'じろう', avatar_emoji: null, avatar_photo_path: null, notifications_seen_at: new Date(0).toISOString() },
];

export const DEMO_GROUP: Group = {
  id: 'demo-group',
  name: '大学の友達',
  invite_code: 'K7XQ2M',
  icon_emoji: '🎓',
  icon_photo_path: null,
  created_by: DEMO_ME_ID,
  created_at: new Date().toISOString(),
};

export const DEMO_GROUPS: Group[] = [
  DEMO_GROUP,
  {
    id: 'demo-group-2',
    name: 'サークル同期',
    invite_code: 'B3F9PL',
    icon_emoji: '⚽',
    icon_photo_path: null,
    created_by: DEMO_ME_ID,
    created_at: new Date().toISOString(),
  },
];

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

// 未払い日数(BalanceCard・未払いユーザー一覧)のデモ表示用。
function daysAgo(d: number): string {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}

export const DEMO_ENTRIES: Entry[] = [
  {
    id: 'e1',
    group_id: DEMO_GROUP.id,
    from_user: DEMO_ME_ID,
    from_invite: null,
    to_user: 'demo-hanako',
    to_invite: null,
    type: 'money',
    amount: 1500,
    currency: 'JPY',
    description: 'ラーメン奢った',
    photo_path: null,
    settle_status: 'unpaid',
    paid_at: null,
    confirmed_at: null,
    created_by: DEMO_ME_ID,
    created_at: daysAgo(3),
    updated_by: null,
    updated_at: null,
  },
  {
    id: 'e2',
    group_id: DEMO_GROUP.id,
    from_user: 'demo-jiro',
    from_invite: null,
    to_user: DEMO_ME_ID,
    to_invite: null,
    type: 'favor',
    amount: null,
    currency: null,
    description: '空港まで送ってもらった',
    photo_path: null,
    settle_status: 'unpaid',
    paid_at: null,
    confirmed_at: null,
    created_by: 'demo-jiro',
    created_at: hoursAgo(20),
    // 「グループ内は誰でも他人の記録に触れてよい」デモ用に、じろうが
    // 作った記録(自分=たろうも当事者)を、はなこ(第三者)が最近
    // 触った状態にしてある。台帳画面でこの行の件数表示がハイライト
    // されることを確認できる(68回目、EntryRow.tsx参照)。
    updated_by: 'demo-hanako',
    updated_at: hoursAgo(2),
  },
  {
    id: 'e3',
    group_id: DEMO_GROUP.id,
    from_user: 'demo-hanako',
    from_invite: null,
    to_user: 'demo-jiro',
    to_invite: null,
    type: 'money',
    amount: 20,
    currency: 'USD',
    description: '旅行の両替分',
    photo_path: null,
    settle_status: 'unpaid',
    paid_at: null,
    confirmed_at: null,
    created_by: 'demo-hanako',
    created_at: hoursAgo(30),
    updated_by: null,
    updated_at: null,
  },
  {
    id: 'e4',
    group_id: DEMO_GROUP.id,
    from_user: DEMO_ME_ID,
    from_invite: null,
    to_user: 'demo-jiro',
    to_invite: null,
    type: 'money',
    amount: 3000,
    currency: 'JPY',
    description: '飲み会の立て替え',
    photo_path: null,
    settle_status: 'confirmed',
    paid_at: hoursAgo(50),
    confirmed_at: hoursAgo(48),
    created_by: DEMO_ME_ID,
    created_at: hoursAgo(72),
    updated_by: null,
    updated_at: null,
  },
  // e5・e6は、e1と合わせてたろう・はなこ・じろうの3人でJPYの貸し借りが
  // 三角形になるようにしてある(自動精算で3件→2件にまとまる様子を
  // デモ・スクリーンショットで確認できるようにするため)。
  {
    id: 'e5',
    group_id: DEMO_GROUP.id,
    from_user: 'demo-jiro',
    from_invite: null,
    to_user: DEMO_ME_ID,
    to_invite: null,
    type: 'money',
    amount: 2000,
    currency: 'JPY',
    description: '飲み会代を立て替えてもらった',
    photo_path: null,
    // 「支払った」を押した後、じろう(受け取る側)の確認待ち、という
    // デモ用の状態(BalanceCardの「支払済み・確認待ち」表示を確認できる)。
    settle_status: 'paid',
    paid_at: hoursAgo(1),
    confirmed_at: null,
    created_by: 'demo-jiro',
    created_at: hoursAgo(10),
    updated_by: null,
    updated_at: null,
  },
  {
    id: 'e6',
    group_id: DEMO_GROUP.id,
    from_user: 'demo-hanako',
    from_invite: null,
    to_user: 'demo-jiro',
    to_invite: null,
    type: 'money',
    amount: 500,
    currency: 'JPY',
    description: '旅行のお土産代',
    photo_path: null,
    settle_status: 'unpaid',
    paid_at: null,
    confirmed_at: null,
    created_by: 'demo-hanako',
    created_at: hoursAgo(6),
    updated_by: null,
    updated_at: null,
  },
];

export const DEMO_NOTIFICATIONS: NotificationLogItem[] = [
  {
    id: 'n1',
    group_id: DEMO_GROUP.id,
    group_name: DEMO_GROUP.name,
    title: DEMO_GROUP.name,
    body: 'はなこさんが「旅行のお土産代」を記録しました',
    created_at: hoursAgo(1),
  },
  {
    id: 'n2',
    group_id: DEMO_GROUP.id,
    group_name: DEMO_GROUP.name,
    title: DEMO_GROUP.name,
    body: 'じろうさんが支払ったと報告しました。確認をお願いします',
    created_at: hoursAgo(20),
  },
  // 「グループ内の通知は、そのグループのみを表示するようにした方が
  // いい」(87回目)を確認できるよう、DEMO_GROUP(「大学の友達」)以外
  // からの通知も1件混ぜておく。ホーム画面のベル(全グループ横断)では
  // 3件とも見えるが、「大学の友達」グループ詳細のベルからはこの1件
  // (サークル同期宛て)だけ見えないことで、絞り込みが効いているか
  // 目視確認できる。
  {
    id: 'n3',
    group_id: 'demo-group-2',
    group_name: 'サークル同期',
    title: 'サークル同期',
    body: 'たろうさんが「新歓コンパ代」を記録しました',
    created_at: hoursAgo(5),
  },
];
