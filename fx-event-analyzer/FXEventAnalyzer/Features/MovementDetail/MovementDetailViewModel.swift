import Combine
import Foundation

enum MovementDetailState: Equatable {
    case loading
    case backendNotConfigured
    case notEntitled
    case notFound
    case loaded(preReleasePrice: Double?, reactions: [ReactionTimeframeEntry])
    case error(String)
}

enum MovementChartState: Equatable {
    case loading
    case loaded(ChartResponse)
    /// A successful response with zero candles — distinct from `.error`
    /// (api-design.md §19: chart data can legitimately not exist yet).
    case empty
    case error(String)
}

/// SCR-008 相場反応詳細 (HQ Phase 4 instruction) —
/// "発表前後にFX相場が実際にどれくらい動いたのか確認する". Backend is the
/// sole Source of Truth for pips/movement/max upward-downward
/// (api-design.md §8); this view model never recomputes them. Fetches
/// every timeframe's Reaction summary once (`timeframe=all`, §18.1) so
/// switching the Segmented Control is instant, and only re-fetches the
/// Chart (§19) per timeframe, since that's the one genuinely
/// timeframe-scoped, heavier call.
@MainActor
final class MovementDetailViewModel: ObservableObject {
    @Published private(set) var state: MovementDetailState = .loading
    @Published private(set) var chartState: MovementChartState = .loading
    /// 発表の結果・予想(「値動きの分析」の1文目)。取れなくても画面は出す。
    @Published private(set) var eventSnapshot: EventSnapshotDetail?
    /// 指標の一般的な見方(上振れ・下振れ)。取れなくても画面は出す。
    @Published private(set) var indicator: IndicatorSummary?
    @Published var selectedTimeframe: String = ReactionTimeframe.default {
        didSet {
            guard oldValue != selectedTimeframe, case .loaded = state else { return }
            loadChart()
        }
    }

    let indicatorId: String
    let fxPairId: String
    let symbol: String
    let indicatorName: String
    let releaseDatetime: Date

    private let apiClient: APIClient
    private let eventId: String

    init(apiClient: APIClient, eventId: String, indicatorId: String, fxPairId: String, symbol: String, indicatorName: String, releaseDatetime: Date, initialTimeframe: String = ReactionTimeframe.default) {
        self.apiClient = apiClient
        _selectedTimeframe = Published(initialValue: initialTimeframe)
        self.eventId = eventId
        self.indicatorId = indicatorId
        self.fxPairId = fxPairId
        self.symbol = symbol
        self.indicatorName = indicatorName
        self.releaseDatetime = releaseDatetime
    }

    func load() {
        state = .loading
        Task {
            // 結果・予想は分析の文にだけ使う。チャートより先に取り終える(最後の通信がチャートになる)。
            await fetchEventSnapshot()
            await fetchIndicator()
            await fetchReactions()
            if case .loaded = state {
                loadChart()
            }
        }
    }

    func retryChart() {
        guard case .loaded = state else { return }
        loadChart()
    }

    private func fetchReactions() async {
        let endpoint = Endpoint(
            path: "events/\(eventId)/reaction",
            queryItems: [
                URLQueryItem(name: "fx_pair_id", value: fxPairId),
                URLQueryItem(name: "timeframe", value: "all"),
            ]
        )
        do {
            let response: ReactionAllTimeframesResponse = try await apiClient.send(endpoint)
            state = .loaded(preReleasePrice: response.preReleasePrice, reactions: response.reactions)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch let error as APIError {
            if case .server(let code, _, _) = error {
                switch code {
                case .eventNotFound, .fxPairNotFound:
                    state = .notFound
                case .featureNotEntitled, .subscriptionRequired:
                    state = .notEntitled
                default:
                    state = .error("値動き情報の取得に失敗しました。")
                }
            } else {
                state = .error("値動き情報の取得に失敗しました。")
            }
        } catch {
            state = .error("値動き情報の取得に失敗しました。")
        }
    }

    private func fetchEventSnapshot() async {
        let response: EventDetailResponse? = try? await apiClient.send(Endpoint(path: "events/\(eventId)"))
        eventSnapshot = response?.snapshot
    }

    private func fetchIndicator() async {
        let response: IndicatorDetailResponse? = try? await apiClient.send(Endpoint(path: "indicators/\(indicatorId)"))
        indicator = response?.indicator
    }

    private func loadChart() {
        chartState = .loading
        Task { await fetchChart() }
    }

    private func fetchChart() async {
        let endpoint = Endpoint(
            path: "events/\(eventId)/reaction/chart",
            queryItems: [
                URLQueryItem(name: "fx_pair_id", value: fxPairId),
                URLQueryItem(name: "timeframe", value: selectedTimeframe),
            ]
        )
        do {
            let response: ChartResponse = try await apiClient.send(endpoint)
            chartState = response.prices.isEmpty ? .empty : .loaded(response)
        } catch {
            chartState = .error("チャートの取得に失敗しました。")
        }
    }
}
