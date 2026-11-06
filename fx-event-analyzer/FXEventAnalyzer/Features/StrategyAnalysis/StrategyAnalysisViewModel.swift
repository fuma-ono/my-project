import Combine
import Foundation

enum StrategyAnalysisState: Equatable {
    case loading
    case backendNotConfigured
    /// Pro の機能を持っていない(api-design v1.48 の available: false)。
    case locked
    /// 比べる通貨ペアが無い指標。
    case noPair
    case notFound
    case loaded(StrategyFxPair, StrategyAnalysis)
    case error(String)
}

/// Pro イベント別トレード戦略分析(HQ指示 2026-11-06)。`GET /events/{id}/strategy-analysis` を1回読むだけ。
@MainActor
final class StrategyAnalysisViewModel: ObservableObject {
    @Published private(set) var state: StrategyAnalysisState = .loading

    let eventId: String
    let indicatorName: String
    let fxPairId: String?

    private let apiClient: APIClient

    init(apiClient: APIClient, eventId: String, indicatorName: String, fxPairId: String?) {
        self.apiClient = apiClient
        self.eventId = eventId
        self.indicatorName = indicatorName
        self.fxPairId = fxPairId
    }

    func load() async {
        state = .loading
        let endpoint = Endpoint(
            path: "events/\(eventId)/strategy-analysis",
            queryItems: fxPairId.map { [URLQueryItem(name: "fx_pair_id", value: $0)] } ?? []
        )
        do {
            let response: StrategyAnalysisResponse = try await apiClient.send(endpoint)
            state = Self.state(for: response)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch let error as APIError {
            if case .server(let code, _, _) = error, code == .eventNotFound || code == .fxPairNotFound {
                state = .notFound
            } else {
                state = .error("トレード戦略分析の取得に失敗しました。")
            }
        } catch {
            state = .error("トレード戦略分析の取得に失敗しました。")
        }
    }

    nonisolated static func state(for response: StrategyAnalysisResponse) -> StrategyAnalysisState {
        guard response.available else { return .locked }
        guard let pair = response.fxPair, let analysis = response.analysis else { return .noPair }
        return .loaded(pair, analysis)
    }
}
