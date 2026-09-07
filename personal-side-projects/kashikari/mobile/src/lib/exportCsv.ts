import { entryFromKey, entryToKey } from './balances';
import type { Entry } from '../types';

// CSV出力(94回目、Premium特典)。相手がkashikariを使っていなくても
// 開ける形式にしたい共有系機能(lib/shareText.ts)と同じ考え方で、
// 特別なライブラリを足さず、標準のOS共有シート(Share.share)に
// プレーンテキストとして渡すだけのCSV文字列を作る。表計算ソフトに
// 貼り付ければそのまま列として認識される。
function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

const STATUS_LABEL: Record<Entry['settle_status'], string> = {
  unpaid: '未精算',
  paid: '支払済み・確認待ち',
  confirmed: '精算完了',
};

export function buildEntriesCsv(entries: Entry[], nameOf: (id: string) => string): string {
  const header = ['日付', '種類', '支払った人', '受け取る人', '金額', '通貨', '状態', 'メモ'];
  const rows = entries
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((e) => [
      new Date(e.created_at).toLocaleDateString('ja-JP'),
      e.type === 'money' ? 'お金' : '頼みごと',
      nameOf(entryFromKey(e)),
      nameOf(entryToKey(e)),
      e.amount != null ? String(e.amount) : '',
      e.currency ?? '',
      STATUS_LABEL[e.settle_status],
      e.description ?? '',
    ]);
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}
