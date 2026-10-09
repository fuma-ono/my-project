import XCTest
@testable import FXEventAnalyzer

@MainActor
final class AppStateTests: XCTestCase {
    func testSplashFinishedAuthenticatedSetsLoggedIn() {
        let appState = AppState(authService: MockAuthService(isConfigured: false))
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))

        appState.splashFinished(outcome: .authenticated(session))

        XCTAssertEqual(appState.phase, .loggedIn)
    }

    func testSplashFinishedUnauthenticatedSetsLoggedOutWithoutExpiry() {
        let appState = AppState(authService: MockAuthService(isConfigured: false))

        appState.splashFinished(outcome: .unauthenticated)

        XCTAssertEqual(appState.phase, .loggedOut(sessionExpired: false))
    }

    func testSplashFinishedSessionExpiredSetsLoggedOutWithExpiry() {
        let appState = AppState(authService: MockAuthService(isConfigured: false))

        appState.splashFinished(outcome: .sessionExpired)

        XCTAssertEqual(appState.phase, .loggedOut(sessionExpired: true))
    }

    func testHandleSuccessfulLoginSetsLoggedIn() {
        let appState = AppState(authService: MockAuthService(isConfigured: false))
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))

        appState.handleSuccessfulLogin(session)

        XCTAssertEqual(appState.phase, .loggedIn)
    }

    func testSessionExpiryWhileLoggedInRoutesBackToLoggedOut() async {
        let auth = MockAuthService(isConfigured: true)
        auth.sessionResult = .success(nil)
        let appState = AppState(authService: auth)

        appState.splashFinished(outcome: .unauthenticated)
        XCTAssertEqual(appState.phase, .loggedOut(sessionExpired: false))

        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        appState.handleSuccessfulLogin(session)
        XCTAssertEqual(appState.phase, .loggedIn)

        auth.emit(.signedOut)

        for _ in 0..<50 {
            if appState.phase == .loggedOut(sessionExpired: true) { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }

        XCTAssertEqual(appState.phase, .loggedOut(sessionExpired: true))
    }

    /// Phase 5 §2: a deliberate ログアウト must never show "セッションの
    /// 有効期限が切れています" — that message is reserved for genuine
    /// expiry (see testSessionExpiryWhileLoggedInRoutesBackToLoggedOut).
    func testHandleSignOutSetsLoggedOutWithoutExpiry() {
        let appState = AppState(authService: MockAuthService(isConfigured: false))
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        appState.handleSuccessfulLogin(session)
        XCTAssertEqual(appState.phase, .loggedIn)

        appState.handleSignOut()

        XCTAssertEqual(appState.phase, .loggedOut(sessionExpired: false))
    }

    /// The auth state stream still emits its own `.signedOut` after a
    /// deliberate sign-out; by then `phase` is no longer `.loggedIn`, so it
    /// must not overwrite the already-correct (non-expired) logged-out state.
    func testHandleSignOutIsNotOverriddenByALaterSignedOutStreamEvent() async {
        let auth = MockAuthService(isConfigured: true)
        auth.sessionResult = .success(nil)
        let appState = AppState(authService: auth)
        appState.splashFinished(outcome: .unauthenticated)

        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        appState.handleSuccessfulLogin(session)
        XCTAssertEqual(appState.phase, .loggedIn)

        appState.handleSignOut()
        XCTAssertEqual(appState.phase, .loggedOut(sessionExpired: false))

        auth.emit(.signedOut)
        // Give the stream a moment to deliver; the guard in
        // startObservingAuthStateIfNeeded() only fires `sessionExpired: true`
        // from a `.loggedIn` phase, which we're no longer in.
        try? await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(appState.phase, .loggedOut(sessionExpired: false))
    }
}
