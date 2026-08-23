import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts as useManrope,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';

import DemoApp from './src/demo/DemoApp';
import GroupScreen from './src/screens/GroupScreen';
import GroupsScreen from './src/screens/GroupsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { useAuth } from './src/hooks/useAuth';
import { useGroups } from './src/hooks/useGroups';
import { colors } from './src/theme';
import type { Group } from './src/types';

type Screen = { name: 'groups' } | { name: 'group'; group: Group };

// デモモード: Supabase未接続でもUIを確認できるようにする(スクリーンショット・
// 動作確認用)。本番の.envではこの変数を設定しないこと。
const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === '1';

export default function App() {
  const [manropeLoaded] = useManrope({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold });
  const { loading: authLoading, userId, profile, setDisplayName } = useAuth();
  const { groups, loading: groupsLoading, refresh, createGroup, joinGroup, leaveGroup } = useGroups(DEMO_MODE ? null : userId);
  const [screen, setScreen] = useState<Screen>({ name: 'groups' });

  if (!manropeLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (DEMO_MODE) {
    return (
      <>
        <DemoApp />
        <StatusBar style="dark" />
      </>
    );
  }

  if (authLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
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

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
