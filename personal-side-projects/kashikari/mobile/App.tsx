import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts as useFredoka, Fredoka_500Medium, Fredoka_600SemiBold } from '@expo-google-fonts/fredoka';
import { useFonts as useWorkSans, WorkSans_400Regular, WorkSans_500Medium, WorkSans_600SemiBold } from '@expo-google-fonts/work-sans';

import GroupScreen from './src/screens/GroupScreen';
import GroupsScreen from './src/screens/GroupsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import { useAuth } from './src/hooks/useAuth';
import { useGroups } from './src/hooks/useGroups';
import { colors } from './src/theme';
import type { Group } from './src/types';

type Screen = { name: 'groups' } | { name: 'group'; group: Group };

export default function App() {
  const [fredokaLoaded] = useFredoka({ Fredoka_500Medium, Fredoka_600SemiBold });
  const [workSansLoaded] = useWorkSans({ WorkSans_400Regular, WorkSans_500Medium, WorkSans_600SemiBold });
  const { loading: authLoading, userId, profile, setDisplayName } = useAuth();
  const { groups, loading: groupsLoading, refresh, createGroup, joinGroup, leaveGroup } = useGroups(userId);
  const [screen, setScreen] = useState<Screen>({ name: 'groups' });

  if (!fredokaLoaded || !workSansLoaded || authLoading) {
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
