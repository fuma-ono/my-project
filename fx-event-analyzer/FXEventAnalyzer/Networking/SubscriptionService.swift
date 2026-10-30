import Foundation

/// Talks to `GET /api/v1/subscription` and `POST /api/v1/subscription/verify`
/// (api-design.md §25). SCR-017 プラン・購読管理が使う。
struct SubscriptionService {
    let apiClient: APIClient

    func fetchSubscription() async throws -> SubscriptionResponse {
        try await apiClient.send(Endpoint(path: "subscription"))
    }

    /// StoreKitで購入・復元した購読をBackendに検証・保存させる。
    func verify(_ request: SubscriptionVerifyRequest) async throws -> SubscriptionResponse {
        let body = try JSONEncoder().encode(request)
        return try await apiClient.send(Endpoint(path: "subscription/verify", method: .post, body: body))
    }
}
