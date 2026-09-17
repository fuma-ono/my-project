import Foundation

/// `GET /api/v1/home`'s Event shape (api-design.md §12), in full —
/// Phase 3 SCR-001 needs every field the card/state rules
/// (ui-screens.md §5 SCR-001) reference: Forecast/Actual/Previous/Surprise,
/// country/currency/importance for the card header, and related_fx_pairs
/// for the "関連通貨ペア" row.
struct HomeEventSummary: Decodable, Identifiable, Equatable {
    let id: String
    let indicatorId: String
    let indicatorName: String
    let countryCode: String
    let currencyCode: String
    let importance: Importance
    let releaseDatetime: Date
    let releaseDatetimePrecision: ReleaseDatetimePrecision
    let status: EventStatus
    let dataStatus: DataQualityStatus
    let forecast: Double?
    let actual: Double?
    let previous: Double?
    let surprise: Double?
    let surpriseDirection: SurpriseDirection?
    let relatedFxPairs: [RelatedFxPairSummary]

    enum CodingKeys: String, CodingKey {
        case id = "event_id"
        case indicatorId = "indicator_id"
        case indicatorName = "indicator_name"
        case countryCode = "country_code"
        case currencyCode = "currency_code"
        case importance
        case releaseDatetime = "release_datetime"
        case releaseDatetimePrecision = "release_datetime_precision"
        case status
        case dataStatus = "data_status"
        case forecast
        case actual
        case previous
        case surprise
        case surpriseDirection = "surprise_direction"
        case relatedFxPairs = "related_fx_pairs"
    }
}

/// api-design.md §12 `major_fx` — "主要通貨ペアの動向" row. No live price
/// feed exists yet (Ingestion Worker is a later phase), so `price`/`change`
/// can legitimately be null for a pair with no stored candle; the UI must
/// not fabricate a value for that case.
struct MajorFxSummary: Decodable, Identifiable, Equatable {
    let fxPairId: String
    let symbol: String
    let price: Double?
    let change: Double?
    let changePercent: Double?
    let timestamp: Date?

    var id: String { fxPairId }

    enum CodingKeys: String, CodingKey {
        case fxPairId = "fx_pair_id"
        case symbol
        case price
        case change
        case changePercent = "change_percent"
        case timestamp
    }
}

struct HomeResponse: Decodable {
    let date: String
    let timezone: String
    let events: [HomeEventSummary]
    let majorFx: [MajorFxSummary]

    enum CodingKeys: String, CodingKey {
        case date
        case timezone
        case events
        case majorFx = "major_fx"
    }
}
