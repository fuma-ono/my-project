/**
 * Surprise calculation — api-design.md §9, db-design.md §5. Backend is the
 * sole Source of Truth (api-design.md §8); this function is written so the
 * same logic can be reused by the future Ingestion Worker (Phase 6) that
 * actually writes these values into event_snapshots.
 */

export type SurpriseDirection = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
export type FavorableDirection = 'HIGHER_IS_POSITIVE' | 'LOWER_IS_POSITIVE' | 'NEUTRAL';

export interface SurpriseResult {
  surprise: number | null;
  direction: SurpriseDirection | null;
}

/**
 * surprise = actual - forecast. null (never 0) when either input is
 * missing. surprise === 0 is NEUTRAL, distinct from "cannot be computed"
 * (db-design.md §5).
 */
export function calculateSurprise(
  forecast: number | null,
  actual: number | null,
  favorableDirection: FavorableDirection,
): SurpriseResult {
  if (forecast === null || actual === null) {
    return { surprise: null, direction: null };
  }

  const surprise = actual - forecast;

  if (surprise === 0) {
    return { surprise, direction: 'NEUTRAL' };
  }

  if (favorableDirection === 'NEUTRAL') {
    return { surprise, direction: 'NEUTRAL' };
  }

  if (favorableDirection === 'HIGHER_IS_POSITIVE') {
    return { surprise, direction: surprise > 0 ? 'POSITIVE' : 'NEGATIVE' };
  }

  // LOWER_IS_POSITIVE
  return { surprise, direction: surprise < 0 ? 'POSITIVE' : 'NEGATIVE' };
}
