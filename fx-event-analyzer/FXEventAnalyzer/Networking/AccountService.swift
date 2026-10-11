import Foundation

/// Talks to `GET/PATCH/DELETE /api/v1/account` (api-design.md §24), used by
/// SCR-015 アカウント情報 and its sub-screens.
struct AccountService {
    let apiClient: APIClient

    func fetchAccount() async throws -> AccountResponse {
        try await apiClient.send(Endpoint(path: "account"))
    }

    func updateAccount(_ update: AccountUpdate) async throws -> AccountResponse {
        let body = try JSONEncoder().encode(update)
        return try await apiClient.send(Endpoint(path: "account", method: .patch, body: body))
    }

    /// Physical deletion (§24.3, `204 No Content`). The App Store
    /// subscription is not cancelled by this — SCR-024 tells the user so.
    func deleteAccount() async throws {
        let _: EmptyResponse = try await apiClient.send(Endpoint(path: "account", method: .delete))
    }
}
