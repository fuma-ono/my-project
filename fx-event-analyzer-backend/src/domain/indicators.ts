/**
 * SCR-006 指標詳細 (api-design.md §13.1 / §13.2): the indicator object's
 * `key_points` (注目される理由) is always an array in API responses —
 * `economic_indicators.key_points` NULL (未登録) is returned as `[]`, so the
 * client only has to handle "empty list". `name_en` stays nullable.
 */
export function normalizeKeyPoints(keyPoints: readonly string[] | null | undefined): string[] {
  return keyPoints ? [...keyPoints] : [];
}
