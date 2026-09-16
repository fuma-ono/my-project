import Combine
import Foundation

enum HomeState: Equatable {
    case loading
    /// No Backend exists yet (Phase 6) — distinct from a real failure.
    /// HQ's explicit Phase 1 instruction: "API未接続状態は明示的に扱う".
    case backendNotConfigured
    case loaded([HomeEventSummary])
    case error(String)
}

/// SCR-001 Home shell. Phase 1 builds the state machine and UI only — there
/// is no Backend to actually return events yet, so this will realistically
/// always resolve to `.backendNotConfigured` until Phase 6. No fake/sample
/// production data is substituted for a real response; see
/// `HomeModels.swift` for the DTOs this decodes against once a Backend
/// exists.
@MainActor
final class HomeViewModel: ObservableObject {
    @Published private(set) var state: HomeState = .loading

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    private func fetch() async {
        let today = Self.isoDateFormatter.string(from: Date())
        let timezone = TimeZone.current.identifier
        let endpoint = Endpoint(
            path: "home",
            queryItems: [
                URLQueryItem(name: "date", value: today),
                URLQueryItem(name: "timezone", value: timezone),
            ]
        )
        do {
            let response: HomeResponse = try await apiClient.send(endpoint)
            state = .loaded(response.events)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch {
            state = .error("イベント情報の取得に失敗しました。")
        }
    }

    private static let isoDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        return formatter
    }()
}
