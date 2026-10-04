import Foundation

/// Talks to `GET /api/v1/subscription` (api-design.md §25). No screen
/// consumes this yet — see `AccountService`'s doc comment for why.
struct SubscriptionService {
    let apiClient: APIClient

    func fetchSubscription() async throws -> SubscriptionResponse {
        try await apiClient.send(Endpoint(path: "subscription"))
    }
}
