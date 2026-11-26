import Combine
import Foundation

enum TechnicalChartState: Equatable {
    case loading
    case backendNotConfigured
    /// `404 NOT_FOUND`(Backendのフラグが閉じている)・権限なし。
    case unavailable
    /// `404 FX_PAIR_NOT_FOUND`。
    case notFound
    /// `403 DATA_RIGHTS_UNCONFIRMED`(価格データの権利が確認できていない)。
    case rightsUnconfirmed
    /// 成功したが足が0本。
    case empty
    case loaded(TechnicalData)
    case error(String)
}

/// テクニカル分析チャート。指標の計算はBackendが行い、この画面は再計算しない。
/// 時間足を切り替えたときだけ取り直し、指標・帯の表示切り替えは端末内だけで行う。
@MainActor
final class TechnicalChartViewModel: ObservableObject {
    @Published private(set) var state: TechnicalChartState = .loading
    @Published var selectedTimeframe: TechnicalTimeframe = TechnicalTimeframe.initial {
        didSet {
            guard oldValue != selectedTimeframe else { return }
            load()
        }
    }
    @Published var showSMA = true
    @Published var showEMA = true
    @Published var showBollinger = false
    @Published var showKeyZones = true
    @Published var lowerPanel: TechnicalLowerPanel = .rsi
    /// 横スクロールの位置(足の番号)。読み込み後は右端(最新)に合わせる。
    @Published var scrollX: Int = 0

    let fxPairId: String
    let symbol: String

    private let apiClient: APIClient
    private var loadTask: Task<Void, Never>?

    init(apiClient: APIClient, fxPairId: String, symbol: String) {
        self.apiClient = apiClient
        self.fxPairId = fxPairId
        self.symbol = symbol
    }

    func load() {
        loadTask?.cancel()
        state = .loading
        loadTask = Task { await fetch() }
    }

    /// 取得して状態を更新する(テストから直接呼べる)。時間足が途中で変わったら、古い結果は捨てる。
    func fetch() async {
        let requested = selectedTimeframe
        let endpoint = Self.endpoint(fxPairId: fxPairId, timeframe: requested)
        do {
            let response: TechnicalResponse = try await apiClient.send(endpoint)
            guard !Task.isCancelled, requested == selectedTimeframe else { return }
            let data = response.data
            if data.candles.isEmpty {
                state = .empty
            } else {
                let start = data.candles.count - TechnicalSeries.visibleCandles
                scrollX = max(start, 0)
                state = .loaded(data)
            }
        } catch {
            guard !Task.isCancelled, requested == selectedTimeframe else { return }
            state = Self.state(forError: error)
        }
    }

    /// 取得する指標(表示の切り替えは端末内なので、常にすべて取る)。
    static let requestedIndicators = "sma20,ema50,rsi14,macd,bollinger,stoch"

    static func endpoint(fxPairId: String, timeframe: TechnicalTimeframe, limit: Int = TechnicalSeries.defaultLimit) -> Endpoint {
        let items: [URLQueryItem] = [
            URLQueryItem(name: "timeframe", value: timeframe.rawValue),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "indicators", value: requestedIndicators)
        ]
        return Endpoint(path: "fx-pairs/\(fxPairId)/technical", queryItems: items)
    }

    nonisolated static func state(forError error: Error) -> TechnicalChartState {
        guard let apiError = error as? APIError else {
            return .error("チャートの取得に失敗しました。")
        }
        if apiError.isNotConfigured { return .backendNotConfigured }
        guard case .server(let code, _, _) = apiError else {
            return .error("チャートの取得に失敗しました。")
        }
        switch code {
        case .dataRightsUnconfirmed:
            return .rightsUnconfirmed
        case .fxPairNotFound:
            return .notFound
        case .notFound, .forbidden, .unauthorized, .featureNotEntitled, .subscriptionRequired:
            return .unavailable
        default:
            return .error("チャートの取得に失敗しました。")
        }
    }
}
