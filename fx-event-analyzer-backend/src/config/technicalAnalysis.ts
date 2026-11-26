/**
 * テクニカル分析 API(GET /fx-pairs/{id}/technical)のサーバー側フラグ(オーナー決定 2026-11-25: 価格の商用権利と
 * テクニカル・AI の検証が揃うまで本番公開しない)。
 *
 * 環境変数 TECHNICAL_ANALYSIS_ENABLED が文字列 'true' のときだけ有効。未設定・空・それ以外('1'・'TRUE' など)はすべて無効。
 * テクニカル分析は価格から作るので、PRICE_FEATURES_ENABLED も true のときだけ使える(authorization/technicalAnalysis.ts)。
 * さらに、データ源の権利の台帳(domain/technical/rightsRegistry.ts)が確認済みでなければ、フラグが true でも閉じたまま。
 */
export const TECHNICAL_ANALYSIS_ENV_VAR = 'TECHNICAL_ANALYSIS_ENABLED';

export function parseTechnicalAnalysisEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export function isTechnicalAnalysisEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  return parseTechnicalAnalysisEnabled(source[TECHNICAL_ANALYSIS_ENV_VAR]);
}
