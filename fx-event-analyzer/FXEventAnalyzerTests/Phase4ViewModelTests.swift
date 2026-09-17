import XCTest
@testable import FXEventAnalyzer

private func waitUntil(_ condition: @escaping () -> Bool) async {
    for _ in 0..<100 {
        if condition() { return }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
}

// MARK: - MovementDetailViewModel (SCR-005)

@MainActor
final class MovementDetailViewModelTests: XCTestCase {
    private func makeReactions(fivMinStatus: DataQualityStatus = .ready) -> ReactionAllTimeframesResponse {
        ReactionAllTimeframesResponse(
            eventId: "evt_1",
            fxPairId: "fx_1",
            preReleasePrice: 147.123,
            reactions: ReactionTimeframe.all.map { timeframe in
                ReactionTimeframeEntry(
                    timeframe: timeframe,
                    postReleasePrice: 147.403,
                    movement: 0.28,
                    pips: 28.0,
                    changePercent: 0.19,
                    maxUpward: 0.30,
                    maxDownward: -0.05,
                    maxUpwardPips: 30.0,
                    maxDownwardPips: -5.0,
                    analysisStatus: timeframe == "5m" ? fivMinStatus : .ready
                )
            }
        )
    }

    private func makeChart(timeframe: String) -> ChartResponse {
        ChartResponse(
            eventId: "evt_1",
            fxPairId: "fx_1",
            timeframe: timeframe,
            releaseDatetime: Date(),
            prices: [
                ChartPricePoint(timestamp: Date(), open: 147.0, high: 147.5, low: 146.9, close: 147.2, volume: nil),
            ]
        )
    }

    func testLoadSuccessLoadsReactionsThenChartForDefaultTimeframe() async {
        let apiClient = MockAPIClient()
        apiClient.results["events/evt_1/reaction"] = .success(makeReactions())
        apiClient.results["events/evt_1/reaction/chart"] = .success(makeChart(timeframe: "5m"))

        let viewModel = MovementDetailViewModel(
            apiClient: apiClient, eventId: "evt_1", fxPairId: "fx_1", symbol: "USDJPY",
            indicatorName: "US CPI", releaseDatetime: Date()
        )
        viewModel.load()
        await waitUntil { viewModel.chartState != .loading }

        guard case .loaded(let preReleasePrice, let reactions) = viewModel.state else {
            return XCTFail("Expected .loaded state, got \(viewModel.state)")
        }
        XCTAssertEqual(preReleasePrice, 147.123)
        XCTAssertEqual(reactions.count, 5)
        guard case .loaded(let chart) = viewModel.chartState else {
            return XCTFail("Expected chart .loaded state, got \(viewModel.chartState)")
        }
        XCTAssertEqual(chart.timeframe, "5m")
        XCTAssertEqual(apiClient.lastEndpoint?.queryItems.first(where: { $0.name == "timeframe" })?.value, "5m")
    }

    func testChangingTimeframeRefetchesChartWithTheNewTimeframe() async {
        let apiClient = MockAPIClient()
        apiClient.results["events/evt_1/reaction"] = .success(makeReactions())
        apiClient.results["events/evt_1/reaction/chart"] = .success(makeChart(timeframe: "5m"))

        let viewModel = MovementDetailViewModel(
            apiClient: apiClient, eventId: "evt_1", fxPairId: "fx_1", symbol: "USDJPY",
            indicatorName: "US CPI", releaseDatetime: Date()
        )
        viewModel.load()
        await waitUntil { viewModel.chartState != .loading }

        apiClient.results["events/evt_1/reaction/chart"] = .success(makeChart(timeframe: "15m"))
        viewModel.selectedTimeframe = "15m"
        await waitUntil {
            if case .loaded(let chart) = viewModel.chartState { return chart.timeframe == "15m" }
            return false
        }

        XCTAssertEqual(apiClient.lastEndpoint?.path, "events/evt_1/reaction/chart")
        XCTAssertEqual(apiClient.lastEndpoint?.queryItems.first(where: { $0.name == "timeframe" })?.value, "15m")
    }

    func testReactionsIncludeEveryDataQualityStateWithoutRecomputation() async {
        let apiClient = MockAPIClient()
        apiClient.results["events/evt_1/reaction"] = .success(makeReactions(fivMinStatus: .notAnalyzable))
        apiClient.results["events/evt_1/reaction/chart"] = .success(makeChart(timeframe: "5m"))

        let viewModel = MovementDetailViewModel(
            apiClient: apiClient, eventId: "evt_1", fxPairId: "fx_1", symbol: "USDJPY",
            indicatorName: "US CPI", releaseDatetime: Date()
        )
        viewModel.load()
        await waitUntil { viewModel.chartState != .loading }

        guard case .loaded(_, let reactions) = viewModel.state else {
            return XCTFail("Expected .loaded state")
        }
        let fiveMin = reactions.first { $0.timeframe == "5m" }
        XCTAssertEqual(fiveMin?.analysisStatus, .notAnalyzable)
        // Backend-provided values pass through unchanged — never recomputed.
        XCTAssertEqual(fiveMin?.pips, 28.0)
        XCTAssertEqual(fiveMin?.maxUpwardPips, 30.0)
        XCTAssertEqual(fiveMin?.maxDownwardPips, -5.0)
    }

    func testLoadNotFoundShowsNotFoundState() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.server(code: .fxPairNotFound, message: "FX pair not found.", httpStatus: 404))

        let viewModel = MovementDetailViewModel(
            apiClient: apiClient, eventId: "evt_1", fxPairId: "missing", symbol: "USDJPY",
            indicatorName: "US CPI", releaseDatetime: Date()
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .notFound)
    }

    func testLoadFeatureNotEntitledShowsNotEntitledState() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(
            APIError.server(code: .featureNotEntitled, message: "VIEW_MARKET_REACTION required.", httpStatus: 403)
        )

        let viewModel = MovementDetailViewModel(
            apiClient: apiClient, eventId: "evt_1", fxPairId: "fx_1", symbol: "USDJPY",
            indicatorName: "US CPI", releaseDatetime: Date()
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .notEntitled)
    }

    func testLoadBackendNotConfigured() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.notConfigured)

        let viewModel = MovementDetailViewModel(
            apiClient: apiClient, eventId: "evt_1", fxPairId: "fx_1", symbol: "USDJPY",
            indicatorName: "US CPI", releaseDatetime: Date()
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .backendNotConfigured)
    }
}

