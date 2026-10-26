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
/// here filtered to `status=RELEASED` for SCR-006's "最近の発表結果" list,
/// each row tappable to SCR-007 イベント詳細(旧「過去イベント詳細」は
/// HQ指示2026-10-03で削除、過去の発表回もイベント詳細に遷移する)。
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
    /// 無料プランで隠された過去の発表(api-design v1.33 §13.3)。古いBackendではnil(=隠していない)。
    var locked: Bool? = nil
    /// ロックを外すのに必要なプラン(`"PRO"`)。ロックしていなければnil。
    var requiredPlan: String? = nil

    /// ロックされた発表か。`true`のとき予想・結果・前回・サプライズはBackendが`null`で返す。
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
    /// 無料プランの過去の発表の上限(api-design v1.33 §13.3)。古いBackendではnil。
    var pastReleaseLimit: PastReleaseLimit? = nil

    enum CodingKeys: String, CodingKey {
        case data
        case meta
        case pastReleaseLimit = "past_release_limit"
    }
}

/// `GET /indicators/{id}/events`・`GET /home`の`past_release_limit`(api-design v1.33 §13.3)。
struct PastReleaseLimit: Decodable, Equatable {
    /// このプランで古い発表を隠しているとき`true`(FREE)。
    let applied: Bool
    /// このプランで値を見られる回数。nilは上限なし。
    let maxForPlan: Int?
    /// PROの回数。nilは上限なし。
    let proMax: Int?

    enum CodingKeys: String, CodingKey {
        case applied
        case maxForPlan = "max_for_plan"
        case proMax = "pro_max"
    }
}
