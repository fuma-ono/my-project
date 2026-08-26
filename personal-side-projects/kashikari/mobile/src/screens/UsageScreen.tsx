import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import type { AnalyticsEvent } from '../lib/analytics';
import { colors, fonts } from '../theme';

type Stats = Record<AnalyticsEvent, number>;

type Props = {
  onBack: () => void;
  // 実際の集計取得(get_usage_stats RPC)は呼び出し側(App.tsx)に任せる。
  // デモモードでは空のオブジェクトを返す関数を渡してもらう想定(空状態を
  // 確認できる)。欠けているキーは0として扱う。
  fetchStats: () => Promise<Partial<Stats>>;
};

type StepDef = { key: AnalyticsEvent; label: string };

// 「次に必要なのは機能ではなく、どこでユーザーが離脱するかを把握する
// こと」という指摘への対応。決済のPremium同様、これも計測専用の画面
// であり、書き込みは一切行わない(表示するだけ)。
export default function UsageScreen({ onBack, fetchStats }: Props) {
  const t = useT();
  const [stats, setStats] = useState<Partial<Stats> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      setStats(await fetchStats());
    } catch {
      setError(true);
    }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, []);

  const total = stats ? Object.values(stats).reduce((sum, n) => sum + n, 0) : 0;
  const isEmpty = !loading && !error && total === 0;

  const statItems: StepDef[] = stats
    ? [
        { key: 'group_created', label: t.usage.groupCreated },
        { key: 'invite_sent', label: t.usage.inviteSent },
        { key: 'invite_joined', label: t.usage.inviteJoined },
        { key: 'entry_created', label: t.usage.entryCreated },
        { key: 'reminder_sent', label: t.usage.reminderSent },
        { key: 'settlement_completed', label: t.usage.settlementCompleted },
        { key: 'premium_view', label: t.usage.premiumView },
        { key: 'premium_interest', label: t.usage.premiumInterest },
      ]
    : [];

  // 「転換率」として意味を持つのは、後段が前段の部分集合とみなせる
  // ペアだけ(招待を送った人のうちどれだけ参加したか、Premiumを見た人の
  // うちどれだけ興味を持ったか)。グループ作成数→招待送信数や参加完了数
  // →貸し借り登録数のような組は、1対1の部分集合関係ではなく(1グループ
  // が複数招待を送れる、1人が複数の記録を作れる等)、割合を出すと100%を
  // 超えることがあり「転換率」としては誤解を招くため、上のグリッドの
  // 数値だけで見せ、率としては連結しない。
  const inviteFunnel: StepDef[] = [
    { key: 'invite_sent', label: t.usage.inviteSent },
    { key: 'invite_joined', label: t.usage.inviteJoined },
  ];
  const premiumFunnel: StepDef[] = [
    { key: 'premium_view', label: t.usage.premiumView },
    { key: 'premium_interest', label: t.usage.premiumInterest },
  ];

  return (
    <View style={styles.wrap}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <View style={styles.headerRow}>
          <Pressable onPress={onBack} hitSlop={10}>
            <Text style={styles.back}>{t.usage.back}</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>{t.usage.title}</Text>

        {loading && !stats ? (
          <Text style={styles.statusText}>{t.usage.loading}</Text>
        ) : error ? (
          <Text style={styles.statusText}>{t.usage.loadFailed}</Text>
        ) : isEmpty ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>{t.usage.emptyTitle}</Text>
            <Text style={styles.emptyMessage}>{t.usage.emptyMessage}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>{t.usage.statsHeading}</Text>
            <View style={styles.grid}>
              {statItems.map((item) => (
                <View key={item.key} style={styles.statTile}>
                  <Text style={styles.statValue}>{stats?.[item.key] ?? 0}</Text>
                  <Text style={styles.statLabel}>{item.label}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionLabel}>{t.usage.funnelHeading}</Text>
            <Funnel steps={inviteFunnel} stats={stats ?? {}} rateLabel={t.usage.inviteJoinRate} rateUnavailable={t.usage.rateUnavailable} />

            <Text style={styles.sectionLabel}>{t.usage.premiumFunnelHeading}</Text>
            <Funnel steps={premiumFunnel} stats={stats ?? {}} rateLabel={t.usage.premiumInterestRate} rateUnavailable={t.usage.rateUnavailable} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Funnel({
  steps,
  stats,
  rateLabel,
  rateUnavailable,
}: {
  steps: StepDef[];
  stats: Partial<Stats>;
  rateLabel: (n: number) => string;
  rateUnavailable: string;
}) {
  return (
    <View style={styles.funnelWrap}>
      {steps.map((step, i) => {
        const count = stats[step.key] ?? 0;
        const prevCount = i > 0 ? stats[steps[i - 1].key] ?? 0 : null;
        const rate = prevCount !== null && prevCount > 0 ? Math.round((count / prevCount) * 100) : null;
        return (
          <View key={step.key}>
            {i > 0 && (
              <View style={styles.arrowRow}>
                <Text style={styles.arrowGlyph}>↓</Text>
                <Text style={styles.rateText}>{rate !== null ? rateLabel(rate) : rateUnavailable}</Text>
              </View>
            )}
            <View style={styles.funnelStep}>
              <Text style={styles.funnelLabel}>{step.label}</Text>
              <Text style={styles.funnelCount}>{count}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  headerRow: { marginBottom: 4 },
  back: { ...fonts.bodySemiBold, fontSize: 15, color: colors.accent },
  title: { ...fonts.display, fontSize: 26, color: colors.ink, marginTop: 4, marginBottom: 20 },
  statusText: { ...fonts.body, fontSize: 14.5, color: colors.muted, marginTop: 12 },
  emptyWrap: { alignItems: 'center', paddingVertical: 48 },
  emptyEmoji: { fontSize: 34, marginBottom: 10 },
  emptyTitle: { ...fonts.bodySemiBold, fontSize: 16, color: colors.ink, marginBottom: 4 },
  emptyMessage: { ...fonts.body, fontSize: 14, color: colors.muted, textAlign: 'center' },
  sectionLabel: {
    ...fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 24,
    marginBottom: 10,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statTile: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  statValue: { ...fonts.display, fontSize: 26, color: colors.plum },
  statLabel: { ...fonts.bodyMedium, fontSize: 12.5, color: colors.muted, marginTop: 4 },
  funnelWrap: { backgroundColor: colors.surface, borderRadius: 16, padding: 16 },
  funnelStep: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  funnelLabel: { ...fonts.bodyMedium, fontSize: 14, color: colors.ink },
  funnelCount: { ...fonts.display, fontSize: 17, color: colors.ink },
  arrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingLeft: 14 },
  arrowGlyph: { color: colors.muted, fontSize: 13 },
  rateText: { ...fonts.bodySemiBold, fontSize: 12, color: colors.accent },
});
