import { findMappingByCode } from '../ingestion/mappings/indicators.js';

/**
 * 経済指標の値を表示する小数の桁数(HQ指示 2026-11-02「表示桁数」、api-design v1.46)。
 *
 * - BLS から取る%の指標(CPI・コアCPI・失業率・平均時給・PPI・コアPPI)は 1(BLS の公表の桁)
 * - それ以外は null。iOS は今までの表示のまま。Eurostat などほかの取得元には当てはめない。
 *   NFP・JOLTS(千人)も null — 今の「18.0万人」の表示が、公表の桁(千人の整数)と同じなので変えない
 *
 * 保存値(event_snapshots)は丸めない。丸めるのは表示だけ(iOS、0から遠い側へ)。
 */
export function valueDecimalsForIndicator(code: string | null | undefined): number | null {
  if (!code) return null;
  const mapping = findMappingByCode(code);
  if (!mapping || mapping.unit !== 'PERCENT') return null;
  if (!mapping.providers.bls_schedule || !mapping.official.every((ref) => ref.source === 'BLS')) return null;
  return 1;
}
