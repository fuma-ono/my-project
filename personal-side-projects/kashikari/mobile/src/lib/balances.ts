import type { BalanceRow, Entry, SimplifiedTransaction } from '../types';

// 相手×通貨ごとに残高を集計する。異なる通貨同士は為替レートが分からないため
// 合算・換算せず、それぞれ独立した残高として返す(Web版プロトタイプと同じ方針)。
export function computeBalances(entries: Entry[], meId: string | null): BalanceRow[] {
  const open = entries.filter((e) => !e.settled);
  const money: Record<string, { a: string; b: string; net: number; currency: string; oldestAt: string }> = {};
  const favor: Record<string, { count: number; oldestAt: string }> = {};

  for (const e of open) {
    if (e.type === 'money') {
      const currency = e.currency || 'JPY';
      const pairKey = `${[e.from_user, e.to_user].sort().join('|')}|${currency}`;
      if (!money[pairKey]) money[pairKey] = { a: e.from_user, b: e.to_user, net: 0, currency, oldestAt: e.created_at };
      const m = money[pairKey];
      m.net += e.from_user === m.a ? e.amount ?? 0 : -(e.amount ?? 0);
      if (e.created_at < m.oldestAt) m.oldestAt = e.created_at;
    } else {
      const key = `${e.from_user}→${e.to_user}`;
      if (!favor[key]) favor[key] = { count: 0, oldestAt: e.created_at };
      favor[key].count += 1;
      if (e.created_at < favor[key].oldestAt) favor[key].oldestAt = e.created_at;
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
      oldestUnsettledAt: m.oldestAt,
    });
  }
  for (const [key, { count, oldestAt }] of Object.entries(favor)) {
    const [from, to] = key.split('→');
    rows.push({
      debtor: from,
      creditor: to,
      type: 'favor',
      amount: count,
      currency: null,
      mine: !!meId && (from === meId || to === meId),
      oldestUnsettledAt: oldestAt,
    });
  }

  rows.sort((x, y) => (x.mine === y.mine ? 0 : x.mine ? -1 : 1));
  return rows;
}

// BalanceCard・未払いユーザー一覧モーダルで共通して使う「経過日数」計算。
// 記録日の翌日を「1日前」として数える(記録した当日は「今日」)。
export function daysSince(isoDate: string): number {
  const start = new Date(isoDate);
  start.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now.getTime() - start.getTime()) / 86400000));
}

export type NetTotal = { currency: string; amount: number }; // amount > 0: 受け取る / < 0: 払う

// 自分の「純額」を通貨ごとに1つの数字にまとめる(Venmo/Cash App的な、画面冒頭に
// 出す一番大事な数字)。個々の相手との内訳はcomputeBalancesの行で別途見せる。
export function computeMyNet(entries: Entry[], meId: string | null): NetTotal[] {
  if (!meId) return [];
  const totals: Record<string, number> = {};
  for (const e of entries) {
    if (e.settled || e.type !== 'money' || !e.amount) continue;
    const currency = e.currency || 'JPY';
    if (e.from_user === meId) totals[currency] = (totals[currency] || 0) + e.amount;
    else if (e.to_user === meId) totals[currency] = (totals[currency] || 0) - e.amount;
  }
  return Object.entries(totals)
    .filter(([, amount]) => Math.abs(amount) >= 0.005)
    .map(([currency, amount]) => ({ currency, amount }));
}

// 「自動精算」機能: グループ全体のお金の貸し借りを、実際の記録の組み合わせに
// こだわらず、最小限の支払い回数になるよう再計算する。
//
// 例: たろう→はなこ 1,500円、じろう→たろう 2,000円、はなこ→じろう 500円、
//     たろう→じろう 1,000円 の4件があっても、各人の「通貨ごとの純増減」だけ
//     見れば、たろう→じろう 1,000円、はなこ→じろう 500円の2件で全員の
//     残高をゼロにできる。これを「借金の単純化(debt simplification)」問題
//     と呼び、最大の債権者と最大の債務者を順番にマッチさせる貪欲法で解く
//     (真の最小回数を求めるのはNP困難だが、実用上はSplitwise等も同じ
//     貪欲法を使っており、ほとんどの場合で最小、もしくは最小に近い結果になる)。
//
// 頼みごと(favor)は「誰から誰への借り」という関係性自体に意味があり、
// お金のように無差別に付け替えられるものではないため、対象外(従来通り
// 相手ごとのペア表示のみ)。
export function computeSimplifiedSettlement(entries: Entry[]): SimplifiedTransaction[] {
  const open = entries.filter((e) => !e.settled && e.type === 'money');

  // 通貨ごとに「各人の純増減」を集計する(from_user=貸した人=受け取る側は+、
  // to_user=借りた人=払う側は-。computeMyNetと同じ向きの規約)。
  const netsByCurrency: Record<string, Record<string, number>> = {};
  for (const e of open) {
    const currency = e.currency || 'JPY';
    const amount = e.amount ?? 0;
    const nets = (netsByCurrency[currency] ??= {});
    nets[e.from_user] = (nets[e.from_user] || 0) + amount;
    nets[e.to_user] = (nets[e.to_user] || 0) - amount;
  }

  const result: SimplifiedTransaction[] = [];
  for (const [currency, nets] of Object.entries(netsByCurrency)) {
    const creditors = Object.entries(nets)
      .filter(([, v]) => v > 0.005)
      .map(([id, v]) => ({ id, amount: v }))
      .sort((a, b) => b.amount - a.amount);
    const debtors = Object.entries(nets)
      .filter(([, v]) => v < -0.005)
      .map(([id, v]) => ({ id, amount: -v }))
      .sort((a, b) => b.amount - a.amount);

    let ci = 0;
    let di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const c = creditors[ci];
      const d = debtors[di];
      const amount = Math.min(c.amount, d.amount);
      if (amount > 0.005) result.push({ debtor: d.id, creditor: c.id, amount, currency });
      c.amount -= amount;
      d.amount -= amount;
      if (c.amount < 0.005) ci++;
      if (d.amount < 0.005) di++;
    }
  }
  return result;
}
