import { Ionicons } from '@expo/vector-icons';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { colors, fonts } from '../theme';
import type { NotificationLogItem } from '../types';

type Props = {
  onBack: () => void;
  items: NotificationLogItem[];
  loading: boolean;
  onRefresh: () => void;
  // 「グループ内の通知は、そのグループのみを表示するようにした方が
  // いい」という指摘への対応(87回目)。渡すと、全グループ共通の受信箱
  // ではなくこのグループ専用の一覧として表示する: タイトルをグループ名
  // 入りのものに変え、行ごとに繰り返し出ていた(全部同じ)グループ名の
  // ラベルを省いて本文を見やすくする。渡さない場合(ホーム画面のベルから
  // 開いた時)は従来通り全グループ横断の一覧のまま。
  scopedGroupName?: string;
};

// 通知ベル(グループ一覧・グループ詳細のヘッダー)から開く、過去の通知の
// 一覧。send-push(Edge Function)がnotification_logに書き込んだ内容を
// そのまま新しい順に並べるだけの、シンプルな受信箱。
export default function NotificationsScreen({ onBack, items, loading, onRefresh, scopedGroupName }: Props) {
  const t = useT();

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t.notifications.back}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {scopedGroupName ? t.notifications.groupTitle(scopedGroupName) : t.notifications.title}
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>🔔</Text>
              <Text style={styles.emptyTitle}>{t.notifications.emptyTitle}</Text>
              <Text style={styles.emptyMessage}>
                {scopedGroupName ? t.notifications.groupEmptyMessage : t.notifications.emptyMessage}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.badge}>
              <Ionicons name="notifications" size={16} color={colors.accent} />
            </View>
            <View style={styles.main}>
              {scopedGroupName ? (
                <Text style={styles.time}>{formatNotificationTime(item.created_at)}</Text>
              ) : (
                <View style={styles.rowTop}>
                  <Text style={styles.groupName} numberOfLines={1}>
                    {item.group_name}
                  </Text>
                  <Text style={styles.time}>{formatNotificationTime(item.created_at)}</Text>
                </View>
              )}
              <Text style={styles.body} numberOfLines={3}>
                {item.body}
              </Text>
            </View>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.hairline} />}
      />
    </View>
  );
}

// 今日なら時刻(HH:MM)、それ以外は日付を表示する(通知履歴は基本的に
// 直近のものを見返す用途のため、古いものまで細かい時刻を出す必要はない)。
function formatNotificationTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  return isToday
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, paddingTop: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 12 },
  title: { ...fonts.display, fontSize: 22, color: colors.ink },
  list: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 12 },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    marginTop: 1,
  },
  main: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  groupName: { ...fonts.bodySemiBold, fontSize: 12.5, color: colors.muted, flexShrink: 1 },
  time: { ...fonts.body, fontSize: 12, color: colors.muted },
  body: { ...fonts.bodyMedium, fontSize: 14.5, color: colors.ink, marginTop: 2 },
  hairline: { height: 1, backgroundColor: colors.line },
  emptyWrap: { alignItems: 'center', paddingVertical: 64 },
  emptyEmoji: { fontSize: 34, marginBottom: 10 },
  emptyTitle: { ...fonts.bodySemiBold, fontSize: 16, color: colors.ink, marginBottom: 4 },
  emptyMessage: { ...fonts.body, fontSize: 14, color: colors.muted, textAlign: 'center' },
});
