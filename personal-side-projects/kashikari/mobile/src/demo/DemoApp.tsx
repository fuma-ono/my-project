// デモモードのルート。認証・DB通信を一切せず、グループ一覧⇄グループ詳細を
// ローカルデータだけで行き来できるようにする。
import { useState } from 'react';

import GroupsScreen from '../screens/GroupsScreen';
import PremiumScreen from '../screens/PremiumScreen';
import SettingsScreen from '../screens/SettingsScreen';
import UsageScreen from '../screens/UsageScreen';
import { useT } from '../i18n';
import type { Group, Profile } from '../types';
import DemoGroupScreen from './DemoGroupScreen';
import { DEMO_GROUPS, DEMO_PROFILE } from './mockData';

// settings/premium/usageは複数の入り口(グループ一覧・グループ詳細)から
// 開けるため、本番のApp.tsxと同じくreturnToで「戻る」先を持ち運ぶ。
type Screen =
  | { name: 'groups' }
  | { name: 'group' }
  | { name: 'settings'; returnTo?: Screen }
  | { name: 'premium'; returnTo?: Screen }
  | { name: 'usage'; returnTo?: Screen };

export default function DemoApp() {
  const t = useT();
  const [screen, setScreen] = useState<Screen>({ name: 'groups' });
  const [profile, setProfile] = useState<Profile>(DEMO_PROFILE);

  if (screen.name === 'group') {
    return (
      <DemoGroupScreen
        onBack={() => setScreen({ name: 'groups' })}
        onOpenSettings={() => setScreen({ name: 'settings', returnTo: screen })}
      />
    );
  }

  if (screen.name === 'settings') {
    return (
      <SettingsScreen
        profile={profile}
        onBack={() => setScreen(screen.returnTo ?? { name: 'groups' })}
        onChangeDisplayName={async (name) => {
          setProfile((p) => ({ ...p, display_name: name.trim() || p.display_name }));
          return { error: null };
        }}
        onChangeAvatar={async (emoji) => {
          setProfile((p) => ({ ...p, avatar_emoji: emoji }));
          return { error: null };
        }}
        onOpenPremium={() => setScreen({ name: 'premium', returnTo: screen })}
        onOpenUsage={() => setScreen({ name: 'usage', returnTo: screen })}
      />
    );
  }

  if (screen.name === 'premium') {
    // デモモードでは計測しない(本番のanalytics_eventsは呼ばない)。
    return <PremiumScreen onBack={() => setScreen(screen.returnTo ?? { name: 'settings' })} onView={() => {}} onInterest={() => {}} />;
  }

  if (screen.name === 'usage') {
    // デモモードには実データが無いため、常に空状態(実装④)を確認できる。
    return <UsageScreen onBack={() => setScreen(screen.returnTo ?? { name: 'settings' })} fetchStats={async () => ({})} />;
  }

  return (
    <GroupsScreen
      displayName={profile.display_name}
      groups={DEMO_GROUPS}
      loading={false}
      onRefresh={async () => {}}
      onOpenGroup={(_g: Group) => setScreen({ name: 'group' })}
      onCreateGroup={async () => ({ error: t.demo.createDisabled, group: null })}
      onJoinGroup={async () => ({ error: t.demo.joinDisabled, group: null })}
      onOpenSettings={() => setScreen({ name: 'settings' })}
    />
  );
}
