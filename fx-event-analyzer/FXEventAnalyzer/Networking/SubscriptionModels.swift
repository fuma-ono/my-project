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
    /// 購読中のApp Store商品(v1.8)。`POST /subscription/verify`の応答には無い。
    var productId: String? = nil

    enum CodingKeys: String, CodingKey {
        case plan, status
        case startedAt = "started_at"
        case expiresAt = "expires_at"
        case productId = "product_id"
    }

    static let free = SubscriptionResponse(plan: "FREE", status: nil, startedAt: nil, expiresAt: nil)

    var isPro: Bool { plan == "PRO" }
    /// 自動更新がオフ(期限までは有効)。
    var isCanceled: Bool { status == "CANCELED" }
}

/// `POST /api/v1/subscription/verify`(api-design.md §25.1)。StoreKit 2の
/// 署名済みJWSをそのまま送り、検証はBackendが行う。
struct SubscriptionVerifyRequest: Encodable, Equatable {
    let signedTransaction: String
    let signedRenewalInfo: String?

    enum CodingKeys: String, CodingKey {
        case signedTransaction = "signed_transaction"
        case signedRenewalInfo = "signed_renewal_info"
    }
}
