import { formatMoney } from './currency';
import type { SimplifiedTransaction } from '../types';

// 自動精算プランを、LINE等にそのまま貼り付けられるテキストに変換する。
// 「相手がkashikariを使っていなくても共有できること」が要件のため、
// アプリ固有のリンクやフォーマットには依存しない、ただの読みやすい
// テキストにしている。実際の送信はOS標準の共有シート(Share.share)に
// 任せる(LINEを含め、端末に入っているどのアプリにも送れる)。
export function buildSettlementShareText(
  groupName: string,
  transactions: SimplifiedTransaction[],
  nameOf: (id: string) => string,
  labels: { heading: (groupName: string) => string; closing: string }
): string {
  const body = transactions
    .map((tx) => `${nameOf(tx.debtor)} → ${nameOf(tx.creditor)}\n${formatMoney(tx.amount, tx.currency)}`)
    .join('\n\n');
  return `${labels.heading(groupName)}\n\n${body}\n\n${labels.closing}`;
}
