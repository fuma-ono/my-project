import Foundation

/// Talks to `GET /api/v1/entitlements` (api-design.md §27). No screen
/// consumes this yet — see `AccountService`'s doc comment for why.
struct EntitlementsService {
    let apiClient: APIClient

    func fetchEntitlements() async throws -> EntitlementsResponse {
        try await apiClient.send(Endpoint(path: "entitlements"))
    }
}
