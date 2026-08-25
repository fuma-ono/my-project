// デモモード専用のダミーデータ。Supabase接続なしでUIを確認するために使う。
// EXPO_PUBLIC_DEMO_MODE=1 のときだけApp.tsxから参照される(本番ビルドには影響しない)。
import type { Entry, Group, Profile } from '../types';

export const DEMO_ME_ID = 'demo-taro';

export const DEMO_PROFILE: Profile = { id: DEMO_ME_ID, display_name: 'たろう', avatar_emoji: '🦊' };

export const DEMO_MEMBERS: Profile[] = [
  DEMO_PROFILE,
  { id: 'demo-hanako', display_name: 'はなこ', avatar_emoji: '🐰' },
  { id: 'demo-jiro', display_name: 'じろう', avatar_emoji: null },
];

export const DEMO_GROUP: Group = {
  id: 'demo-group',
  name: '大学の友達',
  invite_code: 'K7XQ2M',
  icon_emoji: '🎓',
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
    to_user: 'demo-hanako',
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
  },
  {
    id: 'e2',
    group_id: DEMO_GROUP.id,
    from_user: 'demo-jiro',
    to_user: DEMO_ME_ID,
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
  },
  {
    id: 'e3',
    group_id: DEMO_GROUP.id,
    from_user: 'demo-hanako',
    to_user: 'demo-jiro',
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
  },
  {
    id: 'e4',
    group_id: DEMO_GROUP.id,
    from_user: DEMO_ME_ID,
    to_user: 'demo-jiro',
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
  },
  // e5・e6は、e1と合わせてたろう・はなこ・じろうの3人でJPYの貸し借りが
  // 三角形になるようにしてある(自動精算で3件→2件にまとまる様子を
  // デモ・スクリーンショットで確認できるようにするため)。
  {
    id: 'e5',
    group_id: DEMO_GROUP.id,
    from_user: 'demo-jiro',
    to_user: DEMO_ME_ID,
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
  },
  {
    id: 'e6',
    group_id: DEMO_GROUP.id,
    from_user: 'demo-hanako',
    to_user: 'demo-jiro',
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
  },
];
