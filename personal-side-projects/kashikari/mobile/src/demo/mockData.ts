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
    settled: false,
    created_by: DEMO_ME_ID,
    created_at: hoursAgo(2),
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
    settled: false,
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
    settled: false,
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
    settled: true,
    created_by: DEMO_ME_ID,
    created_at: hoursAgo(72),
  },
];
