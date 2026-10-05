import XCTest
@testable import FXEventAnalyzer

/// Polls briefly until `condition` is true rather than assuming a fixed
/// delay is always enough — same pattern as HomeViewModelTests.
private func waitUntil(_ condition: @escaping () -> Bool) async {
    for _ in 0..<100 {
        if condition() { return }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
}

private func jsonObject(_ data: Data?) throws -> [String: Any] {
    let data = try XCTUnwrap(data)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private let sampleSettings = SettingsResponse(
    notifications: NotificationSettings(push: true, indicators: false, speeches: true, fxPairs: ["USDJPY", "EURJPY"], importances: ["HIGH"], leadMinutes: 15),
    display: DisplaySettings(language: "en", region: "US", timezone: "America/New_York"),
    chart: ChartSettings(defaultFxPairSymbol: "USDJPY", defaultTimeframe: "15m")
)

// MARK: - Models (api-design.md §24.4/§24.5)

final class SettingsModelsTests: XCTestCase {
    func testDecodesTheSettingsResponseShape() throws {
        let json = """
        {
          "notifications": { "push": true, "indicators": false, "speeches": true, "fx_pairs": ["USDJPY", "EURJPY"], "importances": ["HIGH"], "lead_minutes": 15 },
          "display": { "language": "en", "region": "US", "timezone": "America/New_York" },
          "chart": { "default_fx_pair_symbol": "USDJPY", "default_timeframe": "15m" },
          "updated_at": "2026-10-02T01:23:45.678901+00:00"
        }
        """.data(using: .utf8)!

        XCTAssertEqual(try JSONDecoder().decode(SettingsResponse.self, from: json), sampleSettings)
    }

    func testDecodesANullFxPair() throws {
        let json = """
        {
          "notifications": { "push": true, "indicators": true, "speeches": true, "fx_pairs": null, "importances": ["HIGH", "MEDIUM"], "lead_minutes": 5 },
          "display": { "language": "ja", "region": "JP", "timezone": "Asia/Tokyo" },
          "chart": { "default_fx_pair_symbol": null, "default_timeframe": "5m" },
          "updated_at": "2026-10-02T00:00:00Z"
        }
        """.data(using: .utf8)!

        let settings = try JSONDecoder().decode(SettingsResponse.self, from: json)
        XCTAssertEqual(settings.chart, .defaults)
        XCTAssertEqual(settings.notifications, .defaults)
        XCTAssertEqual(settings.display, .defaults)
    }

    func testUpdateOmitsSectionsThatAreNotSent() throws {
        let body = try jsonObject(JSONEncoder().encode(SettingsUpdate(notifications: sampleSettings.notifications)))

        XCTAssertEqual(Set(body.keys), ["notifications"])
        let notifications = try XCTUnwrap(body["notifications"] as? [String: Any])
        XCTAssertEqual(notifications["push"] as? Bool, true)
        XCTAssertEqual(notifications["indicators"] as? Bool, false)
        XCTAssertEqual(notifications["fx_pairs"] as? [String], ["USDJPY", "EURJPY"])
        XCTAssertEqual(notifications["importances"] as? [String], ["HIGH"])
        XCTAssertEqual(notifications["lead_minutes"] as? Int, 15)
    }

    func testUpdateSendsAnExplicitNullForAllFxPairs() throws {
        let body = try jsonObject(JSONEncoder().encode(SettingsUpdate(notifications: .defaults)))

        let notifications = try XCTUnwrap(body["notifications"] as? [String: Any])
        XCTAssertTrue(notifications["fx_pairs"] is NSNull, "nil (all pairs) must be sent as null, not omitted")
    }

    func testUpdateSendsAnExplicitNullToClearTheFxPair() throws {
        let body = try jsonObject(JSONEncoder().encode(SettingsUpdate(chart: .defaults)))

        let chart = try XCTUnwrap(body["chart"] as? [String: Any])
        XCTAssertTrue(chart["default_fx_pair_symbol"] is NSNull, "nil must be sent as null, not omitted")
        XCTAssertEqual(chart["default_timeframe"] as? String, "5m")
    }
}

// MARK: - SettingsService

final class SettingsServiceTests: XCTestCase {
    func testFetchSettingsCallsGetSettings() async throws {
        let apiClient = MockAPIClient()
        apiClient.result = .success(sampleSettings)

        let result = try await SettingsService(apiClient: apiClient).fetchSettings()

        XCTAssertEqual(apiClient.lastEndpoint?.path, "settings")
        XCTAssertEqual(apiClient.lastEndpoint?.method, .get)
        XCTAssertNil(apiClient.lastEndpoint?.body)
        XCTAssertEqual(result, sampleSettings)
    }

    func testUpdateSettingsPatchesTheEncodedBody() async throws {
        let apiClient = MockAPIClient()
        apiClient.result = .success(sampleSettings)

        _ = try await SettingsService(apiClient: apiClient).updateSettings(SettingsUpdate(display: sampleSettings.display))

        XCTAssertEqual(apiClient.lastEndpoint?.path, "settings")
        XCTAssertEqual(apiClient.lastEndpoint?.method, .patch)
        let body = try jsonObject(apiClient.lastEndpoint?.body)
        XCTAssertEqual(body["display"] as? [String: String], ["language": "en", "region": "US", "timezone": "America/New_York"])
    }
}

// MARK: - SettingsSectionViewModel (SCR-016 / SCR-018 / SCR-019)

@MainActor
final class SettingsSectionViewModelTests: XCTestCase {
    private func loadedViewModel(_ apiClient: MockAPIClient) async -> SettingsSectionViewModel<ChartSettings> {
        apiClient.result = .success(sampleSettings)
        let viewModel = SettingsSectionViewModel<ChartSettings>(apiClient: apiClient)
        viewModel.load()
        await waitUntil { viewModel.loadState != .loading }
        return viewModel
    }

    func testLoadShowsTheSavedSection() async {
        let viewModel = await loadedViewModel(MockAPIClient())

        XCTAssertEqual(viewModel.loadState, .loaded)
        XCTAssertEqual(viewModel.draft, sampleSettings.chart)
        XCTAssertFalse(viewModel.hasChanges)
        XCTAssertFalse(viewModel.canSave)
    }

    func testEachScreenReadsItsOwnSection() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(sampleSettings)
        let display = SettingsSectionViewModel<DisplaySettings>(apiClient: apiClient)
        let chart = SettingsSectionViewModel<ChartSettings>(apiClient: apiClient)
        display.load()
        chart.load()
        await waitUntil { display.loadState != .loading && chart.loadState != .loading }

        XCTAssertEqual(display.draft, sampleSettings.display)
        XCTAssertEqual(chart.draft, sampleSettings.chart)
    }

    func testLoadBackendNotConfigured() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.notConfigured)
        let viewModel = SettingsSectionViewModel<ChartSettings>(apiClient: apiClient)
        viewModel.load()
        await waitUntil { viewModel.loadState != .loading }

        XCTAssertEqual(viewModel.loadState, .backendNotConfigured)
    }

    func testLoadFailureShowsError() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.transport("connection reset"))
        let viewModel = SettingsSectionViewModel<DisplaySettings>(apiClient: apiClient)
        viewModel.load()
        await waitUntil { viewModel.loadState != .loading }

        guard case .error = viewModel.loadState else {
            return XCTFail("Expected .error, got \(viewModel.loadState)")
        }
    }

    func testSaveSendsOnlyThisSectionAndAdoptsTheResponse() async throws {
        let apiClient = MockAPIClient()
        let viewModel = await loadedViewModel(apiClient)
        viewModel.draft.defaultTimeframe = "60m"
        XCTAssertTrue(viewModel.canSave)

        var stored = sampleSettings
        stored.chart.defaultTimeframe = "60m"
        apiClient.result = .success(stored)
        viewModel.save()
        await waitUntil { viewModel.saveState != .saving }

        XCTAssertEqual(apiClient.lastEndpoint?.method, .patch)
        let body = try jsonObject(apiClient.lastEndpoint?.body)
        XCTAssertEqual(Set(body.keys), ["chart"])
        XCTAssertEqual(viewModel.saveState, .saved)
        XCTAssertEqual(viewModel.saved, stored.chart)
        XCTAssertFalse(viewModel.hasChanges)
    }

    func testEditingAfterSavingClearsTheSavedMessage() async {
        let apiClient = MockAPIClient()
        let viewModel = await loadedViewModel(apiClient)
        viewModel.draft.defaultTimeframe = "1m"
        var stored = sampleSettings
        stored.chart.defaultTimeframe = "1m"
        apiClient.result = .success(stored)
        viewModel.save()
        await waitUntil { viewModel.saveState != .saving }
        XCTAssertEqual(viewModel.saveState, .saved)

        viewModel.draft.defaultFxPairSymbol = nil

        XCTAssertEqual(viewModel.saveState, .idle)
    }

    func testSaveIsIgnoredWithoutChanges() async {
        let apiClient = MockAPIClient()
        let viewModel = await loadedViewModel(apiClient)

        viewModel.save()

        XCTAssertEqual(viewModel.saveState, .idle)
        XCTAssertEqual(apiClient.requestedPaths, ["settings"])
    }

    func testValidationErrorKeepsTheDraft() async {
        let apiClient = MockAPIClient()
        let viewModel = await loadedViewModel(apiClient)
        viewModel.draft.defaultTimeframe = "30m"
        apiClient.result = .failure(APIError.server(code: .validationError, message: "Invalid.", httpStatus: 422))

        viewModel.save()
        await waitUntil { viewModel.saveState != .saving }

        guard case .error = viewModel.saveState else {
            return XCTFail("Expected .error, got \(viewModel.saveState)")
        }
        XCTAssertEqual(viewModel.draft.defaultTimeframe, "30m")
        XCTAssertTrue(viewModel.hasChanges)
    }
}

