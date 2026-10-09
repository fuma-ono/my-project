import XCTest
@testable import FXEventAnalyzer

@MainActor
final class SplashViewModelTests: XCTestCase {
    func testNoSessionRoutesToUnauthenticated() async {
        let auth = MockAuthService()
        auth.sessionResult = .success(nil)

        let outcome = await outcome(for: auth)

        XCTAssertEqual(outcome, .unauthenticated)
    }

    func testValidSessionRoutesToAuthenticated() async {
        let auth = MockAuthService()
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        auth.sessionResult = .success(session)

        let outcome = await outcome(for: auth)

        XCTAssertEqual(outcome, .authenticated(session))
    }

    func testExpiredSessionRoutesToSessionExpired() async {
        let auth = MockAuthService()
        let expiredSession = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(-60))
        auth.sessionResult = .success(expiredSession)

        let outcome = await outcome(for: auth)

        XCTAssertEqual(outcome, .sessionExpired)
    }

    func testSessionCheckFailureShowsInitializationError() async {
        let auth = MockAuthService()
        auth.sessionResult = .failure(AuthServiceError.network("offline"))

        let viewModel = SplashViewModel(authService: auth) { _ in
            XCTFail("onFinished should not be called when the init sequence fails")
        }
        viewModel.start()

        // Allow the detached Task inside start() to run.
        await Task.yield()
        try? await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(viewModel.state, .initializationError)
    }

    func testRetryReRunsInitSequenceOnTheSameInstance() async {
        let auth = MockAuthService()
        auth.sessionResult = .failure(AuthServiceError.network("offline"))

        var finishedOutcome: SplashOutcome?
        let viewModel = SplashViewModel(authService: auth) { outcome in
            finishedOutcome = outcome
        }
        viewModel.start()
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(viewModel.state, .initializationError)
        XCTAssertNil(finishedOutcome, "onFinished must not fire when the init sequence fails")

        auth.sessionResult = .success(nil)
        viewModel.retry()
        try? await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(finishedOutcome, .unauthenticated)
    }

    // MARK: - Helper

    private func outcome(for auth: MockAuthService) async -> SplashOutcome {
        await withCheckedContinuation { continuation in
            let viewModel = SplashViewModel(authService: auth) { outcome in
                continuation.resume(returning: outcome)
            }
            viewModel.start()
        }
    }
}
