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

        // HQ指示(2026-11-02「iOS CI失敗の原因調査」): ここだけ固定50msのsleepが残っており、
        // CI(efb85f29、iOS Build & Test #1070 Attempt #2)で状態が変わる前に判定して落ちた
        // (期待 initializationError・実際 initializing)。状態が変わる前に起動診断の記録
        // (DiagnosticsStore、JSONの変換とUserDefaultsへの保存を4回)が入るため、混んだ
        // runnerでは50msを超えうる。ファイル冒頭の方針どおり、状態が変わるまで待つ形にする。
        await waitUntil { viewModel.state == .initializationError }

        XCTAssertEqual(viewModel.state, .initializationError)
    }

    /// セッション取得の失敗は、成功時の最低表示時間(`minimumDisplayDuration`)を待たずに
    /// すぐエラーを出す(SplashViewModelのinitの説明どおり)。待機を状態の変化の待ちに
    /// したことで、この仕様が弱まっていないことを確かめる: 最低表示時間を5秒にしても、
    /// 1秒以内(waitUntilの上限)にエラーになり、起動診断にも失敗として残る。
    func testSessionCheckFailureDoesNotWaitForMinimumDisplayDuration() async {
        let auth = MockAuthService()
        auth.sessionResult = .failure(AuthServiceError.network("offline"))

        let viewModel = SplashViewModel(authService: auth, minimumDisplayDuration: .seconds(5)) { _ in
            XCTFail("onFinished should not be called when the init sequence fails")
        }
        viewModel.start()
        await waitUntil { viewModel.state == .initializationError }

        XCTAssertEqual(viewModel.state, .initializationError)
        XCTAssertEqual(DiagnosticsStore.shared.current.sessionCheckOutcome, .failure)
        XCTAssertEqual(DiagnosticsStore.shared.current.runInitSequenceOutcome, .failure)
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
