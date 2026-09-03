import {
  useFonts,
  MPLUSRounded1c_400Regular,
  MPLUSRounded1c_500Medium,
  MPLUSRounded1c_700Bold,
  MPLUSRounded1c_800ExtraBold,
} from '@expo-google-fonts/m-plus-rounded-1c';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import DemoApp from './src/demo/DemoApp';
import NotificationBanner from './src/components/NotificationBanner';
import ConfigErrorScreen from './src/screens/ConfigErrorScreen';
import GroupScreen from './src/screens/GroupScreen';
import GroupsScreen from './src/screens/GroupsScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import PremiumScreen from './src/screens/PremiumScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SplashScreen from './src/screens/SplashScreen';
import UsageScreen from './src/screens/UsageScreen';
import { useAuth } from './src/hooks/useAuth';
import { useGroups } from './src/hooks/useGroups';
import { useNotifications } from './src/hooks/useNotifications';
import { usePushNotifications } from './src/hooks/usePushNotifications';
import { LanguageProvider } from './src/i18n';
import { getUsageStats, logEvent } from './src/lib/analytics';
import { isSupabaseConfigured } from './src/lib/supabase';
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
  | { name: 'premium'; returnTo?: Screen }
  | { name: 'usage'; returnTo?: Screen }
  | { name: 'notifications'; returnTo?: Screen };

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
  const {
    loading: authLoading,
    userId,
    profile,
    error: authError,
    setDisplayName,
    updateAvatar,
    updateAvatarPhoto,
    signOut,
    markNotificationsSeen,
  } = useAuth();
  const { groups, loading: groupsLoading, refresh, createGroup, joinGroup, leaveGroup, updateGroupIcon, updateGroupIconPhoto } = useGroups(
    DEMO_MODE ? null : userId
  );
  const { pendingGroupId, clearPendingGroupId } = usePushNotifications(DEMO_MODE ? null : userId);
  const {
    items: notificationItems,
    loading: notificationsLoading,
    refresh: refreshNotifications,
    latestInsert: latestNotification,
    clearLatestInsert: clearLatestNotification,
  } = useNotifications(DEMO_MODE ? null : userId);
  const [screen, setScreen] = useState<Screen>({ name: 'groups' });
  const [minSplashDone, setMinSplashDone] = useState(false);
  const [fontsLoaded] = useFonts({
    MPLUSRounded1c_400Regular,
    MPLUSRounded1c_500Medium,
    MPLUSRounded1c_700Bold,
    MPLUSRounded1c_800ExtraBold,
  });

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

  // 通知をタップして開かれた場合、そのgroup_idの画面を直接開く。groupsの
  // 読み込みが間に合っていない場合はここで何もせず、groups更新のたびに
  // この副作用が再評価されるので、読み込みが終わった時点で見つかれば開く。
  // 読み込みが終わっても見つからない場合(グループを抜けた等)は諦める。
  useEffect(() => {
    if (DEMO_MODE || !pendingGroupId) return;
    const group = groups.find((g) => g.id === pendingGroupId);
    if (group) {
      setScreen({ name: 'group', group });
      clearPendingGroupId();
    } else if (!groupsLoading) {
      clearPendingGroupId();
    }
  }, [pendingGroupId, groups, groupsLoading, clearPendingGroupId]);

  // 通知ベルの未読マーク。「profile.notifications_seen_atより新しい
  // notification_logがあるか」だけを見る単純な仕組み(詳細はuseAuth.ts
  // のmarkNotificationsSeenのコメント参照)。
  const hasUnreadNotifications =
    !DEMO_MODE && !!profile && notificationItems.some((item) => item.created_at > profile.notifications_seen_at);

  const openNotifications = () => {
    setScreen({ name: 'notifications', returnTo: screen });
    markNotificationsSeen();
  };

  // フォアグラウンドで届いた通知バナー(NotificationBanner)をタップ
  // した時。通知タップ経由(pendingGroupId)と違い、こちらは既に
  // groupsが読み込み済みの状態でしか出ないバナーなので、その場で
  // 見つからなければ静かに諦める(groupsの読み込み待ちは行わない)。
  const openLatestNotificationGroup = () => {
    const groupId = latestNotification?.group_id;
    if (groupId) {
      const group = groups.find((g) => g.id === groupId);
      if (group) setScreen({ name: 'group', group });
    }
  };

  if (!fontsLoaded || !minSplashDone || (!DEMO_MODE && authLoading)) {
    return <SplashScreen fontsReady={fontsLoaded} />;
  }

  // EXPO_PUBLIC_SUPABASE_URL/ANON_KEYが未設定のビルド(EAS BuildのEnvironment
  // Variables登録漏れ等)では、以前はここから先で例外が起きて真っ白画面の
  // ままクラッシュしていた。DEMO_MODEはSupabase未接続が前提の動作なので対象外。
  if (!DEMO_MODE && !isSupabaseConfigured) {
    return (
      <>
        <ConfigErrorScreen />
        <StatusBar style="dark" />
      </>
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
          onOpenNotifications={openNotifications}
          hasUnreadNotifications={hasUnreadNotifications}
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
          onChangeAvatarPhoto={updateAvatarPhoto}
          onChangeGroupIcon={async (emoji) => {
            const res = await updateGroupIcon(screen.group.id, emoji);
            // groupsの一覧はupdateGroupIcon内のrefresh()で更新されるが、
            // 今開いている画面が持つgroupはApp.tsx側で保持しているスナップショット
            // なので、こちらも合わせて更新しないとアイコンの変更がこの画面に
            // 反映されない(戻って開き直すまで古いままになってしまう)。
            if (!res.error) setScreen({ name: 'group', group: { ...screen.group, icon_emoji: emoji, icon_photo_path: null } });
            return res;
          }}
          onChangeGroupIconPhoto={async (uri) => {
            const res = await updateGroupIconPhoto(screen.group.id, uri);
            // アップロード後のパスは分からない(uploadIconPhoto内で決まる)ため、
            // 確実に最新化するにはgroups一覧から取り直す必要がある。
            // refresh()はupdateGroupIconPhoto内で既に済んでいるので、
            // groupsから該当グループを探して使う。
            if (!res.error) {
              const updated = groups.find((g) => g.id === screen.group.id);
              if (updated) setScreen({ name: 'group', group: updated });
            }
            return res;
          }}
          onOpenSettings={() => setScreen({ name: 'settings', returnTo: screen })}
          onOpenNotifications={openNotifications}
          hasUnreadNotifications={hasUnreadNotifications}
        />
      )}
      {screen.name === 'settings' && (
        <SettingsScreen
          profile={profile}
          onBack={() => setScreen(screen.returnTo ?? { name: 'groups' })}
          onChangeDisplayName={(name) => setDisplayName(name, profile.avatar_emoji)}
          onChangeAvatar={updateAvatar}
          onChangeAvatarPhoto={updateAvatarPhoto}
          onOpenPremium={() => setScreen({ name: 'premium', returnTo: screen })}
          onOpenUsage={() => setScreen({ name: 'usage', returnTo: screen })}
          onSignOut={signOut}
        />
      )}
      {screen.name === 'premium' && (
        <PremiumScreen
          onBack={() => setScreen(screen.returnTo ?? { name: 'settings' })}
          onView={() => logEvent('premium_view', { userId })}
          onInterest={() => logEvent('premium_interest', { userId })}
        />
      )}
      {screen.name === 'usage' && (
        <UsageScreen onBack={() => setScreen(screen.returnTo ?? { name: 'settings' })} fetchStats={getUsageStats} />
      )}
      {screen.name === 'notifications' && (
        <NotificationsScreen
          onBack={() => setScreen(screen.returnTo ?? { name: 'groups' })}
          items={notificationItems}
          loading={notificationsLoading}
          onRefresh={refreshNotifications}
        />
      )}
      {/* 通知ページを開いている間は、リアルタイムで一覧に反映されるので
          バナーは出さない(二重に知らせる必要が無いため)。 */}
      <NotificationBanner
        title={latestNotification?.title ?? ''}
        body={latestNotification?.body ?? ''}
        visible={!!latestNotification && screen.name !== 'notifications'}
        onPress={openLatestNotificationGroup}
        onHide={clearLatestNotification}
      />
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
