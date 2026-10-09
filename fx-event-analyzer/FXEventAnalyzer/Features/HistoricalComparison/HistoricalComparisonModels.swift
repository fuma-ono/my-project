import Foundation

/// `GET /api/v1/indicators/{indicator_id}/comparison` (api-design.md §21.1
/// — single-`timeframe` shape; this screen never requests `timeframe=all`).
struct ComparisonResponse: Decodable, Equatable {
    let indicator: ComparisonIndicatorSummary
    let fxPairId: String
    let timeframe: String
    let totalEvents: Int
    let analyzableEvents: Int
    let stats: ComparisonStats
    let advancedStatistics: AdvancedStatistics
    let events: [ComparisonEventSummary]
    let meta: PaginationMeta

    enum CodingKeys: String, CodingKey {
        case indicator
        case fxPairId = "fx_pair_id"
        case timeframe
        case totalEvents = "total_events"
        case analyzableEvents = "analyzable_events"
        case stats
        case advancedStatistics = "advanced_statistics"
        case events
        case meta
    }
}

struct ComparisonIndicatorSummary: Decodable, Equatable {
    let id: String
    let code: String
    let name: String
}

/// api-design.md §22 — Backend-computed only; DATA_PENDING/DATA_UNAVAILABLE/
/// NOT_ANALYZABLE events are never mixed in (`analyzable_events` tracks how
/// many of `total_events` actually contributed).
struct ComparisonStats: Decodable, Equatable {
    let averageMovement: Double?
    let averagePips: Double?
    let maxMovement: Double?
    let minMovement: Double?
    let upwardCount: Int
    let downwardCount: Int
    let noChangeCount: Int

    enum CodingKeys: String, CodingKey {
        case averageMovement = "average_movement"
        case averagePips = "average_pips"
        case maxMovement = "max_movement"
        case minMovement = "min_movement"
        case upwardCount = "upward_count"
        case downwardCount = "downward_count"
        case noChangeCount = "no_change_count"
    }
}

/// api-design.md §21.3 — staged disclosure: `available: false` means
/// "Entitlement不足で見られない", not "データが存在しない"; the client must
/// keep these distinct (e.g. a "Proで解放" banner, never a blank state).
struct AdvancedStatistics: Decodable, Equatable {
    let available: Bool
    let requiredEntitlement: String?
    let data: AdvancedStatisticsData?

    enum CodingKeys: String, CodingKey {
        case available
        case requiredEntitlement = "required_entitlement"
        case data
    }
}

struct AdvancedStatisticsData: Decodable, Equatable {
    let averageAbsoluteMovement: Double?
    let averageAbsolutePips: Double?

    enum CodingKeys: String, CodingKey {
        case averageAbsoluteMovement = "average_absolute_movement"
        case averageAbsolutePips = "average_absolute_pips"
    }
}

struct ComparisonEventSummary: Decodable, Identifiable, Equatable {
    let id: String
    let releaseDatetime: Date
    let forecast: Double?
    let actual: Double?
    let previous: Double?
    let surprise: Double?
    let surpriseDirection: SurpriseDirection?

    enum CodingKeys: String, CodingKey {
        case id = "event_id"
        case releaseDatetime = "release_datetime"
        case forecast
        case actual
        case previous
        case surprise
        case surpriseDirection = "surprise_direction"
    }
}
