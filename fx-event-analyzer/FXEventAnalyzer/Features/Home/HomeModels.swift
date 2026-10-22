import Foundation

/// `GET /api/v1/home`'s Event shape (api-design.md §12), in full —
/// Phase 3 SCR-004 needs every field the card/state rules
/// (ui-screens.md §5 SCR-004) reference: Forecast/Actual/Previous/Surprise,
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
    /// 一覧表示名(api-design v1.21)。古いBackendではnil。
    var displayName: String? = nil
    /// 指標の単位(API v1.13、例: `%`・`千人`)。返さない古いBackendではnil。
    var unit: String? = nil
    /// 無料プランで隠された過去の発表(api-design v1.31 §28.2)。古いBackendではnil(=隠していない)。
    var locked: Bool? = nil
    /// ロックを外すのに必要なプラン(`"PRO"`)。ロックしていなければnil。
    var requiredPlan: String? = nil

    /// ロックされた発表か。`true`のとき予想・結果・前回・サプライズはBackendが`null`で返す。
    var isLocked: Bool { locked ?? false }

    enum CodingKeys: String, CodingKey {
        case unit
        case locked
        case requiredPlan = "required_plan"
        case displayName = "display_name"
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
    /// HQ指示(2026-10-06)「直近の要人発言に何か表示されるようにして」:
    /// `SpeechEvent`はdb-design.md/features.mdでP2(今回のテーブル設計対象外)
    /// と明示されており、実際の`/home`ルート(src/routes/*.ts)はこの
    /// フィールドを返さない — そのためoptionalで、欠けていれば`nil`のまま
    /// (`HomeViewModel.recentSpeeches`は引き続き空配列)。CIのUI
    /// スクリーンショット用モックサーバー(`ui-screenshot-mock-server.mjs`)
    /// だけがこのフィールドを含む応答を返し、本番のバックエンドの挙動は
    /// 変えていない。
    let speeches: [HomeSpeechSummary]?
    /// 無料プランの過去の発表の上限(api-design v1.31 §12)。古いBackendではnil。
    let pastReleaseLimit: PastReleaseLimit?

    init(date: String, timezone: String, events: [HomeEventSummary], majorFx: [MajorFxSummary], speeches: [HomeSpeechSummary]? = nil, pastReleaseLimit: PastReleaseLimit? = nil) {
        self.date = date
        self.timezone = timezone
        self.events = events
        self.majorFx = majorFx
        self.speeches = speeches
        self.pastReleaseLimit = pastReleaseLimit
    }

    enum CodingKeys: String, CodingKey {
        case pastReleaseLimit = "past_release_limit"
        case date
        case timezone
        case events
        case majorFx = "major_fx"
        case speeches
    }
}
