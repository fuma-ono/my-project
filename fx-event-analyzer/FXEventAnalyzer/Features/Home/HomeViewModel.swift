import Combine
import Foundation

enum HomeState: Equatable {
    case loading
    /// No Backend base URL configured yet — distinct from a real failure.
    case backendNotConfigured
    case loaded(events: [HomeEventSummary], majorFx: [MajorFxSummary])
    case error(String)
}

/// SCR-001 Home. Phase 3 §4: real `GET /home` connection —
/// `HomeView → HomeViewModel → APIClient → Backend API → DTO → UI`, no
/// fake production data. Splits the single day-scoped `events` array into
/// "今日の注目イベント" (mainly SCHEDULED) and "最近のイベント" (RELEASED)
/// itself, per api-design.md §12's H-2 resolution — the Backend does not
/// provide a separate field/endpoint for this.
@MainActor
final class HomeViewModel: ObservableObject {
    @Published private(set) var state: HomeState = .loading

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    var upcomingEvents: [HomeEventSummary] {
        guard case .loaded(let events, _) = state else { return [] }
        return events.filter { $0.status == .scheduled }
    }

    var recentEvents: [HomeEventSummary] {
        guard case .loaded(let events, _) = state else { return [] }
        return events.filter { $0.status == .released }
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
            state = .loaded(events: response.events, majorFx: response.majorFx)
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
