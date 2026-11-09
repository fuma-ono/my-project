import Combine
import Foundation

/// `GET /api/v1/speeches`(api-design.md §14.4)の応答。1件の形は`GET /speeches/{id}`と同じ。
struct SpeechListResponse: Decodable, Equatable {
    let data: [SpeechDetailResponse]
}

enum SpeechListState: Equatable {
    case loading
    /// HQ指示(2026-10-21)「要人発言一覧の初回表示改善」: ホームが既に
    /// 取得済みの直近の要人発言(`HomeViewModel.recentSpeeches`、最大3件)を
    /// 使って、`/speeches`の全件取得が終わるまでの間、空のスピナーではなく
    /// この一覧を先に表示する。`SpeechListView`側はこの状態の間、検索・
    /// 絞り込み・並べ替えのUIを出さない(`HomeSpeechSummary`には重要度・
    /// 状態・機関等、絞り込みに必要な項目が揃っていないため)。
    case loadingWithPreview([HomeSpeechSummary])
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

    @Published private(set) var state: SpeechListState
    @Published var searchText: String = ""
    @Published var importanceFilter: Importance?
    @Published var organizationFilter: String?
    @Published var statusFilter: StatusFilter?
    /// HQ指示(2026-10-14)「重要度順をつけて」。重要度順でも「これから／発言済み」の見出しは分けたまま、
    /// それぞれの中を重要度の高い順にする。
    @Published var sortOrder: ListSortOrder = .date

    private let apiClient: APIClient

    /// `preview`はHQ指示(2026-10-21)「要人発言一覧の初回表示改善」対応。
    /// 非空ならホームの直近の要人発言を初期表示に使う(`AppRoute.speechList`
    /// のドキュメントコメント参照)。空(既定値、Home経由以外からの遷移等)
    /// なら従来通り`.loading`から始まる。
    init(apiClient: APIClient, preview: [HomeSpeechSummary] = []) {
        self.apiClient = apiClient
        self.state = preview.isEmpty ? .loading : .loadingWithPreview(preview)
    }

    func load() {
        // プレビュー表示中・取得済みの間は、取得中もその表示を維持する
        // (`CalendarViewModel.load()`の`itemsByDay.isEmpty`ガードと同じ
        // 考え方)。`.task`からの初回呼び出しで`.loadingWithPreview`を
        // 即座に`.loading`へ上書きしてしまうと、プレビューが一瞬も表示
        // されないため。リトライ(`.error`からの再試行)等、それ以外の
        // 状態からの呼び出しは従来通り`.loading`にする。
        switch state {
        case .loadingWithPreview, .loaded:
            break
        case .loading, .backendNotConfigured, .error:
            state = .loading
        }
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
        let parts = Self.split(speeches)
        return parts.upcoming + parts.past
    }

    /// 一覧の見出しごとの並び(「これからの発言」は近い順、「発言済み」は中止も含めて新しい順)。
    var sections: (upcoming: [SpeechDetailResponse], past: [SpeechDetailResponse]) {
        guard case .loaded(let speeches) = state else { return ([], []) }
        let parts = Self.split(speeches.filter { matches($0) })
        return (sortOrder.apply(parts.upcoming, importance: \.importance), sortOrder.apply(parts.past, importance: \.importance))
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
