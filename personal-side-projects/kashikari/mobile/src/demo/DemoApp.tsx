// デモモードのルート。認証・DB通信を一切せず、グループ一覧⇄グループ詳細を
// ローカルデータだけで行き来できるようにする。
import { useState } from 'react';

import GroupsScreen from '../screens/GroupsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { useT } from '../i18n';
import type { Group, Profile } from '../types';
import DemoGroupScreen from './DemoGroupScreen';
import { DEMO_GROUPS, DEMO_PROFILE } from './mockData';

type Screen = { name: 'groups' } | { name: 'group' } | { name: 'settings' };

export default function DemoApp() {
  const t = useT();
  const [screen, setScreen] = useState<Screen>({ name: 'groups' });
  const [profile, setProfile] = useState<Profile>(DEMO_PROFILE);

  if (screen.name === 'group') {
    return <DemoGroupScreen onBack={() => setScreen({ name: 'groups' })} />;
  }

  if (screen.name === 'settings') {
    return (
      <SettingsScreen
        profile={profile}
        onBack={() => setScreen({ name: 'groups' })}
        onChangeDisplayName={async (name) => {
          setProfile((p) => ({ ...p, display_name: name.trim() || p.display_name }));
          return { error: null };
        }}
        onChangeAvatar={async (emoji) => {
          setProfile((p) => ({ ...p, avatar_emoji: emoji }));
          return { error: null };
        }}
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
    />
  );
}
