import type { Entry } from '../types';

type DayLabels = { today: string; yesterday: string };

function dayLabel(iso: string, labels: DayLabels): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return labels.today;
  if (diffDays === 1) return labels.yesterday;
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// Venmo/Cash Appの「アクティビティフィード」のように、日付ごとに見出しを付けて
// 台帳をグルーピングする。entriesは呼び出し側で既に新しい順にソートされている前提。
// 「今日」「昨日」の文言は言語によって変わるため、呼び出し側(画面)から
// useT()経由で渡してもらう(このファイルはコンポーネントではないので
// フックを直接呼べない)。
export function groupEntriesByDate(entries: Entry[], labels: DayLabels): { title: string; data: Entry[] }[] {
  const groups: { title: string; data: Entry[] }[] = [];
  for (const e of entries) {
    const title = dayLabel(e.created_at, labels);
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.data.push(e);
    else groups.push({ title, data: [e] });
  }
  return groups;
}
