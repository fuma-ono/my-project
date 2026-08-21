// デモモードのルート。認証・DB通信を一切せず、グループ一覧⇄グループ詳細を
// ローカルデータだけで行き来できるようにする。
import { useState } from 'react';

import GroupsScreen from '../screens/GroupsScreen';
import type { Group } from '../types';
import DemoGroupScreen from './DemoGroupScreen';
import { DEMO_GROUP, DEMO_GROUPS, DEMO_PROFILE } from './mockData';

type Screen = { name: 'groups' } | { name: 'group' };

export default function DemoApp() {
  const [screen, setScreen] = useState<Screen>({ name: 'groups' });

  if (screen.name === 'group') {
    return <DemoGroupScreen onBack={() => setScreen({ name: 'groups' })} />;
  }

  return (
    <GroupsScreen
      displayName={DEMO_PROFILE.display_name}
      groups={DEMO_GROUPS}
      loading={false}
      onRefresh={async () => {}}
      onOpenGroup={(_g: Group) => setScreen({ name: 'group' })}
      onCreateGroup={async () => ({ error: 'デモモードでは作成できません', group: null })}
      onJoinGroup={async () => ({ error: 'デモモードでは参加できません', group: null })}
    />
  );
}
