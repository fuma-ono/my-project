import Combine
import Foundation

enum IndicatorDetailState: Equatable {
    case loading
    case backendNotConfigured
    case loaded(indicator: IndicatorSummary, relatedFxPairs: [RelatedFxPairSummary], recentEvents: [IndicatorEventSummary], nextScheduledEvent: IndicatorEventSummary?)
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
            // HQ UI Master v5's SCR-003 header shows the indicator's next
            // scheduled release (date/forecast) — the same
            // `/indicators/{id}/events` endpoint the RELEASED fetch above
            // already uses, just with its existing `status` parameter set
            // to SCHEDULED instead.
            async let scheduled: IndicatorEventsListResponse = apiClient.send(
                Endpoint(
                    path: "indicators/\(indicatorId)/events",
                    queryItems: [
                        URLQueryItem(name: "status", value: "SCHEDULED"),
                        URLQueryItem(name: "limit", value: "1"),
                    ]
                )
            )
            let (detailResponse, eventsResponse, scheduledResponse) = try await (detail, events, scheduled)
            state = .loaded(
                indicator: detailResponse.indicator,
                relatedFxPairs: detailResponse.relatedFxPairs,
                recentEvents: eventsResponse.data,
                nextScheduledEvent: scheduledResponse.data.first
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
