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
}
