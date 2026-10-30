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
    /// 比べた回数の上限(api-design v1.37、無料3回・プレミアム20回)。古いBackendではnil。
    var historyLimit: HistoryLimit? = nil
    /// 過去の発表の制限(api-design v1.33 §21・§28.2、無料プランは直近3回)。古いBackendではnil。
    var pastReleaseLimit: PastReleaseLimit? = nil

    struct HistoryLimit: Decodable, Equatable {
        let applied: Int
        let maxForPlan: Int
        let proMax: Int

        enum CodingKeys: String, CodingKey {
            case applied
            case maxForPlan = "max_for_plan"
            case proMax = "pro_max"
        }

        /// 今のプランの上限がプレミアムより少ない(無料プラン)。
        var isLimited: Bool { maxForPlan < proMax }
    }

    enum CodingKeys: String, CodingKey {
        case historyLimit = "history_limit"
        case pastReleaseLimit = "past_release_limit"
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
    /// 一覧表示名(api-design v1.22)。古いBackendではnil。
    var displayName: String? = nil
    /// 国・通貨・単位(api-design v1.26、過去イベント比較の見出しと表に使う)。古いBackendではnil。
    var countryCode: String? = nil
    var currencyCode: String? = nil
    var unit: String? = nil

    enum CodingKeys: String, CodingKey {
        case id, code, name, unit
        case displayName = "display_name"
        case countryCode = "country_code"
        case currencyCode = "currency_code"
    }
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
    /// 1分・5分・15分のpips(api-design v1.26)。キーは"1m"/"5m"/"15m"、値が無ければnil。
    var pipsByTimeframe: [String: Double?]? = nil
    /// 副指標(api-design v1.35、HQ指示2026-10-25「前月と前年必要」)。この指標の
    /// 本来の値(例: 米国CPIはYoY%)に加えて見せる別の変換(例: MoM%)。
    /// 副指標が設定されていない指標(米国CPI以外)・古いBackendではnil。
    var secondaryValueKind: String? = nil
    var secondaryForecast: Double? = nil
    var secondaryActual: Double? = nil
    var secondaryPrevious: Double? = nil

    /// 無料プランで隠された過去の発表(api-design v1.33 §21)。値とpipsは`null`。古いBackendではnil(=隠していない)。
    var locked: Bool? = nil
    /// ロックを外すのに必要なプラン(`"PRO"`)。ロックしていなければnil。
    var requiredPlan: String? = nil

    /// ロックされた発表か。`true`のとき表は値の代わりに鍵の印を出す。
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
        case pipsByTimeframe = "pips_by_timeframe"
        case id = "event_id"
        case releaseDatetime = "release_datetime"
        case forecast
        case actual
        case previous
        case surprise
        case surpriseDirection = "surprise_direction"
        case secondaryValueKind = "secondary_value_kind"
        case secondaryForecast = "secondary_forecast"
        case secondaryActual = "secondary_actual"
        case secondaryPrevious = "secondary_previous"
    }
}
