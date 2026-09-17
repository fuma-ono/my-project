import Foundation

/// `GET /api/v1/events/{event_id}` (api-design.md §14) — SCR-004's single
/// API call. Field order in this file mirrors the Response JSON, not the
/// display order (ui-screens.md §5 H-1 fixes the display order in the View).
struct EventDetailResponse: Decodable, Equatable {
    let event: EventDetailEvent
    let snapshot: EventSnapshotDetail?
    let analysis: EventAnalysis
    let explanation: EventExplanationDetail?
    let relatedFxPairs: [EventRelatedFxPair]
    let availableTimeframes: [String]

    enum CodingKeys: String, CodingKey {
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
    let revisionStatus: RevisionStatus

    enum CodingKeys: String, CodingKey {
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

    enum CodingKeys: String, CodingKey {
        case forecast
        case actual
        case previous
        case unit
        case source
        case sourceUrl = "source_url"
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
    let analysisStatus: DataQualityStatus

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
