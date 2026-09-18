import Combine
import Foundation

enum HistoricalEventDetailState: Equatable {
    case loading
    case backendNotConfigured
    case loaded(HistoricalEventDetailResponse)
    case notEntitled
    case notFound
    case error(String)
}

/// SCR-007 Historical Event Detail (ui-screens.md §5) — "過去の特定回の
///発表を詳しく確認する". `indicator_id` from the response drives the
/// mandatory "指標詳細を見る" navigation back to SCR-003.
@MainActor
final class HistoricalEventDetailViewModel: ObservableObject {
    @Published private(set) var state: HistoricalEventDetailState = .loading

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
            let response: HistoricalEventDetailResponse = try await apiClient.send(
                Endpoint(path: "events/\(eventId)/history")
            )
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
                    state = .error("過去のイベント情報の取得に失敗しました。")
                }
            } else {
                state = .error("過去のイベント情報の取得に失敗しました。")
            }
        } catch {
            state = .error("過去のイベント情報の取得に失敗しました。")
        }
    }
}
