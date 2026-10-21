/**
 * Historical Comparison statistics — api-design.md §21/§22. Callers must
 * pre-filter rows to `data_status = AVAILABLE` (db-design.md §10) before
 * calling this; it does not know about data_status itself.
 */
export interface StatsInputRow {
  movement: number;
  pips: number;
}

export interface HistoricalStats {
  average_movement: number;
  average_pips: number;
  max_movement: number;
  min_movement: number;
  upward_count: number;
  downward_count: number;
  no_change_count: number;
}

export interface AdvancedHistoricalStats {
  average_absolute_movement: number;
  average_absolute_pips: number;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function computeHistoricalStats(rows: StatsInputRow[]): HistoricalStats | null {
  if (rows.length === 0) return null;

  const movements = rows.map((row) => row.movement);
  const pips = rows.map((row) => row.pips);

  return {
    average_movement: average(movements),
    average_pips: average(pips),
    max_movement: Math.max(...movements),
    min_movement: Math.min(...movements),
    upward_count: rows.filter((row) => row.pips > 0).length,
    downward_count: rows.filter((row) => row.pips < 0).length,
    no_change_count: rows.filter((row) => row.pips === 0).length,
  };
}

export function computeAdvancedHistoricalStats(rows: StatsInputRow[]): AdvancedHistoricalStats | null {
  if (rows.length === 0) return null;

  return {
    average_absolute_movement: average(rows.map((row) => Math.abs(row.movement))),
    average_absolute_pips: average(rows.map((row) => Math.abs(row.pips))),
  };
}
