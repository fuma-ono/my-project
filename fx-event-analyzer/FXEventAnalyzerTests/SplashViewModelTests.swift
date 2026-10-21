import XCTest
@testable import FXEventAnalyzer

/// HQ指示(2026-10-20)「既存テストの待機方法を修正」: 固定50msのsleepは
/// `runInitSequence()`の実行時間がその枠を超えた瞬間に(ログ出力の追加等、
/// 本来の意図と無関係な理由でも)失敗する不安定なテストだった。
/// `SettingsViewModelTests.swift`と同じ、状態が変わるまで短い間隔で
/// ポーリングする方式に統一する(最大1秒、10ms間隔)。タイムアウトしても
/// ループはただ抜けるだけで、後続の`XCTAssertEqual`等が実際の値で
/// 失敗する — 失敗を成功扱いにはしない。
private func waitUntil(_ condition: @escaping () -> Bool) async {
    for _ in 0..<100 {
        if condition() { return }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
}

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

        let viewModel = SplashViewModel(authService: auth, minimumDisplayDuration: .zero) { _ in
            XCTFail("onFinished should not be called when the init sequence fails")
        }
        viewModel.start()

        // HQ指示(2026-10-21「次回ビルドに向けたiOS改善」CI確認時)対応:
        // このテストだけファイル冒頭のコメントが指摘する固定50msの待機の
        // ままになっており、テスト件数の増加でCI実行がわずかに重くなった
        // ことで実際にタイムアウトし、CIが不安定になった(`state`がまだ
        // `.initializing`のまま検証してしまっていた)。同じファイル内の
        // `testRetryReRunsInitSequenceOnTheSameInstance`と同じ`waitUntil`
        // ポーリングに統一する(実装側の挙動は変えていない)。
        await waitUntil { viewModel.state == .initializationError }

        XCTAssertEqual(viewModel.state, .initializationError)
    }

    func testRetryReRunsInitSequenceOnTheSameInstance() async {
        let auth = MockAuthService()
        auth.sessionResult = .failure(AuthServiceError.network("offline"))

        var finishedOutcome: SplashOutcome?
        let viewModel = SplashViewModel(authService: auth, minimumDisplayDuration: .zero) { outcome in
            finishedOutcome = outcome
        }
        viewModel.start()
        await waitUntil { viewModel.state == .initializationError }
        XCTAssertEqual(viewModel.state, .initializationError)
        XCTAssertNil(finishedOutcome, "onFinished must not fire when the init sequence fails")

        auth.sessionResult = .success(nil)
        viewModel.retry()
        await waitUntil { finishedOutcome != nil }

        XCTAssertEqual(finishedOutcome, .unauthenticated)
    }

    // MARK: - Helper

    private func outcome(for auth: MockAuthService) async -> SplashOutcome {
        await withCheckedContinuation { continuation in
            let viewModel = SplashViewModel(authService: auth, minimumDisplayDuration: .zero) { outcome in
                continuation.resume(returning: outcome)
            }
            viewModel.start()
        }
    }
}
