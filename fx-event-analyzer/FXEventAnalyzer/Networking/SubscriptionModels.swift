import Foundation

/// `GET /api/v1/subscription` response shape (api-design.md §25). When the
/// user has no subscription row at all (never subscribed — a legitimate
/// state, not an error), the Backend reports the implicit FREE tier with
/// `status`/`startedAt`/`expiresAt` all null rather than a 404.
struct SubscriptionResponse: Decodable, Equatable {
    let plan: String
    let status: String?
    let startedAt: Date?
    let expiresAt: Date?

    enum CodingKeys: String, CodingKey {
        case plan, status
        case startedAt = "started_at"
        case expiresAt = "expires_at"
    }
}