// MARK: - HistoricalComparisonViewModel (SCR-006)

@MainActor
final class HistoricalComparisonViewModelTests: XCTestCase {
    private func makeResponse(
        totalEvents: Int = 20,
        analyzableEvents: Int = 18,
        advancedAvailable: Bool = true,
        events: [ComparisonEventSummary] = []
    ) -> ComparisonResponse {
        ComparisonResponse(
            indicator: ComparisonIndicatorSummary(id: "ind_1", code: "US_CPI", name: "US CPI"),
            fxPairId: "fx_1",
            timeframe: "5m",
            totalEvents: totalEvents,
            analyzableEvents: analyzableEvents,
            stats: ComparisonStats(
                averageMovement: 0.21, averagePips: 21.0, maxMovement: 0.55, minMovement: -0.30,
                upwardCount: 12, downwardCount: 6, noChangeCount: 0
            ),
            advancedStatistics: AdvancedStatistics(
                available: advancedAvailable,
                requiredEntitlement: advancedAvailable ? nil : "VIEW_ADVANCED_STATS",
                data: advancedAvailable ? AdvancedStatisticsData(averageAbsoluteMovement: 0.28, averageAbsolutePips: 28.0) : nil
            ),
            events: events,
            meta: PaginationMeta(page: 1, limit: 20, total: totalEvents, hasNext: false)
        )
    }

    func testLoadSuccessShowsNormalStats() async {
        let apiClient = MockAPIClient()
        let response = makeResponse()
        apiClient.result = .success(response)

        let viewModel = HistoricalComparisonViewModel(
            apiClient: apiClient, indicatorId: "ind_1", indicatorName: "US CPI", fxPairId: "fx_1", fxPairSymbol: "USDJPY"
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .loaded(response))
        XCTAssertEqual(apiClient.lastEndpoint?.path, "indicators/ind_1/comparison")
    }

