import XCTest
@testable import FXEventAnalyzer

@MainActor
final class SpeechListViewModelTests: XCTestCase {
    private func speech(_ id: String, name: String, org: String, title: String, minutes: Double, status: SpeechStatus, importance: Importance = .high) -> SpeechDetailResponse {
        let json = """
        {"speech_id":"\(id)","speaker":{"speaker_id":"sp-\(id)","name":"\(name)","title":"理事","organization":"\(org)","country_code":"US","currency_code":"USD","photo_url":null},
         "title":"\(title)","summary":null,"statement_datetime":"\(ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: 1_790_000_000 + minutes * 60)))",
         "importance":"\(importance.rawValue)","status":"\(status.rawValue)"}
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try! decoder.decode(SpeechDetailResponse.self, from: Data(json.utf8))
    }

    func testUpcomingComeFirstSoonestFirstThenPastNewestFirst() {
        let speeches = [
            speech("past-old", name: "A", org: "FRB", title: "t", minutes: -300, status: .delivered),
            speech("future-far", name: "B", org: "FRB", title: "t", minutes: 600, status: .scheduled),
            speech("past-new", name: "C", org: "ECB", title: "t", minutes: -60, status: .delivered),
            speech("future-near", name: "D", org: "ECB", title: "t", minutes: 30, status: .scheduled),
        ]
        let ordered = SpeechListViewModel.order(speeches)
        XCTAssertEqual(ordered.map(\.speechId), ["future-near", "future-far", "past-new", "past-old"])
    }

    func testSplitSeparatesUpcomingFromDeliveredAndCancelled() {
        let speeches = [
            speech("done", name: "A", org: "FRB", title: "t", minutes: -60, status: .delivered),
            speech("cancel", name: "B", org: "FRB", title: "t", minutes: -30, status: .cancelled),
            speech("next", name: "C", org: "ECB", title: "t", minutes: 30, status: .scheduled),
        ]
        let split = SpeechListViewModel.split(speeches)
        XCTAssertEqual(split.upcoming.map(\.speechId), ["next"])
        XCTAssertEqual(split.past.map(\.speechId), ["cancel", "done"])
    }

    func testImportanceOrderPutsHighFirstAndKeepsDateOrderWithinTheSameImportance() {
        let byDate = [
            speech("low", name: "A", org: "FRB", title: "t", minutes: 10, status: .scheduled, importance: .low),
            speech("high-1", name: "B", org: "FRB", title: "t", minutes: 20, status: .scheduled, importance: .high),
            speech("medium", name: "C", org: "ECB", title: "t", minutes: 30, status: .scheduled, importance: .medium),
            speech("high-2", name: "D", org: "ECB", title: "t", minutes: 40, status: .scheduled, importance: .high),
        ]
        XCTAssertEqual(ListSortOrder.importance.apply(byDate, importance: \.importance).map(\.speechId), ["high-1", "high-2", "medium", "low"])
        XCTAssertEqual(ListSortOrder.date.apply(byDate, importance: \.importance).map(\.speechId), ["low", "high-1", "medium", "high-2"])
    }

    func testFxPairSearchMatchesSymbolAndJapaneseCurrencyNames() {
        let symbols = ["USDJPY", "EURUSD", "EURJPY", "GBPUSD"]
        XCTAssertEqual(SearchView.matchFxSymbols(symbols, query: "usd/jpy"), ["USDJPY"])
        XCTAssertEqual(SearchView.matchFxSymbols(symbols, query: "EUR"), ["EURUSD", "EURJPY"])
        XCTAssertEqual(SearchView.matchFxSymbols(symbols, query: "ポンド"), ["GBPUSD"])
        XCTAssertEqual(SearchView.matchFxSymbols(symbols, query: ""), [])
    }

    func testFamilyNameIsTheLastPartOfAKatakanaName() {
        XCTAssertEqual(SpeechListView.familyName("ジェローム・パウエル"), "パウエル")
        XCTAssertEqual(SpeechListView.familyName("クリスティーヌ・ラガルド"), "ラガルド")
        XCTAssertEqual(SpeechListView.familyName("植田和男"), "植田和男")
    }

    func testSearchMatchesNameOrganizationTitleAndCountry() {
        let item = speech("1", name: "植田和男", org: "日本銀行", title: "金融経済懇談会での講演", minutes: 0, status: .scheduled)
        XCTAssertTrue(SpeechListViewModel.matchesSearch(item, query: "植田"))
        XCTAssertTrue(SpeechListViewModel.matchesSearch(item, query: "日本銀行"))
        XCTAssertTrue(SpeechListViewModel.matchesSearch(item, query: "懇談会"))
        XCTAssertTrue(SpeechListViewModel.matchesSearch(item, query: "米国"))
        XCTAssertFalse(SpeechListViewModel.matchesSearch(item, query: "ラガルド"))
    }

    // MARK: - 初回表示プレビュー(HQ指示 2026-10-21「要人発言一覧の初回表示改善」)

    private func homeSpeech(_ id: String) -> HomeSpeechSummary {
        let json = """
        {"speech_id":"\(id)","country_code":"US","speaker_name":"パウエル","statement_datetime":"2026-10-21T12:00:00Z","headline":"見出し","organization":"FRB"}
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try! decoder.decode(HomeSpeechSummary.self, from: Data(json.utf8))
    }

