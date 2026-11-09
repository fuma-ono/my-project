import XCTest
@testable import FXEventAnalyzer

@MainActor
final class PasswordResetViewModelTests: XCTestCase {
    func testCanSubmitIsFalseWhenEmailIsEmpty() {
        let viewModel = PasswordResetViewModel(authService: MockAuthService())

        XCTAssertFalse(viewModel.canSubmit)

        viewModel.email = "user@example.com"
        XCTAssertTrue(viewModel.canSubmit)
    }

    func testSubmitWhenAuthNotConfiguredShowsConfigurationError() {
        let auth = MockAuthService(isConfigured: false)
        let viewModel = PasswordResetViewModel(authService: auth)
        viewModel.email = "user@example.com"

        viewModel.submit()

        guard case .error(let message) = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
        XCTAssertTrue(message.contains("準備中"))
    }

    func testSubmitSuccessShowsSentState() async {
        let auth = MockAuthService()
        let viewModel = PasswordResetViewModel(authService: auth)
        viewModel.email = "user@example.com"
        viewModel.submit()

        for _ in 0..<20 {
            if viewModel.state == .sent { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }

        XCTAssertEqual(viewModel.state, .sent)
    }

    func testSubmitFailureShowsErrorMessage() async {
        let auth = MockAuthService()
        auth.resetPasswordError = AuthServiceError.network("boom")
        let viewModel = PasswordResetViewModel(authService: auth)
        viewModel.email = "user@example.com"
        viewModel.submit()

        for _ in 0..<20 {
            if case .error = viewModel.state { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }

        guard case .error(let message) = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
        XCTAssertTrue(message.contains("送信に失敗"))
    }
}
