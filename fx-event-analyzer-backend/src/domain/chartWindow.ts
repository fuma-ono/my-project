// SCR-008 相場反応詳細のチャートの表示範囲(HQ指示 2026-10-09)。発表時刻を基準に、
// 時間足ごとに範囲を変える。1分足は初動(前後15分)、5分足は短期の流れ(前後60分)、
// 15分足は全体の流れ(前後3時間)。それ以外の時間足は従来どおり前30分〜後60分。
const WINDOW_MINUTES: Record<string, { before: number; after: number }> = {
  '1m': { before: 15, after: 15 },
  '5m': { before: 60, after: 60 },
  '15m': { before: 180, after: 180 },
};

const DEFAULT_WINDOW = { before: 30, after: 60 };

export function chartWindow(releaseDatetime: string, timeframe: string): { from: string; to: string } {
  const release = new Date(releaseDatetime).getTime();
  const { before, after } = WINDOW_MINUTES[timeframe] ?? DEFAULT_WINDOW;
  return {
    from: new Date(release - before * 60_000).toISOString(),
    to: new Date(release + after * 60_000).toISOString(),
  };
}
