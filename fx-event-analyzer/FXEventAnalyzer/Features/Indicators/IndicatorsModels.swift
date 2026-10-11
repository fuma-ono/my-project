import Foundation

/// `GET /api/v1/indicators` row (api-design.md §13.1) — the list only ever
/// contains active indicators (Backend filters `is_active = true`), so no
/// separate active-state field is modeled.
struct IndicatorSummary: Decodable, Identifiable, Equatable {
    let id: String
    let code: String
    let name: String
    let countryCode: String
    let currencyCode: String
    let importance: Importance
    let description: String?
    let frequency: String
    let unit: String?
    let source: String?
    let sourceUrl: String?
    let favorableDirection: FavorableDirection
    /// 英語名(api-design v1.16、SCR-006の名前の下)。古いBackendではnil。
    var nameEn: String? = nil
    /// 注目される理由(SCR-006の箇条書き)。古いBackendではnil。
    var keyPoints: [String]? = nil
    /// 一般的な見方(api-design v1.18、SCR-008の分析)。結果が予想を上回った/下回ったときに
    /// 一般にどう動きやすいとされるか。人が書いた文で、今回の原因と断定するものではない。
    var marketViewAbove: String? = nil
    var marketViewBelow: String? = nil

    enum CodingKeys: String, CodingKey {
        case marketViewAbove = "market_view_above"
        case marketViewBelow = "market_view_below"
        case nameEn = "name_en"
        case keyPoints = "key_points"
        case id
        case code
        case name
        case countryCode = "country_code"
        case currencyCode = "currency_code"
        case importance
        case description
        case frequency
        case unit
        case source
        case sourceUrl = "source_url"
        case favorableDirection = "favorable_direction"
    }
}

struct IndicatorsListResponse: Decodable {
    let data: [IndicatorSummary]
    let meta: PaginationMeta
}
