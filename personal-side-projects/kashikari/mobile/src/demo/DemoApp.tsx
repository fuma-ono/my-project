// デモモードのルート。認証・DB通信を一切せず、グループ一覧⇄グループ詳細を
// ローカルデータだけで行き来できるようにする。
import { useState } from 'react';

import GroupsScreen from '../screens/GroupsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import PremiumScreen from '../screens/PremiumScreen';
import SettingsScreen from '../screens/SettingsScreen';
import UsageScreen from '../screens/UsageScreen';
import { useT } from '../i18n';
import type { Group, Profile } from '../types';
import DemoGroupScreen from './DemoGroupScreen';
import { DEMO_GROUPS, DEMO_NOTIFICATIONS, DEMO_PROFILE } from './mockData';

// settings/premium/usage/notificationsは複数の入り口(グループ一覧・
// グループ詳細)から開けるため、本番のApp.tsxと同じくreturnToで
// 「戻る」先を持ち運ぶ。
type Screen =
  | { name: 'groups' }
  | { name: 'group' }
  | { name: 'settings'; returnTo?: Screen }
  | { name: 'premium'; returnTo?: Screen }
  | { name: 'usage'; returnTo?: Screen }
  | { name: 'notifications'; returnTo?: Screen };

export default function DemoApp() {
  const t = useT();
  const [screen, setScreen] = useState<Screen>({ name: 'groups' });
  const [profile, setProfile] = useState<Profile>(DEMO_PROFILE);
  // 本番同様、通知ページを開くまでは未読マークを出す(初期値はepoch=
  // 「まだ一度も開いていない」相当なので、デモの通知は最初は全部未読)。
  const [notificationsSeenAt, setNotificationsSeenAt] = useState(new Date(0).toISOString());
  const hasUnreadNotifications = DEMO_NOTIFICATIONS.some((n) => n.created_at > notificationsSeenAt);
  const openNotifications = (returnTo?: Screen) => {
    setScreen({ name: 'notifications', returnTo });
    setNotificationsSeenAt(new Date().toISOString());
  };

  if (screen.name === 'group') {
    return (
      <DemoGroupScreen onBack={() => setScreen({ name: 'groups' })} />
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
        isDemo
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

  if (screen.name === 'notifications') {
    return (
      <NotificationsScreen
        onBack={() => setScreen(screen.returnTo ?? { name: 'groups' })}
        items={DEMO_NOTIFICATIONS}
        loading={false}
        onRefresh={async () => {}}
      />
    );
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
      onOpenNotifications={() => openNotifications()}
      hasUnreadNotifications={hasUnreadNotifications}
    />
  );
}
