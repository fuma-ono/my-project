import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import { useLanguage, useT } from '../i18n';
import { buildMonthlyReport, groupByMonth, type MonthlyCurrencyTotal } from '../lib/accountingReport';
import { formatMoney } from '../lib/currency';
import { usePremiumContext } from '../lib/premiumContext';
import { colors, fonts } from '../theme';
import type { Entry } from '../types';

type Props = {
  onBack: () => void;
  meId: string | null;
  entries: Entry[];
  loading: boolean;
  onOpenPremium: () => void;
};

// 会計レポート(96回目、Premium特典)。グループ横断で、月ごとに
// 「支払った合計・受け取った合計・差引」を通貨別に見せる画面。
// 無課金ユーザーにも画面自体には入れるが、中身は見せず加入導線を出す
// (CSV出力・履歴の3ヶ月制限と同じ「ボタンは見えるが実行はPremium後」の
// 出し分け方針)。
export default function ReportScreen({ onBack, meId, entries, loading, onOpenPremium }: Props) {
  const t = useT();
  const { lang } = useLanguage();
  const { isPremium } = usePremiumContext();

  const sections = meId ? groupByMonth(buildMonthlyReport(entries, meId)) : [];

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t.report.back}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
        </View>
        <Text style={styles.title}>{t.report.title}</Text>

        {!isPremium ? (
          <View style={styles.lockedCard}>
            <Ionicons name="lock-closed-outline" size={28} color={colors.plum} />
            <Text style={styles.lockedTitle}>{t.report.lockedTitle}</Text>
            <Text style={styles.lockedMessage}>{t.report.lockedMessage}</Text>
            <PrimaryButton title={t.report.upgradeButton} onPress={onOpenPremium} style={styles.upgradeButton} />
          </View>
        ) : loading ? (
          <ActivityIndicator style={styles.loading} color={colors.plum} />
        ) : sections.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>{t.report.emptyTitle}</Text>
            <Text style={styles.emptyMessage}>{t.report.emptyMessage}</Text>
          </View>
        ) : (
          sections.map(({ month, rows }) => (
            <View key={month} style={styles.monthSection}>
              <Text style={styles.monthHeading}>{formatMonthLabel(month, lang)}</Text>
              {rows.map((row) => (
                <ReportRow key={row.currency} row={row} t={t} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function ReportRow({ row, t }: { row: MonthlyCurrencyTotal; t: ReturnType<typeof useT> }) {
  const net = row.received - row.paid;
  const max = Math.max(row.paid, row.received, 1);
  return (
    <View style={styles.card}>
      {row.currency !== 'JPY' && <Text style={styles.currencyTag}>{row.currency}</Text>}
      <BarRow label={t.report.paidLabel} value={row.paid} max={max} color={colors.danger} currency={row.currency} />
      <BarRow label={t.report.receivedLabel} value={row.received} max={max} color={colors.positive} currency={row.currency} />
      <View style={styles.netRow}>
        <Text style={styles.netLabel}>{t.report.netLabel}</Text>
        <Text style={[styles.netValue, net >= 0 ? styles.netPositive : styles.netNegative]}>
          {net >= 0 ? '+' : ''}
          {formatMoney(net, row.currency)}
        </Text>
      </View>
    </View>
  );
}

function BarRow({ label, value, max, color, currency }: { label: string; value: number; max: number; color: string; currency: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <View style={styles.barRow}>
      <View style={styles.barRowHeader}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValue}>{formatMoney(value, currency)}</Text>
      </View>
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// "YYYY-MM"を「2026年9月」/「September 2026」のような見出しに変換する。
function formatMonthLabel(month: string, lang: 'ja' | 'en'): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, (m || 1) - 1, 1);
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-US', { year: 'numeric', month: 'long' }).format(date);
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  headerRow: { marginBottom: 4 },
  title: { ...fonts.display, fontSize: 26, color: colors.ink, marginTop: 4, marginBottom: 20 },
  lockedCard: {
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  lockedTitle: { ...fonts.bodySemiBold, fontSize: 16, color: colors.ink, marginTop: 4 },
  lockedMessage: { ...fonts.body, fontSize: 13.5, color: colors.muted, lineHeight: 20 },
  upgradeButton: { marginTop: 8, alignSelf: 'flex-start', paddingHorizontal: 28 },
  loading: { marginTop: 40 },
  emptyWrap: { alignItems: 'center', paddingTop: 40, gap: 6 },
  emptyTitle: { ...fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  emptyMessage: { ...fonts.body, fontSize: 13.5, color: colors.muted, textAlign: 'center' },
  monthSection: { marginBottom: 24 },
  monthHeading: { ...fonts.bodySemiBold, fontSize: 14, color: colors.ink, marginBottom: 10 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: colors.line,
    marginBottom: 10,
    gap: 10,
  },
  currencyTag: { ...fonts.bodySemiBold, fontSize: 11, color: colors.muted },
  barRow: { gap: 6 },
  barRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barLabel: { ...fonts.body, fontSize: 12.5, color: colors.muted },
  barValue: { ...fonts.bodySemiBold, fontSize: 13.5, color: colors.ink },
  barBg: { height: 8, borderRadius: 999, backgroundColor: colors.surface2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  netRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  netLabel: { ...fonts.bodySemiBold, fontSize: 13, color: colors.ink },
  netValue: { ...fonts.display, fontSize: 16 },
  netPositive: { color: colors.positive },
  netNegative: { color: colors.danger },
});
