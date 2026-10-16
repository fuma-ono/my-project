import XCTest
@testable import FXEventAnalyzer

private func waitUntil(_ condition: @escaping () -> Bool) async {
    for _ in 0..<100 {
        if condition() { return }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
}

/// SCR-009 minimum scope (Phase 5 §2): a working ログアウト導線.
@MainActor
final class SettingsViewModelTests: XCTestCase {
    func testSignOutSuccessCallsOnSignOutAndReturnsToIdle() async {
        let auth = MockAuthService(isConfigured: true)
        var signOutCallCount = 0
        let viewModel = SettingsViewModel(authService: auth) { signOutCallCount += 1 }

        viewModel.signOut()
        await waitUntil { viewModel.state != .signingOut }

        XCTAssertEqual(viewModel.state, .idle)
        XCTAssertEqual(signOutCallCount, 1)
    }

    func testSignOutFailureShowsErrorAndDoesNotCallOnSignOut() async {
        let auth = MockAuthService(isConfigured: true)
        auth.signOutError = AuthServiceError.network("connection reset")
        var signOutCallCount = 0
        let viewModel = SettingsViewModel(authService: auth) { signOutCallCount += 1 }

        viewModel.signOut()
        await waitUntil { viewModel.state != .signingOut }

        guard case .error = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
        XCTAssertEqual(signOutCallCount, 0)
    }

    /// Guards against a double-tap firing two concurrent sign-outs.
    func testSecondSignOutCallWhileInFlightIsANoOp() async {
        let auth = MockAuthService(isConfigured: true)
        var signOutCallCount = 0
        let viewModel = SettingsViewModel(authService: auth) { signOutCallCount += 1 }

        viewModel.signOut()
        viewModel.signOut() // re-entrant tap while the first is still in flight
        await waitUntil { viewModel.state != .signingOut }

        XCTAssertEqual(signOutCallCount, 1)
    }

    func testSignOutOnUnconfiguredBackendShowsError() async {
        let auth = MockAuthService(isConfigured: false)
        auth.signOutError = AuthServiceError.notConfigured
        var signOutCallCount = 0
        let viewModel = SettingsViewModel(authService: auth) { signOutCallCount += 1 }

        viewModel.signOut()
        await waitUntil { viewModel.state != .signingOut }

        guard case .error = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
        XCTAssertEqual(signOutCallCount, 0)
    }
}
