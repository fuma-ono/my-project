import Foundation

/// Shared enums mirrored from db-design.md / api-design.md that recur
/// across Home / Indicators / Event Detail / Historical Event Detail DTOs.
/// Kept together rather than duplicated per-screen-model file.

/// api-design.md §11: the fixed MVP timeframe set. BEFORE is never a
/// timeframe — pre-release price is tracked separately as
/// `pre_release_price`.
enum ReactionTimeframe {
    static let all = ["1m", "5m", "15m", "30m", "60m"]
    static let `default` = "5m"
}

// HQ決定(2026-10-21「起動の遅れの改善A1」)対応で`Decodable`から`Codable`へ
// 変更した5つのenumは、`/home`の応答を端末に保存する`HomeSnapshotStore`が
// 保存のために`Encodable`を必要とするため。rawValueのString enumのため
// `Encodable`追加はいずれも既存の挙動に影響しない(読み込み側のAPI応答の
// 解釈は変えていない)。

enum Importance: String, Codable, Equatable {
    case low = "LOW"
    case medium = "MEDIUM"
    case high = "HIGH"
}

/// api-design.md §12: Home's `events` is day-scoped; the client splits it
/// by `status` into "今日の注目イベント" (SCHEDULED) and "最近のイベント"
/// (RELEASED) itself — there is no separate Backend field for this.
enum EventStatus: String, Codable, Equatable {
    case scheduled = "SCHEDULED"
    case released = "RELEASED"
    case cancelled = "CANCELLED"
}

/// api-design.md §7: the API-level Data Quality state — always HTTP 200 +
/// this field, never an HTTP error.
enum DataQualityStatus: String, Codable, Equatable {
    case ready = "READY"
    case dataPending = "DATA_PENDING"
    case dataUnavailable = "DATA_UNAVAILABLE"
    case notAnalyzable = "NOT_ANALYZABLE"
}

/// api-design.md §9: null (never 0) when Forecast or Actual is missing;
/// NEUTRAL when surprise == 0.
enum SurpriseDirection: String, Codable, Equatable {
    case positive = "POSITIVE"
    case negative = "NEGATIVE"
    case neutral = "NEUTRAL"
}

/// api-design.md §11.1: drives which timeframes are analyzable for an
/// event, independent of stored reaction data_status.
enum ReleaseDatetimePrecision: String, Codable, Equatable {
    case exact = "EXACT"
    case approximate = "APPROXIMATE"
    case dateOnly = "DATE_ONLY"
    case unknown = "UNKNOWN"
}

/// api-design.md §14.3: Backend-computed (not a stored column) — NONE vs
/// REVISED based on whether any EventRevision rows exist for the event.
enum RevisionStatus: String, Decodable, Equatable {
    case none = "NONE"
    case revised = "REVISED"
}

/// db-design.md line 158: drives Surprise's POSITIVE/NEGATIVE/NEUTRAL sign
/// interpretation (api-design.md §9) — never inferred from sign alone.
enum FavorableDirection: String, Decodable, Equatable {
    case higherIsPositive = "HIGHER_IS_POSITIVE"
    case lowerIsPositive = "LOWER_IS_POSITIVE"
    case neutral = "NEUTRAL"
}

/// api-design.md §14.2 / §12: a lightweight FX pair reference attached to
/// an Indicator or Event, with priority determining display order (lower
/// first) — the same shape appears on Home events, Event Detail, and
/// Indicator Detail.
struct RelatedFxPairSummary: Codable, Identifiable, Equatable {
    let fxPairId: String
    let symbol: String
    let priority: Int

    var id: String { fxPairId }

    enum CodingKeys: String, CodingKey {
        case fxPairId = "fx_pair_id"
        case symbol
        case priority
    }
}
