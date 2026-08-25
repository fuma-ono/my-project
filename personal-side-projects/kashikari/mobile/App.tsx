import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import DemoApp from './src/demo/DemoApp';
import GroupScreen from './src/screens/GroupScreen';
import GroupsScreen from './src/screens/GroupsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import PremiumScreen from './src/screens/PremiumScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SplashScreen from './src/screens/SplashScreen';
import { useAuth } from './src/hooks/useAuth';
import { useGroups } from './src/hooks/useGroups';
import { LanguageProvider } from './src/i18n';
import { logEvent } from './src/lib/analytics';
import type { Group } from './src/types';

// 起動直後、読み込みが一瞬で終わってもロゴが一瞬フラッシュするだけにならない
// よう、最低でもこれだけはブランド画面を見せる(体感の「間」を作るため)。
const MIN_SPLASH_MS = 900;

// settings/premiumは複数の入り口(グループ一覧・グループ詳細)から開けるため、
// 「戻る」で正しい画面に戻れるよう、開いた時点の画面をreturnToとして
// 持ち運ぶ(簡易的なナビゲーションスタック)。
type Screen =
  | { name: 'groups' }
  | { name: 'group'; group: Group; justCreated?: boolean }
  | { name: 'settings'; returnTo?: Screen }
  | { name: 'premium'; returnTo?: Screen };

// kashikari://join?code=XXXXXX 形式の招待リンクが開かれたかどうかを判定する。
// 現状(Expo Go実行中)はこのリンク自体を開いても実際にはアプリに渡って
// 来ないため実質的には発火しないが、スタンドアロン/開発ビルドにした
// 将来のために「リンク経由で開かれた」ことだけは計測できるようにしておく。
function isInviteLink(url: string): boolean {
  return url.startsWith('kashikari://join');
}

// デモモード: Supabase未接続でもUIを確認できるようにする(スクリーンショット・
// 動作確認用)。本番の.envではこの変数を設定しないこと。
const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === '1';

// LanguageProviderの内側でuseAuth/useGroups(どちらも文言を扱う)を呼ぶため、
// 実体はAppInnerに分離し、下のdefault exportでProviderをかぶせている。
function AppInner() {
  const { loading: authLoading, userId, profile, error: authError, setDisplayName, updateAvatar } = useAuth();
  const { groups, loading: groupsLoading, refresh, createGroup, joinGroup, leaveGroup, updateGroupIcon } = useGroups(
    DEMO_MODE ? null : userId
  );
  const [screen, setScreen] = useState<Screen>({ name: 'groups' });
  const [minSplashDone, setMinSplashDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinSplashDone(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  // 招待URL経由でアプリが開かれたことを計測する(成功指標の「招待リンク
  // クリック数」)。デモモードでは計測しない。
  useEffect(() => {
    if (DEMO_MODE) return;
    const handle = (url: string | null) => {
      if (url && isInviteLink(url)) logEvent('invite_link_clicked', { userId });
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, [userId]);

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
        <OnboardingScreen onSubmit={setDisplayName} authError={authError} />
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
          onOpenGroup={(group, justCreated) => setScreen({ name: 'group', group, justCreated })}
          onCreateGroup={createGroup}
          onJoinGroup={joinGroup}
          onOpenSettings={() => setScreen({ name: 'settings' })}
        />
      )}
      {screen.name === 'group' && (
        <GroupScreen
          group={screen.group}
          meId={userId}
          justCreated={screen.justCreated}
          onBack={() => setScreen({ name: 'groups' })}
          onLeave={leaveGroup}
          onChangeAvatar={updateAvatar}
          onChangeGroupIcon={async (emoji) => {
            const res = await updateGroupIcon(screen.group.id, emoji);
            // groupsの一覧はupdateGroupIcon内のrefresh()で更新されるが、
            // 今開いている画面が持つgroupはApp.tsx側で保持しているスナップショット
            // なので、こちらも合わせて更新しないとアイコンの変更がこの画面に
            // 反映されない(戻って開き直すまで古いままになってしまう)。
            if (!res.error) setScreen({ name: 'group', group: { ...screen.group, icon_emoji: emoji } });
            return res;
          }}
          onOpenSettings={() => setScreen({ name: 'settings', returnTo: screen })}
        />
      )}
      {screen.name === 'settings' && (
        <SettingsScreen
          profile={profile}
          onBack={() => setScreen(screen.returnTo ?? { name: 'groups' })}
          onChangeDisplayName={(name) => setDisplayName(name, profile.avatar_emoji)}
          onChangeAvatar={updateAvatar}
          onOpenPremium={() => setScreen({ name: 'premium', returnTo: screen })}
        />
      )}
      {screen.name === 'premium' && (
        <PremiumScreen
          onBack={() => setScreen(screen.returnTo ?? { name: 'settings' })}
          onView={() => logEvent('premium_view', { userId })}
          onInterest={() => logEvent('premium_interest', { userId })}
        />
      )}
      <StatusBar style="dark" />
    </>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  );
}
