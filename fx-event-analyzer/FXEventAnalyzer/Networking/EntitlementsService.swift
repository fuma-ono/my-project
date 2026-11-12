import Foundation

/// Talks to `GET /api/v1/entitlements` (api-design.md §27). `PlanStore` reads
/// the plan and its limits from it (v1.15).
struct EntitlementsService {
    let apiClient: APIClient

    /// `timezone`はカレンダーの範囲(月初・年初)を計算するタイムゾーン。
    func fetchEntitlements(timezone: String? = nil) async throws -> EntitlementsResponse {
        let query = timezone.map { [URLQueryItem(name: "timezone", value: $0)] } ?? []
        return try await apiClient.send(Endpoint(path: "entitlements", queryItems: query))
    }
}
