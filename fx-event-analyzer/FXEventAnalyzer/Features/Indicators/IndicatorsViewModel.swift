import Combine
import Foundation

enum IndicatorsState: Equatable {
    case loading
    case backendNotConfigured
    case loaded([IndicatorSummary])
    case error(String)
}

/// SCR-002 Indicators (ui-screens.md §5). `q` (name/code partial match) and
/// `importance` are the only filters wired — HQ's Phase 3 instruction is
/// explicit that no ad-hoc filter UI beyond what api-design.md §13.1
/// already specifies should be added (frequency was already dropped from
/// the design in ui-screens.md v1.1, L-4).
@MainActor
final class IndicatorsViewModel: ObservableObject {
    @Published private(set) var state: IndicatorsState = .loading
    @Published var searchText: String = "" {
        didSet { scheduleReload() }
    }
    @Published var importanceFilter: Importance? {
        didSet { scheduleReload() }
    }

    private let apiClient: APIClient
    private var reloadTask: Task<Void, Never>?

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    private func scheduleReload() {
        reloadTask?.cancel()
        reloadTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await fetch()
        }
    }

    private func fetch() async {
        var queryItems: [URLQueryItem] = []
        if !searchText.trimmingCharacters(in: .whitespaces).isEmpty {
            queryItems.append(URLQueryItem(name: "q", value: searchText))
        }
        if let importanceFilter {
            queryItems.append(URLQueryItem(name: "importance", value: importanceFilter.rawValue))
        }
        queryItems.append(URLQueryItem(name: "limit", value: "100"))

        let endpoint = Endpoint(path: "indicators", queryItems: queryItems)
        do {
            let response: IndicatorsListResponse = try await apiClient.send(endpoint)
            state = .loaded(response.data)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch {
            state = .error("指標一覧の取得に失敗しました。")
        }
    }
}
