import XCTest
@testable import FXEventAnalyzer

@MainActor
final class SignUpViewModelTests: XCTestCase {
    func testCanSubmitRequiresMatchingNonEmptyPasswords() {
        let viewModel = SignUpViewModel(authService: MockAuthService()) { _ in }

        XCTAssertFalse(viewModel.canSubmit)

        viewModel.email = "user@example.com"
        XCTAssertFalse(viewModel.canSubmit, "passwords are still empty")

        viewModel.password = "hunter2"
        XCTAssertFalse(viewModel.canSubmit, "confirmPassword doesn't match yet")

        viewModel.confirmPassword = "hunter2"
        XCTAssertTrue(viewModel.canSubmit)
    }

    func testPasswordsMismatchOnlyFlagsOnceConfirmFieldIsNonEmpty() {
        let viewModel = SignUpViewModel(authService: MockAuthService()) { _ in }
        viewModel.password = "hunter2"

        XCTAssertFalse(viewModel.passwordsMismatch, "confirm field hasn't been touched yet")

        viewModel.confirmPassword = "different"
        XCTAssertTrue(viewModel.passwordsMismatch)

        viewModel.confirmPassword = "hunter2"
        XCTAssertFalse(viewModel.passwordsMismatch)
    }

    func testSubmitWhenAuthNotConfiguredShowsConfigurationError() {
        let auth = MockAuthService(isConfigured: false)
        let viewModel = SignUpViewModel(authService: auth) { _ in
            XCTFail("onSuccess should not be called when unconfigured")
        }
        viewModel.email = "user@example.com"
        viewModel.password = "hunter2"
        viewModel.confirmPassword = "hunter2"

        viewModel.submit()

        guard case .error(let message) = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
        XCTAssertTrue(message.contains("準備中"))
    }

    func testSubmitSignedInCallsOnSuccessWithSession() async {
        let auth = MockAuthService()
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        auth.signUpResult = .success(.signedIn(session))

        let result: UserSession = await withCheckedContinuation { continuation in
            let viewModel = SignUpViewModel(authService: auth) { session in
                continuation.resume(returning: session)
            }
            viewModel.email = "user@example.com"
            viewModel.password = "hunter2"
            viewModel.confirmPassword = "hunter2"
            viewModel.submit()
        }

        XCTAssertEqual(result, session)
    }

    func testSubmitConfirmationRequiredShowsConfirmationStateWithoutOnSuccess() async {
        let auth = MockAuthService()
        auth.signUpResult = .success(.confirmationRequired)

        let viewModel = SignUpViewModel(authService: auth) { _ in
            XCTFail("onSuccess should not be called when confirmation is pending")
        }
        viewModel.email = "user@example.com"
        viewModel.password = "hunter2"
        viewModel.confirmPassword = "hunter2"
        viewModel.submit()

        for _ in 0..<20 {
            if viewModel.state == .confirmationRequired { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }

        XCTAssertEqual(viewModel.state, .confirmationRequired)
    }

    func testSubmitEmailAlreadyInUseShowsErrorMessage() async {
        let auth = MockAuthService()
        auth.signUpResult = .failure(AuthServiceError.emailAlreadyInUse)

        let viewModel = SignUpViewModel(authService: auth) { _ in
            XCTFail("onSuccess should not be called on failure")
        }
        viewModel.email = "user@example.com"
        viewModel.password = "hunter2"
        viewModel.confirmPassword = "hunter2"
        viewModel.submit()

        for _ in 0..<20 {
            if case .error = viewModel.state { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }

        guard case .error(let message) = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
        XCTAssertTrue(message.contains("既に登録"))
    }

    func testSubmitWeakPasswordShowsSupabaseReasonVerbatim() async {
        let auth = MockAuthService()
        auth.signUpResult = .failure(AuthServiceError.weakPassword("パスワードが弱すぎます"))

        let viewModel = SignUpViewModel(authService: auth) { _ in
            XCTFail("onSuccess should not be called on failure")
        }
        viewModel.email = "user@example.com"
        viewModel.password = "123"
        viewModel.confirmPassword = "123"
        viewModel.submit()

        for _ in 0..<20 {
            if case .error = viewModel.state { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }

        guard case .error(let message) = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
        XCTAssertEqual(message, "パスワードが弱すぎます")
    }
}