    func testLoadSuccessShowsEmptyHistory() async {
        let apiClient = MockAPIClient()
        let response = makeResponse(totalEvents: 0, analyzableEvents: 0, events: [])
        apiClient.result = .success(response)

        let viewModel = HistoricalComparisonViewModel(
            apiClient: apiClient, indicatorId: "ind_5", indicatorName: "BOJ Rate", fxPairId: "fx_1", fxPairSymbol: "USDJPY"
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        guard case .loaded(let loadedResponse) = viewModel.state else {
            return XCTFail("Expected .loaded state")
        }
        XCTAssertEqual(loadedResponse.totalEvents, 0)
        XCTAssertTrue(loadedResponse.events.isEmpty)
    }

    func testLoadSuccessShowsIncompleteDataDistinctFromTotal() async {
        let apiClient = MockAPIClient()
        let response = makeResponse(totalEvents: 20, analyzableEvents: 12)
        apiClient.result = .success(response)

        let viewModel = HistoricalComparisonViewModel(
            apiClient: apiClient, indicatorId: "ind_1", indicatorName: "US CPI", fxPairId: "fx_1", fxPairSymbol: "USDJPY"
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        guard case .loaded(let loadedResponse) = viewModel.state else {
            return XCTFail("Expected .loaded state")
        }
        XCTAssertNotEqual(loadedResponse.totalEvents, loadedResponse.analyzableEvents)
    }

    func testAdvancedStatisticsAvailableForProUser() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(makeResponse(advancedAvailable: true))

        let viewModel = HistoricalComparisonViewModel(
            apiClient: apiClient, indicatorId: "ind_1", indicatorName: "US CPI", fxPairId: "fx_1", fxPairSymbol: "USDJPY"
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        guard case .loaded(let response) = viewModel.state else {
            return XCTFail("Expected .loaded state")
        }
        XCTAssertTrue(response.advancedStatistics.available)
        XCTAssertNotNil(response.advancedStatistics.data)
    }

    func testAdvancedStatisticsGatedForFreeUser() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(makeResponse(advancedAvailable: false))

        let viewModel = HistoricalComparisonViewModel(
            apiClient: apiClient, indicatorId: "ind_1", indicatorName: "US CPI", fxPairId: "fx_1", fxPairSymbol: "USDJPY"
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        guard case .loaded(let response) = viewModel.state else {
            return XCTFail("Expected .loaded state")
        }
        // available:false must never be confused with "no data" — Entitlement gating only.
        XCTAssertFalse(response.advancedStatistics.available)
        XCTAssertEqual(response.advancedStatistics.requiredEntitlement, "VIEW_ADVANCED_STATS")
        XCTAssertNil(response.advancedStatistics.data)
    }

    func testChangingTimeframeReloads() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(makeResponse())

        let viewModel = HistoricalComparisonViewModel(
            apiClient: apiClient, indicatorId: "ind_1", indicatorName: "US CPI", fxPairId: "fx_1", fxPairSymbol: "USDJPY"
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        viewModel.selectedTimeframe = "15m"
        await waitUntil {
            apiClient.lastEndpoint?.queryItems.first(where: { $0.name == "timeframe" })?.value == "15m"
        }

        XCTAssertEqual(apiClient.lastEndpoint?.queryItems.first(where: { $0.name == "timeframe" })?.value, "15m")
    }

    func testLoadNotEntitledShowsNotEntitledState() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(
            APIError.server(code: .subscriptionRequired, message: "VIEW_HISTORICAL required.", httpStatus: 403)
        )

        let viewModel = HistoricalComparisonViewModel(
            apiClient: apiClient, indicatorId: "ind_1", indicatorName: "US CPI", fxPairId: "fx_1", fxPairSymbol: "USDJPY"
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .notEntitled)
    }

    func testLoadNotFoundShowsNotFoundState() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.server(code: .fxPairNotFound, message: "FX pair not found.", httpStatus: 404))

        let viewModel = HistoricalComparisonViewModel(
            apiClient: apiClient, indicatorId: "ind_1", indicatorName: "US CPI", fxPairId: "missing", fxPairSymbol: "USDJPY"
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .notFound)
    }
}
