import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';

import DemoApp from './src/demo/DemoApp';
import GroupScreen from './src/screens/GroupScreen';
import GroupsScreen from './src/screens/GroupsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import SplashScreen from './src/screens/SplashScreen';
import { useAuth } from './src/hooks/useAuth';
import { useGroups } from './src/hooks/useGroups';
import type { Group } from './src/types';

// 起動直後、読み込みが一瞬で終わってもロゴが一瞬フラッシュするだけにならない
// よう、最低でもこれだけはブランド画面を見せる(体感の「間」を作るため)。
const MIN_SPLASH_MS = 900;

type Screen = { name: 'groups' } | { name: 'group'; group: Group };

// デモモード: Supabase未接続でもUIを確認できるようにする(スクリーンショット・
// 動作確認用)。本番の.envではこの変数を設定しないこと。
const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === '1';

export default function App() {
  const { loading: authLoading, userId, profile, setDisplayName } = useAuth();
  const { groups, loading: groupsLoading, refresh, createGroup, joinGroup, leaveGroup } = useGroups(DEMO_MODE ? null : userId);
  const [screen, setScreen] = useState<Screen>({ name: 'groups' });
  const [minSplashDone, setMinSplashDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinSplashDone(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  if (!minSplashDone || (!DEMO_MODE && authLoading)) {
    return <SplashScreen />;
  }

  if (DEMO_MODE) {
    return (
      <>
        <DemoApp />
        <StatusBar style="dark" />
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <OnboardingScreen onSubmit={setDisplayName} />
        <StatusBar style="dark" />
      </>
    );
  }

  return (
    <>
      {screen.name === 'groups' && (
        <GroupsScreen
          displayName={profile.display_name}
          groups={groups}
          loading={groupsLoading}
          onRefresh={refresh}
          onOpenGroup={(group) => setScreen({ name: 'group', group })}
          onCreateGroup={createGroup}
          onJoinGroup={joinGroup}
        />
      )}
      {screen.name === 'group' && (
        <GroupScreen group={screen.group} meId={userId} onBack={() => setScreen({ name: 'groups' })} onLeave={leaveGroup} />
      )}
      <StatusBar style="dark" />
    </>
  );
}
