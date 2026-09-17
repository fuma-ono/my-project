import Foundation

/// `GET /api/v1/indicators/{id}` (api-design.md §13.2).
struct IndicatorDetailResponse: Decodable {
    let indicator: IndicatorSummary
    let relatedFxPairs: [RelatedFxPairSummary]

    enum CodingKeys: String, CodingKey {
        case indicator
        case relatedFxPairs = "related_fx_pairs"
    }
}

/// `GET /api/v1/indicators/{id}/events` row (api-design.md §13.3) — used
/// here filtered to `status=RELEASED` for SCR-003's "最近の発表結果" list,
/// each row tappable to SCR-007 Historical Event Detail.
struct IndicatorEventSummary: Decodable, Identifiable, Equatable {
    let id: String
    let releaseDatetime: Date
    let status: EventStatus
    let dataStatus: DataQualityStatus
    let forecast: Double?
    let actual: Double?
    let previous: Double?
    let surprise: Double?
    let surpriseDirection: SurpriseDirection?

    enum CodingKeys: String, CodingKey {
        case id = "event_id"
        case releaseDatetime = "release_datetime"
        case status
        case dataStatus = "data_status"
        case forecast
        case actual
        case previous
        case surprise
        case surpriseDirection = "surprise_direction"
    }
}

struct IndicatorEventsListResponse: Decodable {
    let data: [IndicatorEventSummary]
    let meta: PaginationMeta
}
