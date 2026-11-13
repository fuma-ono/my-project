import XCTest
@testable import FXEventAnalyzer

@MainActor
final class HomeViewModelTests: XCTestCase {
    func testLoadWithNoBackendConfiguredShowsBackendNotConfigured() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.notConfigured)

        let viewModel = await load(with: apiClient)

        XCTAssertEqual(viewModel.state, .backendNotConfigured)
    }

    func testLoadSuccessSplitsEventsByStatus() async {
        let apiClient = MockAPIClient()
        let scheduled = Self.makeEvent(id: "evt_scheduled", status: .scheduled)
        let released = Self.makeEvent(id: "evt_released", status: .released)
        apiClient.result = .success(HomeResponse(date: "2026-09-17", timezone: "UTC", events: [scheduled, released], majorFx: []))

        let viewModel = await load(with: apiClient)

        XCTAssertEqual(viewModel.state, .loaded(events: [scheduled, released], majorFx: []))
        XCTAssertEqual(viewModel.upcomingEvents, [scheduled])
        XCTAssertEqual(viewModel.recentEvents, [released])
    }

    func testLoadOtherFailureShowsGenericError() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.transport("connection reset"))

        let viewModel = await load(with: apiClient)

        guard case .error = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
    }

    // MARK: - Fixtures

    private static func makeEvent(id: String, status: EventStatus) -> HomeEventSummary {
        HomeEventSummary(
            id: id,
            indicatorId: "ind_1",
            indicatorName: "US CPI",
            countryCode: "US",
            currencyCode: "USD",
            importance: .high,
            releaseDatetime: Date(),
            releaseDatetimePrecision: .exact,
            status: status,
            dataStatus: .ready,
            forecast: 3.1,
            actual: status == .released ? 3.3 : nil,
            previous: 3.0,
            surprise: status == .released ? 0.2 : nil,
            surpriseDirection: status == .released ? .positive : nil,
            relatedFxPairs: []
        )
    }

    // MARK: - Helper

    /// `load()` dispatches asynchronously; poll briefly until it settles out
    /// of `.loading` rather than assuming a fixed delay is always enough.
    private func load(with apiClient: MockAPIClient) async -> HomeViewModel {
        let viewModel = HomeViewModel(apiClient: apiClient)
        viewModel.load()
        for _ in 0..<50 {
            if viewModel.state != .loading { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return viewModel
    }
}
