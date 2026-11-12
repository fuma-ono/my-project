import Combine
import Foundation

enum StrategyAnalysisState: Equatable {
    case loading
    case backendNotConfigured
    /// Pro の機能を持っていない(api-design v1.48 の available: false)。
    case locked
    /// HQ指示(2026-11-07「アクセス制御」): 403などの権限エラー(FEATURE_NOT_ENTITLED・SUBSCRIPTION_REQUIRED・
    /// FORBIDDEN・UNAUTHORIZED)。`available: false`(ロック表示)とは別に扱う — こちらは本来この画面に来られない
    /// はずの状態(ログイン切れ等)で、単なる通信失敗(`.error`)として「読み込みに失敗しました」とは出さない。
    case notEntitled
    /// 比べる通貨ペアが無い指標。
    case noPair
    case notFound
    /// HQ指示(2026-11-10「重複排除・集計改善・AI分析基盤の整備」STEP1): 同時発表の他の指標(無ければ空配列)。
    case loaded(StrategyFxPair, StrategyAnalysis, [StrategyCoReleasedIndicator])
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
            state = Self.state(forError: error)
        } catch {
            state = .error("トレード戦略分析の取得に失敗しました。")
        }
    }

    /// HQ指示(2026-11-07)「403などの権限エラーを単なる通信失敗として扱わず、適切な表示にする」:
    /// `HistoricalComparisonViewModel`と同じ区別(featureNotEntitled・subscriptionRequired)に加え、
    /// この画面独自にforbidden・unauthorizedも権限エラーとして扱う(通信失敗の`.error`とは別の案内を出す)。
    nonisolated static func state(forError error: APIError) -> StrategyAnalysisState {
        guard case .server(let code, _, _) = error else {
            return .error("トレード戦略分析の取得に失敗しました。")
        }
        switch code {
        case .eventNotFound, .fxPairNotFound:
            return .notFound
        case .featureNotEntitled, .subscriptionRequired, .forbidden, .unauthorized:
            return .notEntitled
        default:
            return .error("トレード戦略分析の取得に失敗しました。")
        }
    }

    nonisolated static func state(for response: StrategyAnalysisResponse) -> StrategyAnalysisState {
        guard response.available else { return .locked }
        guard let pair = response.fxPair, let analysis = response.analysis else { return .noPair }
        return .loaded(pair, analysis, response.coReleasedIndicators ?? [])
    }
}
