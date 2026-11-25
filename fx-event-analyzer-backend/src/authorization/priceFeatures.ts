import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors/ApiError.js';

/** サーバー側フラグ PRICE_FEATURES_ENABLED(config/priceFeatures.ts)。テストは buildApp の env で差し替える。 */
export function priceFeaturesEnabled(app: FastifyInstance): boolean {
  return app.env.PRICE_FEATURES_ENABLED;
}

/**
 * 価格由来のエンドポイント(反応・チャート・戦略分析・レートアラート)用。フラグが無効なら、権限・DB の確認より前に
 * 既存の NOT_FOUND(404)で打ち切る(価格由来のデータを読まない。新しいエラーコードは足さない)。
 */
export function requirePriceFeatures(app: FastifyInstance): void {
  if (!priceFeaturesEnabled(app)) {
    throw ApiError.notFound();
  }
}
