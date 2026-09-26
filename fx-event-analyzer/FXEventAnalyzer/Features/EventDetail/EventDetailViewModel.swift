import Combine
import Foundation

enum EventDetailState: Equatable {
    case loading
    case backendNotConfigured
    case loaded(EventDetailResponse)
    case notEntitled
    case notFound
    case error(String)
}

/// SCR-004 Event Detail (ui-screens.md §5, H-1 order) — the central screen:
/// Forecast/Actual/Previous → Surprise → 乖離理由 → 市場への影響 → 関連FX
/// ペア/Reaction, all from a single `GET /events/{event_id}` call. Backend
/// is the sole Source of Truth for Surprise/Reaction (api-design.md §8) —
/// this view model never recomputes them.
@MainActor
final class EventDetailViewModel: ObservableObject {
    @Published private(set) var state: EventDetailState = .loading

    private let apiClient: APIClient
    private let eventId: String

    init(apiClient: APIClient, eventId: String) {
        self.apiClient = apiClient
        self.eventId = eventId
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    private func fetch() async {
        do {
            let response: EventDetailResponse = try await apiClient.send(Endpoint(path: "events/\(eventId)"))
            state = .loaded(response)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch let error as APIError {
            if case .server(let code, _, _) = error {
                switch code {
                case .eventNotFound:
                    state = .notFound
                case .featureNotEntitled, .subscriptionRequired:
                    state = .notEntitled
                default:
                    state = .error("イベント情報の取得に失敗しました。")
                }
            } else {
                state = .error("イベント情報の取得に失敗しました。")
            }
        } catch {
            state = .error("イベント情報の取得に失敗しました。")
        }
    }
}
