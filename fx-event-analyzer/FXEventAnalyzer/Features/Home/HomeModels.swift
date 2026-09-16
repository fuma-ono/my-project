import Foundation

/// Minimal slice of `GET /api/v1/home`'s Event shape (api-design.md §12) —
/// only the fields Phase 1's list row needs. Forecast/Actual/Previous/
/// Surprise/related_fx_pairs etc. are Phase 3's concern (Event Detail) and
/// deliberately not modeled here yet, per "過剰な抽象化は禁止".
struct HomeEventSummary: Decodable, Identifiable, Equatable {
    let id: String
    let indicatorName: String
    let releaseDatetime: Date
    let status: String

    enum CodingKeys: String, CodingKey {
        case id = "event_id"
        case indicatorName = "indicator_name"
        case releaseDatetime = "release_datetime"
        case status
    }
}

struct HomeResponse: Decodable {
    let events: [HomeEventSummary]
}
