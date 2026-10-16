import Foundation

/// Talks to `GET/PATCH /api/v1/settings` (api-design.md §24.4/§24.5).
struct SettingsService {
    let apiClient: APIClient

    func fetchSettings() async throws -> SettingsResponse {
        try await apiClient.send(Endpoint(path: "settings"))
    }

    func updateSettings(_ update: SettingsUpdate) async throws -> SettingsResponse {
        let body = try JSONEncoder().encode(update)
        return try await apiClient.send(Endpoint(path: "settings", method: .patch, body: body))
    }
}
