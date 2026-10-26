import Foundation

/// `GET /api/v1/events/{event_id}` (api-design.md §14) — SCR-007's single
/// API call. Field order in this file mirrors the Response JSON, not the
/// display order (ui-screens.md §5 H-1 fixes the display order in the View).
struct EventDetailResponse: Decodable, Equatable {
    let event: EventDetailEvent
    let snapshot: EventSnapshotDetail?
    let analysis: EventAnalysis
    let explanation: EventExplanationDetail?
    let relatedFxPairs: [EventRelatedFxPair]
    let availableTimeframes: [String]
    /// 主要通貨ペアの1分・5分・15分の値動き(api-design v1.17、SCR-007の表)。古いBackendではnil。
    var majorFxReactions: [EventMajorFxReaction]? = nil

    enum CodingKeys: String, CodingKey {
        case majorFxReactions = "major_fx_reactions"
        case event
        case snapshot
        case analysis
        case explanation
        case relatedFxPairs = "related_fx_pairs"
        case availableTimeframes = "available_timeframes"
    }
}

struct EventDetailEvent: Decodable, Equatable {
    let id: String
    let indicatorId: String
    let indicatorName: String
    let countryCode: String
    let currencyCode: String
    let releaseDatetime: Date
    let releaseDatetimePrecision: ReleaseDatetimePrecision
    let importance: Importance
    let status: EventStatus
    let dataStatus: DataQualityStatus
    /// 無料プランで隠された発表(api-design v1.33 §14.1)では、古いアプリが読めるよう固定値`NONE`
    /// (以前は`null`)。実際の改定の有無ではないので、`isLocked`のときは使わない。
    let revisionStatus: RevisionStatus?
    /// 指標の一覧表示名(api-design v1.22)。古いBackendではnil。
    var displayName: String? = nil
    /// 無料プランで隠された過去の発表(api-design v1.33 §14.1)。古いBackendではnil(=隠していない)。
    var locked: Bool? = nil
    /// ロックを外すのに必要なプラン(`"PRO"`)。ロックしていなければnil。
    var requiredPlan: String? = nil

    /// ロックされた発表か。`true`のとき値・解説・値動きはBackendが`null`で返し、
    /// 子のAPI(`/revisions`・`/history`・`/reaction`・`/reaction/chart`)は403になる。
    var isLocked: Bool { locked ?? false }
    /// 「前回」だけを隠した発表(api-design v1.33 §28.2): ひとつ前の発表が無料プランでロック
    /// されているため、その結果にあたる`previous`をBackendが`null`で返す。古いBackendではnil。
    var previousLocked: Bool? = nil

    /// 「前回」を隠した発表か。`true`のとき前回は「--」ではなく鍵の印で出す。
    var isPreviousLocked: Bool { previousLocked ?? false }

    enum CodingKeys: String, CodingKey {
        case locked
        case previousLocked = "previous_locked"
        case requiredPlan = "required_plan"
        case displayName = "display_name"
        case id
        case indicatorId = "indicator_id"
        case indicatorName = "indicator_name"
        case countryCode = "country_code"
        case currencyCode = "currency_code"
        case releaseDatetime = "release_datetime"
        case releaseDatetimePrecision = "release_datetime_precision"
        case importance
        case status
        case dataStatus = "data_status"
        case revisionStatus = "revision_status"
    }
}

/// The immutable RELEASE `EventSnapshot` (api-design.md §15) — null while
/// the event hasn't released yet.
struct EventSnapshotDetail: Decodable, Equatable {
    let forecast: Double?
    let actual: Double?
    let previous: Double?
    let unit: String?
    let source: String?
    let sourceUrl: String?
    /// 副指標(api-design v1.35、HQ指示2026-10-25「結果/予想/前回も前年と前月が
    /// 必要」)。この指標の本来の値(例: 米国CPIはYoY%)に加えて見せる別の変換
    /// (例: MoM%)。副指標が設定されていない指標・古いBackendではnil。
    var secondaryValueKind: String? = nil
    var secondaryForecast: Double? = nil
    var secondaryActual: Double? = nil
    var secondaryPrevious: Double? = nil

    enum CodingKeys: String, CodingKey {
        case forecast
        case actual
        case previous
        case unit
        case source
        case sourceUrl = "source_url"
        case secondaryValueKind = "secondary_value_kind"
        case secondaryForecast = "secondary_forecast"
        case secondaryActual = "secondary_actual"
        case secondaryPrevious = "secondary_previous"
    }
}

/// api-design.md §9 — Backend-computed, never recomputed client-side.
struct EventAnalysis: Decodable, Equatable {
    let surprise: Double?
    let surpriseDirection: SurpriseDirection?

    enum CodingKeys: String, CodingKey {
        case surprise
        case surpriseDirection = "surprise_direction"
    }
}

/// api-design.md §17 — latest `EventExplanation` version. MVP: fact-based
/// summary + source, never AI-generated free text.
struct EventExplanationDetail: Decodable, Equatable {
    let summary: String?
    let source: String?
    let sourceUrl: String?

    enum CodingKeys: String, CodingKey {
        case summary
        case source
        case sourceUrl = "source_url"
    }
}

/// api-design.md §14.2 — lightweight 5m Market Reaction Summary per related
/// FX pair.
struct EventReactionSummary: Decodable, Equatable {
    let timeframe: String
    let pips: Double?
    let changePercent: Double?
    /// 無料プランで隠された発表(api-design v1.33 §14.1)では固定値`NOT_ANALYZABLE`(以前は`null`)。
    /// 画面は`EventDetailEvent.isLocked`を先に見て、隠された発表ではこの値を表示に使わない。
    let analysisStatus: DataQualityStatus?

    enum CodingKeys: String, CodingKey {
        case timeframe
        case pips
        case changePercent = "change_percent"
        case analysisStatus = "analysis_status"
    }
}

struct EventRelatedFxPair: Decodable, Identifiable, Equatable {
    let fxPairId: String
    let symbol: String
    let priority: Int
    let reaction: EventReactionSummary

    var id: String { fxPairId }

    enum CodingKeys: String, CodingKey {
        case fxPairId = "fx_pair_id"
        case symbol
        case priority
        case reaction
    }
}

/// `major_fx_reactions`の1行(通貨ペア1つ × 時間軸ごとの値動き)。
struct EventMajorFxReaction: Decodable, Identifiable, Equatable {
    let fxPairId: String
    let symbol: String
    let reactions: [EventReactionSummary]

    var id: String { fxPairId }

    func reaction(for timeframe: String) -> EventReactionSummary? {
        reactions.first { $0.timeframe == timeframe }
    }

    enum CodingKeys: String, CodingKey {
        case fxPairId = "fx_pair_id"
        case symbol
        case reactions
    }
}
