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

    func testLoadSuccessShowsLoadedEvents() async {
        let apiClient = MockAPIClient()
        let events = [
            HomeEventSummary(id: "evt_1", indicatorName: "CPI", releaseDatetime: Date(), status: "SCHEDULED")
        ]
        apiClient.result = .success(HomeResponse(events: events))

        let viewModel = await load(with: apiClient)

        XCTAssertEqual(viewModel.state, .loaded(events))
    }

    func testLoadOtherFailureShowsGenericError() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.transport("connection reset"))

        let viewModel = await load(with: apiClient)

        guard case .error = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
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
