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
    /// 無料プランで隠された過去の発表(api-design v1.33 §28.2)。古いBackendではnil(=隠していない)。
    var locked: Bool? = nil
    /// ロックを外すのに必要なプラン(`"PRO"`)。ロックしていなければnil。
    var requiredPlan: String? = nil
    /// `result_type`(api-design v1.42)。古いBackendではnil。
    var resultType: ResultType? = nil

    /// ロックされた発表か。`true`のとき予想・結果・前回・サプライズはBackendが`null`で返す。
    var isLocked: Bool { locked ?? false }
    /// 「前回」だけを隠した発表(api-design v1.33 §28.2): ひとつ前の発表が無料プランでロック
    /// されているため、その結果にあたる`previous`をBackendが`null`で返す。古いBackendではnil。
    var previousLocked: Bool? = nil

    /// 「前回」を隠した発表か。`true`のとき前回は「--」ではなく鍵の印で出す。
    var isPreviousLocked: Bool { previousLocked ?? false }

    enum CodingKeys: String, CodingKey {
        case unit
        case locked
        case previousLocked = "previous_locked"
        case requiredPlan = "required_plan"
        case resultType = "result_type"
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
    /// api-design.md §12 v1.34(HQ承認 2026-10-23)。古いサーバーは返さないので optional。
    /// `speeches` が空のときの文言にだけ使う(`HomeSpeechesEmptyText`)。
    let speechesStatus: HomeSpeechesStatus?
    /// 無料プランの過去の発表の上限(api-design v1.33 §12)。古いBackendではnil。
    let pastReleaseLimit: PastReleaseLimit?

    init(
        date: String,
        timezone: String,
        events: [HomeEventSummary],
        majorFx: [MajorFxSummary],
        speeches: [HomeSpeechSummary]? = nil,
        speechesStatus: HomeSpeechesStatus? = nil,
        pastReleaseLimit: PastReleaseLimit? = nil
    ) {
        self.date = date
        self.timezone = timezone
        self.events = events
        self.majorFx = majorFx
        self.speeches = speeches
        self.speechesStatus = speechesStatus
        self.pastReleaseLimit = pastReleaseLimit
    }

    enum CodingKeys: String, CodingKey {
        case pastReleaseLimit = "past_release_limit"
        case date
        case timezone
        case events
        case majorFx = "major_fx"
        case speeches
        case speechesStatus = "speeches_status"
    }
}

/// GET /home `speeches_status`(api-design.md §12 v1.34): 要人発言の取得状況。
/// - `lastSuccessAt`: 最後に取得に成功した時刻(無ければ nil)
/// - `stale`: 取得できていない(最新の取得が失敗、または18時間以上成功していない)
struct HomeSpeechesStatus: Decodable, Equatable {
    let windowDays: Int
    let lastSuccessAt: Date?
    let stale: Bool

    enum CodingKeys: String, CodingKey {
        case windowDays = "window_days"
        case lastSuccessAt = "last_success_at"
        case stale
    }
}

/// 「直近の要人発言」カードの空状態の文言(`speeches` が0件のときだけ使う。1件以上なら表示は従来どおり)。
/// 日時の書式は呼び出し側から渡す(ホームでは表示設定のタイムゾーン・形式、`AppPreferences`)ので、
/// 文言の選び方だけを単体テストできる。
struct HomeSpeechesEmptyText: Equatable {
    let message: String
    /// 小さく出す「最終更新 …」の行。無ければ nil
    let detail: String?

    /// - status あり・stale == false → 「直近7日間の要人発言はありません」+「最終更新 …」(時刻があるときだけ)
    /// - status あり・stale == true → 「要人発言の情報を更新できていません（最終更新 …）」(時刻が無ければ括弧なし)
    /// - status なし(古いサーバー) → 「直近7日間の要人発言はありません」のみ
    static func make(status: HomeSpeechesStatus?, formatDate: (Date) -> String) -> HomeSpeechesEmptyText {
        guard let status else {
            return HomeSpeechesEmptyText(message: "直近7日間の要人発言はありません", detail: nil)
        }
        let lastSuccess = status.lastSuccessAt.map(formatDate)
        if status.stale {
            let message = lastSuccess.map { "要人発言の情報を更新できていません（最終更新 \($0)）" } ?? "要人発言の情報を更新できていません"
            return HomeSpeechesEmptyText(message: message, detail: nil)
        }
        return HomeSpeechesEmptyText(
            message: "直近\(status.windowDays)日間の要人発言はありません",
            detail: lastSuccess.map { "最終更新 \($0)" }
        )
    }
}