// MARK: - SettingsOption

@MainActor
final class SettingsOptionTests: XCTestCase {
    func testIncludingKeepsAnUnlistedCurrentValue() {
        let options = DisplaySettingsView.timezones.including("Asia/Kolkata") { $0 }

        XCTAssertEqual(options.last?.value, "Asia/Kolkata")
        XCTAssertEqual(options.count, DisplaySettingsView.timezones.count + 1)
    }

    func testIncludingDoesNotDuplicateAListedValue() {
        XCTAssertEqual(ChartSettingsView.timeframes.including("5m") { $0 }.count, 5)
    }
}

// MARK: - FX pair candidates (provisional static catalog)

@MainActor
final class FXPairOptionsTests: XCTestCase {
    func testStaticCatalogMatchesTheBackendSeed() async throws {
        let symbols = try await StaticFXPairCatalog().availableSymbols()

        XCTAssertEqual(symbols, ["USDJPY", "EURUSD", "EURJPY"])
    }

    func testOptionsComeFromTheCatalogWithNoneFirst() {
        let options = ChartSettingsView.fxPairOptions(symbols: ["GBPJPY", "AUDUSD"], current: "GBPJPY")

        XCTAssertEqual(options.map(\.value), [nil, "GBPJPY", "AUDUSD"])
        XCTAssertEqual(options.map(\.label), ["指定なし", "GBP/JPY", "AUD/USD"])
    }

    func testOptionsKeepASavedPairTheCatalogDoesNotList() {
        let options = ChartSettingsView.fxPairOptions(symbols: [], current: "USDJPY")

        XCTAssertEqual(options.map(\.value), [nil, "USDJPY"])
        XCTAssertEqual(options.last?.label, "USD/JPY")
    }

    func testDisplayNameLeavesUnexpectedSymbolsAsIs() {
        XCTAssertEqual(FXPairSymbol.displayName("EURUSD"), "EUR/USD")
        XCTAssertEqual(FXPairSymbol.displayName("XAU"), "XAU")
    }
}
