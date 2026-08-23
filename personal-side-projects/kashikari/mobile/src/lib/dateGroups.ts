import type { Entry } from '../types';

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return '今日';
  if (diffDays === 1) return '昨日';
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// Venmo/Cash Appの「アクティビティフィード」のように、日付ごとに見出しを付けて
// 台帳をグルーピングする。entriesは呼び出し側で既に新しい順にソートされている前提。
export function groupEntriesByDate(entries: Entry[]): { title: string; data: Entry[] }[] {
  const groups: { title: string; data: Entry[] }[] = [];
  for (const e of entries) {
    const title = dayLabel(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.data.push(e);
    else groups.push({ title, data: [e] });
  }
  return groups;
}
