import type { BalanceRow, Entry } from '../types';

// 相手×通貨ごとに残高を集計する。異なる通貨同士は為替レートが分からないため
// 合算・換算せず、それぞれ独立した残高として返す(Web版プロトタイプと同じ方針)。
export function computeBalances(entries: Entry[], meId: string | null): BalanceRow[] {
  const open = entries.filter((e) => !e.settled);
  const money: Record<string, { a: string; b: string; net: number; currency: string }> = {};
  const favor: Record<string, number> = {};

  for (const e of open) {
    if (e.type === 'money') {
      const currency = e.currency || 'JPY';
      const pairKey = `${[e.from_user, e.to_user].sort().join('|')}|${currency}`;
      if (!money[pairKey]) money[pairKey] = { a: e.from_user, b: e.to_user, net: 0, currency };
      const m = money[pairKey];
      m.net += e.from_user === m.a ? e.amount ?? 0 : -(e.amount ?? 0);
    } else {
      const key = `${e.from_user}→${e.to_user}`;
      favor[key] = (favor[key] || 0) + 1;
    }
  }

  const rows: BalanceRow[] = [];
  for (const m of Object.values(money)) {
    if (Math.abs(m.net) < 0.005) continue;
    const creditor = m.net > 0 ? m.a : m.b;
    const debtor = m.net > 0 ? m.b : m.a;
    rows.push({
      debtor,
      creditor,
      type: 'money',
      amount: Math.abs(m.net),
      currency: m.currency,
      mine: !!meId && (debtor === meId || creditor === meId),
    });
  }
  for (const [key, count] of Object.entries(favor)) {
    const [from, to] = key.split('→');
    rows.push({ debtor: from, creditor: to, type: 'favor', amount: count, currency: null, mine: !!meId && (from === meId || to === meId) });
  }

  rows.sort((x, y) => (x.mine === y.mine ? 0 : x.mine ? -1 : 1));
  return rows;
}
