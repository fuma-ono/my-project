import Foundation

/// `GET /api/v1/events/{event_id}/reaction?timeframe=all` (api-design.md
/// §18.1) — `pre_release_price` is common across timeframes and sits at
/// the top level; each timeframe's own values live in `reactions`.
struct ReactionAllTimeframesResponse: Decodable, Equatable {
    let eventId: String
    let fxPairId: String
    let preReleasePrice: Double?
    let reactions: [ReactionTimeframeEntry]

    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"
        case fxPairId = "fx_pair_id"
        case preReleasePrice = "pre_release_price"
        case reactions
    }
}

struct ReactionTimeframeEntry: Decodable, Equatable, Identifiable {
    let timeframe: String
    let postReleasePrice: Double?
    let movement: Double?
    let pips: Double?
    let changePercent: Double?
    let maxUpward: Double?
    let maxDownward: Double?
    let maxUpwardPips: Double?
    let maxDownwardPips: Double?
    let analysisStatus: DataQualityStatus

    var id: String { timeframe }

    enum CodingKeys: String, CodingKey {
        case timeframe
        case postReleasePrice = "post_release_price"
        case movement
        case pips
        case changePercent = "change_percent"
        case maxUpward = "max_upward"
        case maxDownward = "max_downward"
        case maxUpwardPips = "max_upward_pips"
        case maxDownwardPips = "max_downward_pips"
        case analysisStatus = "analysis_status"
    }
}

/// `GET /api/v1/events/{event_id}/reaction/chart` (api-design.md §19) — a
/// single timeframe's OHLC candles for the Release -30min/+60min window.
struct ChartResponse: Decodable, Equatable {
    let eventId: String
    let fxPairId: String
    let timeframe: String
    let releaseDatetime: Date
    let prices: [ChartPricePoint]

    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"
        case fxPairId = "fx_pair_id"
        case timeframe
        case releaseDatetime = "release_datetime"
        case prices
    }
}

struct ChartPricePoint: Decodable, Equatable, Identifiable {
    let timestamp: Date
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let volume: Double?

    var id: Date { timestamp }
}
