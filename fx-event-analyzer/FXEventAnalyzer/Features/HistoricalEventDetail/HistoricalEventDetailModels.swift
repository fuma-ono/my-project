import Foundation

/// `GET /api/v1/events/{event_id}/history` (api-design.md §20).
struct HistoricalEventDetailResponse: Decodable, Equatable {
    let indicatorId: String
    let event: HistoricalEventSummary
    let snapshot: HistoricalSnapshot?
    let explanation: EventExplanationDetail?
    let relatedFxPairs: [HistoricalRelatedFxPair]

    enum CodingKeys: String, CodingKey {
        case indicatorId = "indicator_id"
        case event
        case snapshot
        case explanation
        case relatedFxPairs = "related_fx_pairs"
    }
}

struct HistoricalEventSummary: Decodable, Equatable {
    let id: String
    let indicatorName: String
    let releaseDatetime: Date
    let importance: Importance

    enum CodingKeys: String, CodingKey {
        case id
        case indicatorName = "indicator_name"
        case releaseDatetime = "release_datetime"
        case importance
    }
}

struct HistoricalSnapshot: Decodable, Equatable {
    let forecast: Double?
    let actual: Double?
    let previous: Double?
    let surprise: Double?
    let surpriseDirection: SurpriseDirection?

    enum CodingKeys: String, CodingKey {
        case forecast
        case actual
        case previous
        case surprise
        case surpriseDirection = "surprise_direction"
    }
}

/// A single timeframe's reaction — Release前/後価格・pips・%・最大上昇/下落,
/// each tagged with `analysis_status` (api-design.md §7.1).
struct HistoricalReaction: Decodable, Equatable, Identifiable {
    let timeframe: String
    let preReleasePrice: Double?
    let postReleasePrice: Double?
    let pips: Double?
    let changePercent: Double?
    let analysisStatus: DataQualityStatus

    var id: String { timeframe }

    enum CodingKeys: String, CodingKey {
        case timeframe
        case preReleasePrice = "pre_release_price"
        case postReleasePrice = "post_release_price"
        case pips
        case changePercent = "change_percent"
        case analysisStatus = "analysis_status"
    }
}

struct HistoricalRelatedFxPair: Decodable, Identifiable, Equatable {
    let fxPairId: String
    let symbol: String
    let reactions: [HistoricalReaction]

    var id: String { fxPairId }

    enum CodingKeys: String, CodingKey {
        case fxPairId = "fx_pair_id"
        case symbol
        case reactions
    }
}
