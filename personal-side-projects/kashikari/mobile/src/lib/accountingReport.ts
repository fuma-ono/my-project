import { entryFromKey, entryToKey } from './balances';
import type { Entry } from '../types';

// 会計レポート(96回目、Premium特典)。グループ横断で「月ごとに、自分が
// 支払った合計・受け取った合計」を集計する。異なる通貨は合算できない
// (為替換算はしない、というアプリ全体の一貫した方針)ため、月×通貨の
// 組み合わせごとに別の行として持つ。
//
// 精算状態(unpaid/paid/confirmed)に関わらず、記録された全てのお金の
// やりとりを集計対象にしている。これは残高計算(lib/balances.tsの
// computeMyNet)と同じ考え方で、「今何が記録されているか」をそのまま
// 反映する台帳的な集計にしている(「精算が完了したものだけ」に絞ると、
// 今月立て替えたばかりでまだ未精算の分がレポートに出ず、かえって
// 分かりにくいため)。
export type MonthlyCurrencyTotal = {
  month: string; // "YYYY-MM"
  currency: string;
  paid: number;
  received: number;
};

export function buildMonthlyReport(entries: Entry[], meId: string): MonthlyCurrencyTotal[] {
  const map = new Map<string, MonthlyCurrencyTotal>();
  for (const e of entries) {
    if (e.type !== 'money' || e.amount == null) continue;
    const month = e.created_at.slice(0, 7);
    const currency = e.currency || 'JPY';
    const key = `${month}|${currency}`;
    let row = map.get(key);
    if (!row) {
      row = { month, currency, paid: 0, received: 0 };
      map.set(key, row);
    }
    if (entryFromKey(e) === meId) row.paid += e.amount;
    else if (entryToKey(e) === meId) row.received += e.amount;
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.month !== b.month) return a.month < b.month ? 1 : -1;
    return a.currency.localeCompare(b.currency);
  });
}

// レポート画面で「◯月」の見出しにまとめるため、月をキーにグループ化する。
export function groupByMonth(rows: MonthlyCurrencyTotal[]): { month: string; rows: MonthlyCurrencyTotal[] }[] {
  const months: string[] = [];
  const byMonth = new Map<string, MonthlyCurrencyTotal[]>();
  for (const row of rows) {
    if (!byMonth.has(row.month)) {
      byMonth.set(row.month, []);
      months.push(row.month);
    }
    byMonth.get(row.month)!.push(row);
  }
  return months.map((month) => ({ month, rows: byMonth.get(month)! }));
}
