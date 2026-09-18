import Combine
import Foundation

enum HistoricalComparisonState: Equatable {
    case loading
    case backendNotConfigured
    case notEntitled
    case notFound
    case loaded(ComparisonResponse)
    case error(String)
}

/// SCR-006 Historical Comparison (ui-screens.md §5) — "今回だけでなく、
/// 過去の同一指標発表時に相場がどう動いたか比較する". Statistics are the
/// Backend's Source of Truth (api-design.md §22); this view model never
/// computes an average/max/min itself, and Advanced Statistics follows the
/// existing partial-gating contract (§21.3) rather than a blanket 403.
@MainActor
final class HistoricalComparisonViewModel: ObservableObject {
    @Published private(set) var state: HistoricalComparisonState = .loading
    @Published var selectedTimeframe: String = ReactionTimeframe.default {
        didSet {
            guard oldValue != selectedTimeframe else { return }
            load()
        }
    }

    let indicatorName: String
    let fxPairSymbol: String

    private let apiClient: APIClient
    private let indicatorId: String
    private let fxPairId: String

    init(apiClient: APIClient, indicatorId: String, indicatorName: String, fxPairId: String, fxPairSymbol: String) {
        self.apiClient = apiClient
        self.indicatorId = indicatorId
        self.indicatorName = indicatorName
        self.fxPairId = fxPairId
        self.fxPairSymbol = fxPairSymbol
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    private func fetch() async {
        let endpoint = Endpoint(
            path: "indicators/\(indicatorId)/comparison",
            queryItems: [
                URLQueryItem(name: "fx_pair_id", value: fxPairId),
                URLQueryItem(name: "timeframe", value: selectedTimeframe),
            ]
        )
        do {
            let response: ComparisonResponse = try await apiClient.send(endpoint)
            state = .loaded(response)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch let error as APIError {
            if case .server(let code, _, _) = error {
                switch code {
                case .indicatorNotFound, .fxPairNotFound:
                    state = .notFound
                case .featureNotEntitled, .subscriptionRequired:
                    state = .notEntitled
                default:
                    state = .error("過去の比較データの取得に失敗しました。")
                }
            } else {
                state = .error("過去の比較データの取得に失敗しました。")
            }
        } catch {
            state = .error("過去の比較データの取得に失敗しました。")
        }
    }
}
