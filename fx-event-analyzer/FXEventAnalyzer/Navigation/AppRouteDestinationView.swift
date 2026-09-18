import SwiftUI

/// Resolves an `AppRoute` to its screen. Registered once per tab's
/// `NavigationStack` via `.navigationDestination(for: AppRoute.self)`, so
/// every `NavigationLink(value:)` anywhere in that tab's subtree — however
/// deep — routes through here.
struct AppRouteDestinationView: View {
    let route: AppRoute
    let apiClient: APIClient

    var body: some View {
        switch route {
        case .indicatorDetail(let id):
            IndicatorDetailView(apiClient: apiClient, indicatorId: id)
        case .eventDetail(let id):
            EventDetailView(apiClient: apiClient, eventId: id)
        case .historicalEventDetail(let id):
            HistoricalEventDetailView(apiClient: apiClient, eventId: id)
        case .movementDetail(let eventId, let indicatorId, let fxPairId, let symbol, let indicatorName, let releaseDatetime):
            MovementDetailView(
                apiClient: apiClient,
                eventId: eventId,
                indicatorId: indicatorId,
                fxPairId: fxPairId,
                symbol: symbol,
                indicatorName: indicatorName,
                releaseDatetime: releaseDatetime
            )
        case .historicalComparison(let indicatorId, let indicatorName, let fxPairId, let fxPairSymbol):
            HistoricalComparisonView(
                apiClient: apiClient,
                indicatorId: indicatorId,
                indicatorName: indicatorName,
                fxPairId: fxPairId,
                fxPairSymbol: fxPairSymbol
            )
        }
    }
}