    func testInitWithoutPreviewStartsLoading() {
        let viewModel = SpeechListViewModel(apiClient: MockAPIClient())
        XCTAssertEqual(viewModel.state, .loading)
    }

    func testInitWithPreviewStartsLoadingWithPreview() {
        let preview = [homeSpeech("p1"), homeSpeech("p2")]
        let viewModel = SpeechListViewModel(apiClient: MockAPIClient(), preview: preview)
        XCTAssertEqual(viewModel.state, .loadingWithPreview(preview))
    }

    /// プレビュー中は、`.loaded`が前提の検索・絞り込み・並べ替えに使う
    /// 計算プロパティがいずれも空を返す(=UIがそれらを有効にできない)こと
    /// を確認する。
    func testFiltersAndSectionsAreEmptyWhileShowingPreview() {
        let viewModel = SpeechListViewModel(apiClient: MockAPIClient(), preview: [homeSpeech("p1")])
        XCTAssertEqual(viewModel.organizations, [])
        XCTAssertEqual(viewModel.filtered, [])
        XCTAssertEqual(viewModel.sections.upcoming, [])
        XCTAssertEqual(viewModel.sections.past, [])
    }

    /// `.task`からの初回`load()`呼び出しで、プレビューが`.loading`に即座に
    /// 上書きされてしまわないこと(=プレビューが一瞬も表示されない回帰が
    /// 無いこと)を確認する。
    func testLoadDoesNotImmediatelyReplacePreviewWithPlainLoading() {
        let apiClient = MockAPIClient()
        apiClient.result = .success(SpeechListResponse(data: [speech("1", name: "A", org: "FRB", title: "t", minutes: 0, status: .scheduled)]))
        let preview = [homeSpeech("p1")]
        let viewModel = SpeechListViewModel(apiClient: apiClient, preview: preview)

        viewModel.load()

        XCTAssertEqual(viewModel.state, .loadingWithPreview(preview))
    }

    func testLoadWithPreviewSwitchesToFullListOnSuccess() async {
        let apiClient = MockAPIClient()
        let full = speech("1", name: "A", org: "FRB", title: "t", minutes: 0, status: .scheduled)
        apiClient.result = .success(SpeechListResponse(data: [full]))
        let viewModel = SpeechListViewModel(apiClient: apiClient, preview: [homeSpeech("p1")])

        viewModel.load()
        let state = await settledState(of: viewModel)

        XCTAssertEqual(state, .loaded([full]))
    }

    func testLoadWithPreviewStillShowsErrorOnFailure() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.transport("connection reset"))
        let viewModel = SpeechListViewModel(apiClient: apiClient, preview: [homeSpeech("p1")])

        viewModel.load()
        let state = await settledState(of: viewModel)

        guard case .error = state else {
            return XCTFail("Expected .error state, got \(state)")
        }
    }

    func testLoadWithPreviewStillShowsBackendNotConfigured() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.notConfigured)
        let viewModel = SpeechListViewModel(apiClient: apiClient, preview: [homeSpeech("p1")])

        viewModel.load()
        let state = await settledState(of: viewModel)

        XCTAssertEqual(state, .backendNotConfigured)
    }

    /// `load()`はdispatchが非同期のため、プレビュー/読み込み中から抜けるまで短くポーリングする
    /// (`HomeViewModelTests.load(with:)`と同じ考え方)。
    private func settledState(of viewModel: SpeechListViewModel) async -> SpeechListState {
        for _ in 0..<50 {
            switch viewModel.state {
            case .loading, .loadingWithPreview:
                try? await Task.sleep(nanoseconds: 10_000_000)
            default:
                return viewModel.state
            }
        }
        return viewModel.state
    }
}
