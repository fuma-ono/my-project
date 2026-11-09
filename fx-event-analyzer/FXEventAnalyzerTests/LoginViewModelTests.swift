import XCTest
@testable import FXEventAnalyzer

@MainActor
final class LoginViewModelTests: XCTestCase {
    func testCanSubmitIsFalseWhenFieldsAreEmpty() {
        let viewModel = LoginViewModel(authService: MockAuthService()) { _ in }

        XCTAssertFalse(viewModel.canSubmit)

        viewModel.email = "user@example.com"
        XCTAssertFalse(viewModel.canSubmit, "password is still empty")

        viewModel.password = "hunter2"
        XCTAssertTrue(viewModel.canSubmit)
    }

    func testSubmitWhenAuthNotConfiguredShowsConfigurationError() async {
        let auth = MockAuthService(isConfigured: false)
        let viewModel = LoginViewModel(authService: auth) { _ in
            XCTFail("onSuccess should not be called when unconfigured")
        }
        viewModel.email = "user@example.com"
        viewModel.password = "hunter2"

        viewModel.submit()

        guard case .error(let message) = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
        XCTAssertTrue(message.contains("準備中"))
    }

    func testSubmitSuccessCallsOnSuccessWithSession() async {
        let auth = MockAuthService()
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        auth.signInResult = .success(session)

        let result: UserSession = await withCheckedContinuation { continuation in
            let viewModel = LoginViewModel(authService: auth) { session in
                continuation.resume(returning: session)
            }
            viewModel.email = "user@example.com"
            viewModel.password = "hunter2"
            viewModel.submit()
        }

        XCTAssertEqual(result, session)
    }

    func testSubmitInvalidCredentialsShowsErrorMessage() async {
        let auth = MockAuthService()
        auth.signInResult = .failure(AuthServiceError.invalidCredentials)

        let viewModel = LoginViewModel(authService: auth) { _ in
            XCTFail("onSuccess should not be called on invalid credentials")
        }
        viewModel.email = "user@example.com"
        viewModel.password = "wrong-password"
        viewModel.submit()

        // submit() dispatches asynchronously; poll briefly for the error state.
        for _ in 0..<20 {
            if case .error = viewModel.state { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }

        guard case .error(let message) = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
        XCTAssertTrue(message.contains("メールアドレス") || message.contains("パスワード"))
    }
}
