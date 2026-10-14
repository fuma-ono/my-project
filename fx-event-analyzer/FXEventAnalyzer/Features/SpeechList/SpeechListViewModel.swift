import Combine
import Foundation

/// `GET /api/v1/speeches`(api-design.md §14.4)の応答。1件の形は`GET /speeches/{id}`と同じ。
struct SpeechListResponse: Decodable, Equatable {
    let data: [SpeechDetailResponse]
}

enum SpeechListState: Equatable {
    case loading
    case backendNotConfigured
    case loaded([SpeechDetailResponse])
    case error(String)
}

/// SCR-012 要人発言一覧(HQ指示 2026-10-14「指標一覧と同じデザインで」)。指標一覧と同じく、
/// 一覧を1回読み込み、検索語・絞り込みは端末の中で行う(入力のたびの通信はしない)。
@MainActor
final class SpeechListViewModel: ObservableObject {
    /// 「状態」の絞り込み。指標一覧の「時間帯」の代わり。
    enum StatusFilter: String, CaseIterable, Identifiable {
        case scheduled, delivered

        var id: String { rawValue }

        var label: String {
            switch self {
            case .scheduled: return "予定"
            case .delivered: return "発言済み"
            }
        }
    }

    @Published private(set) var state: SpeechListState = .loading
    @Published var searchText: String = ""
    @Published var importanceFilter: Importance?
    @Published var organizationFilter: String?
    @Published var statusFilter: StatusFilter?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    var hasFilters: Bool { importanceFilter != nil || organizationFilter != nil || statusFilter != nil }

    func clearFilters() {
        importanceFilter = nil
        organizationFilter = nil
        statusFilter = nil
    }

    var organizations: [String] {
        guard case .loaded(let speeches) = state else { return [] }
        return Array(Set(speeches.map(\.speaker.organization))).sorted()
    }

    /// これからの発言を近い順に先に、そのあとに発言済み・中止を新しい順に並べる。
    var filtered: [SpeechDetailResponse] {
        guard case .loaded(let speeches) = state else { return [] }
        return Self.order(speeches.filter { matches($0) })
    }

    static func order(_ speeches: [SpeechDetailResponse]) -> [SpeechDetailResponse] {
        let split = split(speeches)
        return split.upcoming + split.past
    }

    /// 一覧の見出しごとの並び(「これからの発言」は近い順、「発言済み」は中止も含めて新しい順)。
    var sections: (upcoming: [SpeechDetailResponse], past: [SpeechDetailResponse]) {
        guard case .loaded(let speeches) = state else { return ([], []) }
        return Self.split(speeches.filter { matches($0) })
    }

    static func split(_ speeches: [SpeechDetailResponse]) -> (upcoming: [SpeechDetailResponse], past: [SpeechDetailResponse]) {
        let upcoming = speeches.filter { $0.status == .scheduled }.sorted { $0.statementDatetime < $1.statementDatetime }
        let past = speeches.filter { $0.status != .scheduled }.sorted { $0.statementDatetime > $1.statementDatetime }
        return (upcoming, past)
    }

    func matches(_ speech: SpeechDetailResponse) -> Bool {
        if let importanceFilter, speech.importance != importanceFilter { return false }
        if let organizationFilter, speech.speaker.organization != organizationFilter { return false }
        switch statusFilter {
        case .scheduled?: if speech.status != .scheduled { return false }
        case .delivered?: if speech.status != .delivered { return false }
        case nil: break
        }
        return Self.matchesSearch(speech, query: searchText)
    }

    /// 要人名・肩書き・機関・発言の題名・国名・通貨で探す。
    static func matchesSearch(_ speech: SpeechDetailResponse, query: String) -> Bool {
        let keyword = query.trimmingCharacters(in: .whitespaces)
        guard !keyword.isEmpty else { return true }
        let speaker = speech.speaker
        let haystack = [
            speaker.name, speaker.title, speaker.organization, speech.title, speaker.currencyCode,
            CountryFlag.japaneseName(forCountry: speaker.countryCode), speaker.countryCode,
        ].joined(separator: " ").lowercased()
        return haystack.contains(keyword.lowercased())
    }

    private func fetch() async {
        let endpoint = Endpoint(path: "speeches", queryItems: [URLQueryItem(name: "limit", value: "100")])
        do {
            let response: SpeechListResponse = try await apiClient.send(endpoint)
            state = .loaded(response.data)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch {
            state = .error("要人発言の取得に失敗しました。")
        }
    }
}
