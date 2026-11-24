/**
 * 価格由来の機能(通貨ペアの価格反応・チャート・pips・レート・レートアラート)のサーバー側フラグ
 * (オーナー決定 2026-11-24: 価格反応の商用表示ライセンスが確認できるまで、利用者に価格由来の情報を返さない)。
 *
 * 環境変数 PRICE_FEATURES_ENABLED が文字列 'true' のときだけ有効。未設定・空・それ以外('1'・'TRUE' など)はすべて無効。
 * GitHub Actions のジョブにはこの変数が無いので、ジョブ(ingest:fx-prices / ingest:event-reactions /
 * jobs:evaluate-rate-alerts)は既定で何もせず正常終了する。再有効化は、この変数を明示的に設定する手動の作業。
 */
export const PRICE_FEATURES_ENV_VAR = 'PRICE_FEATURES_ENABLED';

export function parsePriceFeaturesEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export function isPriceFeaturesEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  return parsePriceFeaturesEnabled(source[PRICE_FEATURES_ENV_VAR]);
}

/**
 * ジョブ用の入口。フラグが無効なら、何も取得・書き込みをせず(run を呼ばず・DB にも接続せず)、
 * 理由 price_features_disabled をログに出して false を返す(呼び出し側は正常終了 = exit 0)。
 */
export function runIfPriceFeaturesEnabled(
  job: string,
  source: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = console.log,
): boolean {
  if (isPriceFeaturesEnabled(source)) return true;
  log(JSON.stringify({ job, skipped: 'price_features_disabled' }));
  return false;
}
