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

enum Importance: String, Decodable, Equatable {
    case low = "LOW"
    case medium = "MEDIUM"
    case high = "HIGH"
}

/// api-design.md §12: Home's `events` is day-scoped; the client splits it
/// by `status` into "今日の注目イベント" (SCHEDULED) and "最近のイベント"
/// (RELEASED) itself — there is no separate Backend field for this.
enum EventStatus: String, Decodable, Equatable {
    case scheduled = "SCHEDULED"
    case released = "RELEASED"
    case cancelled = "CANCELLED"
}

/// api-design.md §7: the API-level Data Quality state — always HTTP 200 +
/// this field, never an HTTP error.
enum DataQualityStatus: String, Decodable, Equatable {
    case ready = "READY"
    case dataPending = "DATA_PENDING"
    case dataUnavailable = "DATA_UNAVAILABLE"
    case notAnalyzable = "NOT_ANALYZABLE"
}

/// api-design.md §9: null (never 0) when Forecast or Actual is missing;
/// NEUTRAL when surprise == 0.
enum SurpriseDirection: String, Decodable, Equatable {
    case positive = "POSITIVE"
    case negative = "NEGATIVE"
    case neutral = "NEUTRAL"
}

/// api-design v1.42(HQ指示2026-10-27「経済指標・要人発言の表示不足を解消する」)。
/// `GET /calendar`(INDICATOR行)・`GET /home`の`events`・`GET /notifications/upcoming`
/// に付く。SPEECHの行・古いBackendでは項目自体が無い(nil)。
/// ケース名はSwiftの`Optional<ResultType>.none`との混同を避けるため`noValue`にした
/// (バックエンドのJSON値はそのまま`"NONE"`)。
enum ResultType: String, Decodable, Equatable {
    /// 結果の値が出る指標(CPI・雇用統計など、FOMCの会合も含む)。
    case value = "VALUE"
    /// 結果の値が出ない予定(今はFOMC議事要旨だけ、`domain/resultType.ts`)。
    case noValue = "NONE"
}

/// `ResultType`・`DataQualityStatus`から、指標の状態表示の文言を決める
/// (api-design v1.42の「表示の目安」どおり)。
enum ResultStatusDisplay {
    /// VALUEで発表時刻を過ぎてDATA_PENDINGなら「結果待ち」(値を推測で埋めない)。
    /// NONEで発表時刻を過ぎたら「公表済み」(結果の欄は出さない)。それ以外
    /// (発表前・READY・古いBackendでresult_typeが無い等)は何も表示しない。
    static func label(resultType: ResultType?, dataStatus: DataQualityStatus?, releaseDatetime: Date, now: Date = Date()) -> String? {
        guard releaseDatetime <= now else { return nil }
        switch resultType {
        case .noValue: return "公表済み"
        case .value: return dataStatus == .dataPending ? "結果待ち" : nil
        case nil: return nil
        }
    }
}

/// api-design.md §11.1: drives which timeframes are analyzable for an
/// event, independent of stored reaction data_status.
enum ReleaseDatetimePrecision: String, Decodable, Equatable {
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
struct RelatedFxPairSummary: Decodable, Identifiable, Equatable {
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
