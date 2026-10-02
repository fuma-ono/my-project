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
    notifications: NotificationSettings(preRelease: true, result: false, favorites: true, minImportance: 4),
    display: DisplaySettings(language: "en", region: "US", timezone: "America/New_York"),
    chart: ChartSettings(defaultFxPairSymbol: "USDJPY", defaultTimeframe: "15m")
)

// MARK: - Models (api-design.md §24.4/§24.5)

final class SettingsModelsTests: XCTestCase {
    func testDecodesTheSettingsResponseShape() throws {
        let json = """
        {
          "notifications": { "pre_release": true, "result": false, "favorites": true, "min_importance": 4 },
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
          "notifications": { "pre_release": true, "result": true, "favorites": true, "min_importance": 3 },
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
        XCTAssertEqual(notifications["pre_release"] as? Bool, true)
        XCTAssertEqual(notifications["result"] as? Bool, false)
        XCTAssertEqual(notifications["min_importance"] as? Int, 4)
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

// MARK: - SettingsSectionViewModel (SCR-018 / SCR-020 / SCR-021)

@MainActor
final class SettingsSectionViewModelTests: XCTestCase {
    private func loadedViewModel(_ apiClient: MockAPIClient) async -> SettingsSectionViewModel<NotificationSettings> {
        apiClient.result = .success(sampleSettings)
        let viewModel = SettingsSectionViewModel<NotificationSettings>(apiClient: apiClient)
        viewModel.load()
        await waitUntil { viewModel.loadState != .loading }
        return viewModel
    }

    func testLoadShowsTheSavedSection() async {
        let viewModel = await loadedViewModel(MockAPIClient())

        XCTAssertEqual(viewModel.loadState, .loaded)
        XCTAssertEqual(viewModel.draft, sampleSettings.notifications)
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
        viewModel.draft.minImportance = 5
        XCTAssertTrue(viewModel.canSave)

        var stored = sampleSettings
        stored.notifications.minImportance = 5
        apiClient.result = .success(stored)
        viewModel.save()
        await waitUntil { viewModel.saveState != .saving }

        XCTAssertEqual(apiClient.lastEndpoint?.method, .patch)
        let body = try jsonObject(apiClient.lastEndpoint?.body)
        XCTAssertEqual(Set(body.keys), ["notifications"])
        XCTAssertEqual(viewModel.saveState, .saved)
        XCTAssertEqual(viewModel.saved, stored.notifications)
        XCTAssertFalse(viewModel.hasChanges)
    }

    func testEditingAfterSavingClearsTheSavedMessage() async {
        let apiClient = MockAPIClient()
        let viewModel = await loadedViewModel(apiClient)
        viewModel.draft.result = true
        var stored = sampleSettings
        stored.notifications.result = true
        apiClient.result = .success(stored)
        viewModel.save()
        await waitUntil { viewModel.saveState != .saving }
        XCTAssertEqual(viewModel.saveState, .saved)

        viewModel.draft.favorites = false

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
        viewModel.draft.preRelease = false
        apiClient.result = .failure(APIError.server(code: .validationError, message: "Invalid.", httpStatus: 422))

        viewModel.save()
        await waitUntil { viewModel.saveState != .saving }

        guard case .error = viewModel.saveState else {
            return XCTFail("Expected .error, got \(viewModel.saveState)")
        }
        XCTAssertFalse(viewModel.draft.preRelease)
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
        XCTAssertEqual(ChartSettingsView.fxPairs.including(nil) { _ in "" }.count, ChartSettingsView.fxPairs.count)
        XCTAssertEqual(ChartSettingsView.timeframes.including("5m") { $0 }.count, 5)
    }
}
