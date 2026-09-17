import Combine
import Foundation

enum IndicatorDetailState: Equatable {
    case loading
    case backendNotConfigured
    case loaded(indicator: IndicatorSummary, relatedFxPairs: [RelatedFxPairSummary], recentEvents: [IndicatorEventSummary])
    case error(String)
}

/// SCR-003 Indicator Detail (ui-screens.md §5) — "指標そのものを理解する"
///画面。Deliberately distinct from SCR-004 Event Detail: this screen never
/// shows a single event's Surprise/explanation as its primary content,
/// only the indicator's own metadata plus a list of its recent released
/// events (each tapping through to SCR-007).
@MainActor
final class IndicatorDetailViewModel: ObservableObject {
    @Published private(set) var state: IndicatorDetailState = .loading

    private let apiClient: APIClient
    private let indicatorId: String

    init(apiClient: APIClient, indicatorId: String) {
        self.apiClient = apiClient
        self.indicatorId = indicatorId
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    private func fetch() async {
        do {
            async let detail: IndicatorDetailResponse = apiClient.send(
                Endpoint(path: "indicators/\(indicatorId)")
            )
            async let events: IndicatorEventsListResponse = apiClient.send(
                Endpoint(
                    path: "indicators/\(indicatorId)/events",
                    queryItems: [
                        URLQueryItem(name: "status", value: "RELEASED"),
                        URLQueryItem(name: "limit", value: "10"),
                    ]
                )
            )
            let (detailResponse, eventsResponse) = try await (detail, events)
            state = .loaded(
                indicator: detailResponse.indicator,
                relatedFxPairs: detailResponse.relatedFxPairs,
                recentEvents: eventsResponse.data
            )
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch let error as APIError {
            if case .server(let code, _, _) = error, code == .indicatorNotFound {
                state = .error("指標が見つかりませんでした。")
            } else {
                state = .error("指標情報の取得に失敗しました。")
            }
        } catch {
            state = .error("指標情報の取得に失敗しました。")
        }
    }
}
