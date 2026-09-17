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

// MARK: - IndicatorsViewModel (SCR-002)

@MainActor
final class IndicatorsViewModelTests: XCTestCase {
    func testLoadSuccessShowsLoadedIndicators() async {
        let apiClient = MockAPIClient()
        let indicator = IndicatorSummary(
            id: "ind_1", code: "US_CPI", name: "US CPI", countryCode: "US", currencyCode: "USD",
            importance: .high, description: "desc", frequency: "MONTHLY", unit: "%", source: "BLS",
            sourceUrl: nil, favorableDirection: .higherIsPositive
        )
        apiClient.result = .success(IndicatorsListResponse(data: [indicator], meta: PaginationMeta(page: 1, limit: 100, total: 1, hasNext: false)))

        let viewModel = IndicatorsViewModel(apiClient: apiClient)
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .loaded([indicator]))
    }

    func testLoadBackendNotConfigured() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.notConfigured)

        let viewModel = IndicatorsViewModel(apiClient: apiClient)
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .backendNotConfigured)
    }

    func testLoadGenericErrorShowsErrorState() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.transport("connection reset"))

        let viewModel = IndicatorsViewModel(apiClient: apiClient)
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        guard case .error = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
    }
}

// MARK: - IndicatorDetailViewModel (SCR-003)

@MainActor
final class IndicatorDetailViewModelTests: XCTestCase {
    func testLoadSuccessCombinesDetailAndRecentEvents() async {
        let apiClient = MockAPIClient()
        let indicator = IndicatorSummary(
            id: "ind_1", code: "US_CPI", name: "US CPI", countryCode: "US", currencyCode: "USD",
            importance: .high, description: nil, frequency: "MONTHLY", unit: "%", source: nil,
            sourceUrl: nil, favorableDirection: .higherIsPositive
        )
        let relatedFxPairs = [RelatedFxPairSummary(fxPairId: "fx_1", symbol: "USDJPY", priority: 1)]
        apiClient.results["indicators/ind_1"] = .success(IndicatorDetailResponse(indicator: indicator, relatedFxPairs: relatedFxPairs))

        let event = IndicatorEventSummary(
            id: "evt_1", releaseDatetime: Date(), status: .released, dataStatus: .ready,
            forecast: 3.1, actual: 3.3, previous: 3.0, surprise: 0.2, surpriseDirection: .positive
        )
        apiClient.results["indicators/ind_1/events"] = .success(
            IndicatorEventsListResponse(data: [event], meta: PaginationMeta(page: 1, limit: 10, total: 1, hasNext: false))
        )

        let viewModel = IndicatorDetailViewModel(apiClient: apiClient, indicatorId: "ind_1")
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .loaded(indicator: indicator, relatedFxPairs: relatedFxPairs, recentEvents: [event]))
        XCTAssertTrue(apiClient.requestedPaths.contains("indicators/ind_1"))
        XCTAssertTrue(apiClient.requestedPaths.contains("indicators/ind_1/events"))
    }

    func testLoadNotFoundIndicatorShowsError() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.server(code: .indicatorNotFound, message: "Indicator not found.", httpStatus: 404))

        let viewModel = IndicatorDetailViewModel(apiClient: apiClient, indicatorId: "missing")
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        guard case .error = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
    }

    func testLoadBackendNotConfigured() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.notConfigured)

        let viewModel = IndicatorDetailViewModel(apiClient: apiClient, indicatorId: "ind_1")
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .backendNotConfigured)
    }
}

// MARK: - EventDetailViewModel (SCR-004)

@MainActor
final class EventDetailViewModelTests: XCTestCase {
    private func makeResponse(revisionStatus: RevisionStatus = .none) -> EventDetailResponse {
        EventDetailResponse(
            event: EventDetailEvent(
                id: "evt_1", indicatorId: "ind_1", indicatorName: "US CPI", countryCode: "US", currencyCode: "USD",
                releaseDatetime: Date(), releaseDatetimePrecision: .exact, importance: .high,
                status: .released, dataStatus: .ready, revisionStatus: revisionStatus
            ),
            snapshot: EventSnapshotDetail(forecast: 3.1, actual: 3.3, previous: 3.0, unit: "%", source: "BLS", sourceUrl: nil),
            analysis: EventAnalysis(surprise: 0.2, surpriseDirection: .positive),
            explanation: EventExplanationDetail(summary: "summary", source: "BLS", sourceUrl: "https://example.com"),
            relatedFxPairs: [
                EventRelatedFxPair(
                    fxPairId: "fx_1", symbol: "USDJPY", priority: 1,
                    reaction: EventReactionSummary(timeframe: "5m", pips: 56.0, changePercent: 0.38, analysisStatus: .ready)
                )
            ],
            availableTimeframes: ["1m", "5m", "15m", "30m", "60m"]
        )
    }

    func testLoadSuccessShowsLoadedResponse() async {
        let apiClient = MockAPIClient()
        let response = makeResponse(revisionStatus: .revised)
        apiClient.result = .success(response)

        let viewModel = EventDetailViewModel(apiClient: apiClient, eventId: "evt_1")
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .loaded(response))
        XCTAssertEqual(apiClient.lastEndpoint?.path, "events/evt_1")
    }

    func testLoadNotFoundShowsNotFoundState() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.server(code: .eventNotFound, message: "Event not found.", httpStatus: 404))

        let viewModel = EventDetailViewModel(apiClient: apiClient, eventId: "missing")
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .notFound)
    }

    func testLoadFeatureNotEntitledShowsNotEntitledState() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(
            APIError.server(code: .featureNotEntitled, message: "VIEW_BASIC_EVENT required.", httpStatus: 403)
        )

        let viewModel = EventDetailViewModel(apiClient: apiClient, eventId: "evt_1")
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .notEntitled)
    }

    func testLoadBackendNotConfigured() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.notConfigured)

        let viewModel = EventDetailViewModel(apiClient: apiClient, eventId: "evt_1")
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .backendNotConfigured)
    }
}

// MARK: - HistoricalEventDetailViewModel (SCR-007)

@MainActor
final class HistoricalEventDetailViewModelTests: XCTestCase {
    func testLoadSuccessShowsLoadedResponseWithIndicatorId() async {
        let apiClient = MockAPIClient()
        let response = HistoricalEventDetailResponse(
            indicatorId: "ind_1",
            event: HistoricalEventSummary(id: "evt_1", indicatorName: "US CPI", releaseDatetime: Date(), importance: .high),
            snapshot: HistoricalSnapshot(forecast: 3.1, actual: 3.3, previous: 3.0, surprise: 0.2, surpriseDirection: .positive),
            explanation: nil,
            relatedFxPairs: []
        )
        apiClient.result = .success(response)

        let viewModel = HistoricalEventDetailViewModel(apiClient: apiClient, eventId: "evt_1")
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .loaded(response))
        XCTAssertEqual(apiClient.lastEndpoint?.path, "events/evt_1/history")
    }

    func testLoadFeatureNotEntitledShowsNotEntitledState() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(
            APIError.server(code: .subscriptionRequired, message: "VIEW_HISTORICAL required.", httpStatus: 403)
        )

        let viewModel = HistoricalEventDetailViewModel(apiClient: apiClient, eventId: "evt_1")
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .notEntitled)
    }

    func testLoadNotFoundShowsNotFoundState() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.server(code: .eventNotFound, message: "Event not found.", httpStatus: 404))

        let viewModel = HistoricalEventDetailViewModel(apiClient: apiClient, eventId: "missing")
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .notFound)
    }
}
