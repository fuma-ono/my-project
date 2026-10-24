import Foundation

/// `GET /calendar`(api-design.md v1.14)。SCR-010 経済カレンダーの、期間内の
/// 経済指標と要人発言を発表・発言の時刻順に並べた一覧。
struct CalendarResponse: Decodable, Equatable {
    let items: [CalendarItem]
}

struct CalendarItem: Decodable, Equatable, Identifiable {
    enum Kind: String, Decodable, Equatable {
        case indicator = "INDICATOR"
        case speech = "SPEECH"
    }

    let kind: Kind
    let id: String
    /// 指標の行の指標ID(api-design v1.16)。発言と古いBackendではnil。
    var indicatorId: String? = nil
    /// 指標の一覧表示名(api-design v1.21)。発言と古いBackendではnil。
    var displayName: String? = nil
    let title: String
    let speakerName: String?
    let countryCode: String
    let currencyCode: String
    let importance: Importance
    let datetime: Date
    /// 指標は`release_datetime_precision`、発言は常に`EXACT`。
    let datetimePrecision: ReleaseDatetimePrecision?
    /// 指標と発言で値の種類が違う(`RELEASED`/`DELIVERED`など)ので文字列のまま持つ。
    let status: String

    enum CodingKeys: String, CodingKey {
        case kind, id, title, importance, datetime, status
        case speakerName = "speaker_name"
        case indicatorId = "indicator_id"
        case displayName = "display_name"
        case countryCode = "country_code"
        case currencyCode = "currency_code"
        case datetimePrecision = "datetime_precision"
    }

    var route: AppRoute {
        switch kind {
        // HQ指示(2026-10-24)「カレンダーからはイベント詳細に遷移してほしい」:
        // 2026-10-09に指標詳細へ変更したが、具体的な発表(イベントID・日付)の
        // 情報が失われ、タップした日の相場反応詳細(SCR-008)へ進めなくなって
        // いたため戻す。指標の行はイベント詳細へ(RELEASED済みならそこから
        // 「相場反応詳細」へ進める)。
        case .indicator: return .eventDetail(id: id)
        case .speech: return .speechDetail(id: id)
        }
    }

    /// 時刻が決まっていない指標(日付のみ・不明)は時刻を出さない。
    var hasTime: Bool {
        switch datetimePrecision {
        case .dateOnly, .unknown: return false
        default: return true
        }
    }
}

struct CalendarService {
    let apiClient: APIClient

    func fetch(from: Date, to: Date, timeZone: TimeZone = .current) async throws -> CalendarResponse {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return try await apiClient.send(Endpoint(
            path: "calendar",
            queryItems: [
                URLQueryItem(name: "from", value: formatter.string(from: from)),
                URLQueryItem(name: "to", value: formatter.string(from: to)),
                // 範囲の上限(先月の1日など)を表示設定のタイムゾーンで判定してもらう(v1.15、2026-10-15から表示設定)。
                URLQueryItem(name: "timezone", value: timeZone.identifier),
            ]
        ))
    }
}
