import Foundation

/// Talks to `GET /api/v1/account` (api-design.md §24). No screen consumes
/// this yet (Phase 1 built Splash/Login/Home only) — this is the Phase 2
/// "wire Networking/APIClient to Account" connection itself; a future
/// Account screen constructs this the same way `HomeView` constructs
/// `HomeViewModel(apiClient:)`.
struct AccountService {
    let apiClient: APIClient

    func fetchAccount() async throws -> AccountResponse {
        try await apiClient.send(Endpoint(path: "account"))
    }
}
