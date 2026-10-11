import Foundation

/// `GET /api/v1/notifications/upcoming`(api-design.md §25.1)。通知設定
/// (SCR-016)の条件に合う、これから通知すべき経済指標・要人発言を
/// `notify_at`(発表の`lead_minutes`分前)の昇順で返す。プッシュ通知が
/// オフなら`items`は空。
struct UpcomingNotificationsResponse: Decodable, Equatable {
    let leadMinutes: Int
    let items: [UpcomingNotification]

    enum CodingKeys: String, CodingKey {
        case leadMinutes = "lead_minutes"
        case items
    }
}

struct UpcomingNotification: Decodable, Equatable {
    enum Kind: String, Codable {
        case indicator = "INDICATOR"
        case speech = "SPEECH"
    }

    let kind: Kind
    /// 指標は`economic_events.economic_event_id`、発言は`speech_events.speech_event_id`。
    let id: String
    let title: String
    let speakerName: String?
    /// HIGH / MEDIUM / LOW
    let importance: String
    let scheduledAt: Date
    let notifyAt: Date
    let countryCode: String?
    let currencyCode: String?
    let relatedFxPairs: [String]

    enum CodingKeys: String, CodingKey {
        case kind
        case id
        case title
        case speakerName = "speaker_name"
        case importance
        case scheduledAt = "scheduled_at"
        case notifyAt = "notify_at"
        case countryCode = "country_code"
        case currencyCode = "currency_code"
        case relatedFxPairs = "related_fx_pairs"
    }
}

/// `GET /api/v1/fx-pairs`(api-design.md §25.2)の1件。
struct FXPairResponse: Decodable, Equatable {
    let symbol: String
}

struct FXPairListResponse: Decodable, Equatable {
    let data: [FXPairResponse]
}

struct NotificationService {
    let apiClient: APIClient

    func fetchUpcoming() async throws -> UpcomingNotificationsResponse {
        try await apiClient.send(Endpoint(path: "notifications/upcoming"))
    }
}

/// `GET /fx-pairs`で通貨ペアの候補を取る`FXPairCatalog`。一覧APIが使えない
/// (古いBackend・通信失敗)ときは、シードと同じ固定値に戻す。
struct RemoteFXPairCatalog: FXPairCatalog {
    let apiClient: APIClient

    func availableSymbols() async throws -> [String] {
        do {
            let response: FXPairListResponse = try await apiClient.send(Endpoint(path: "fx-pairs"))
            let symbols = response.data.map(\.symbol)
            return symbols.isEmpty ? StaticFXPairCatalog.seededSymbols : symbols
        } catch {
            return try await StaticFXPairCatalog().availableSymbols()
        }
    }
}
