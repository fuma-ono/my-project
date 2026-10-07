import XCTest
@testable import FXEventAnalyzer

private struct FixedCatalog: FXPairCatalog {
    let symbols: [String]
    func availableSymbols() async throws -> [String] { symbols }
}

@MainActor
final class HomeCurrencyPairEditorTests: XCTestCase {
    private let all = ["USDJPY", "EURUSD", "EURJPY", "GBPJPY", "AUDUSD"]

    private func settings(home: [String]?) -> SettingsResponse {
        SettingsResponse(notifications: .defaults, display: .defaults, chart: .defaults, home: HomeSettings(fxPairs: home))
    }

    private func loaded(_ apiClient: MockAPIClient, home: [String]?) async -> HomeCurrencyPairEditorViewModel {
        apiClient.result = .success(settings(home: home))
        let viewModel = HomeCurrencyPairEditorViewModel(apiClient: apiClient, catalog: FixedCatalog(symbols: all))
        await viewModel.load()
        return viewModel
    }

    func testDefaultsToTheBackendDefaultPairs() async {
        let viewModel = await loaded(MockAPIClient(), home: nil)
        XCTAssertEqual(viewModel.selected, ["USDJPY", "EURUSD", "EURJPY"])
        XCTAssertEqual(viewModel.others, ["GBPJPY", "AUDUSD"])
        XCTAssertFalse(viewModel.canAdd)
        XCTAssertFalse(viewModel.canSave)
    }

    func testAddRemoveAndReorder() async {
        let viewModel = await loaded(MockAPIClient(), home: ["USDJPY"])
        viewModel.add("GBPJPY")
        viewModel.add("AUDUSD")
        viewModel.add("EURUSD") // 4つ目は追加できない
        XCTAssertEqual(viewModel.selected, ["USDJPY", "GBPJPY", "AUDUSD"])
        viewModel.move("AUDUSD", to: "USDJPY")
        XCTAssertEqual(viewModel.selected, ["AUDUSD", "USDJPY", "GBPJPY"])
        viewModel.remove("USDJPY")
        XCTAssertEqual(viewModel.selected, ["AUDUSD", "GBPJPY"])
        XCTAssertTrue(viewModel.canSave)
    }

    func testPickerTogglesAndStopsAtTheMaximum() async {
        let viewModel = await loaded(MockAPIClient(), home: ["USDJPY", "EURUSD"])
        viewModel.toggle("GBPJPY")
        viewModel.toggle("AUDUSD") // 3つ選んでいるので追加されない
        XCTAssertEqual(viewModel.selected, ["USDJPY", "EURUSD", "GBPJPY"])
        viewModel.toggle("USDJPY")
        XCTAssertEqual(viewModel.selected, ["EURUSD", "GBPJPY"])
    }

    func testPickerCategoriesAndSearch() async {
        let viewModel = await loaded(MockAPIClient(), home: nil)
        XCTAssertEqual(viewModel.pairs(in: .all, matching: ""), all)
        XCTAssertEqual(viewModel.pairs(in: .major, matching: ""), ["USDJPY", "EURUSD", "AUDUSD"])
        XCTAssertEqual(viewModel.pairs(in: .crossYen, matching: ""), ["EURJPY", "GBPJPY"])
        XCTAssertEqual(viewModel.pairs(in: .other, matching: ""), [])
        XCTAssertEqual(HomeCurrencyPairEditorViewModel.category(of: "EURGBP"), .other)
        XCTAssertEqual(viewModel.pairs(in: .all, matching: "eur/j"), ["EURJPY"])
        XCTAssertEqual(viewModel.pairs(in: .all, matching: "豪ドル"), ["AUDUSD"])
        XCTAssertEqual(viewModel.pairs(in: .crossYen, matching: "ユーロ"), ["EURJPY"])
    }

    func testSaveSendsOnlyTheHomeSection() async throws {
        let apiClient = MockAPIClient()
        let viewModel = await loaded(apiClient, home: nil)
        viewModel.remove("EURJPY")
        apiClient.result = .success(settings(home: ["USDJPY", "EURUSD"]))

        let ok = await viewModel.save()

        XCTAssertTrue(ok)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(apiClient.lastEndpoint?.body)) as? [String: Any])
        XCTAssertEqual(Set(body.keys), ["home"])
        XCTAssertEqual((body["home"] as? [String: Any])?["fx_pairs"] as? [String], ["USDJPY", "EURUSD"])
        XCTAssertFalse(viewModel.hasChanges)
    }

    func testCurrencyNames() {
        XCTAssertEqual(HomeCurrencyPairEditorViewModel.names("EURUSD"), "ユーロ / 米ドル")
        XCTAssertEqual(HomeCurrencyPairEditorViewModel.names("USDCHF"), "米ドル / スイスフラン")
    }

    func testSettingsWithoutHomeDecodeToDefaults() throws {
        let json = Data(#"{"notifications":{"push":true,"indicators":true,"speeches":true,"fx_pairs":null,"importances":["HIGH"],"lead_minutes":5},"display":{"language":"ja","region":"JP","timezone":"Asia/Tokyo"},"chart":{"default_fx_pair_symbol":null,"default_timeframe":"5m"}}"#.utf8)
        XCTAssertEqual(try JSONDecoder().decode(SettingsResponse.self, from: json).home, .defaults)
    }
}
