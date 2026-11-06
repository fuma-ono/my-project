import XCTest
@testable import FXEventAnalyzer

/// HQ指示(2026-10-20)「既存テストの待機方法を修正」: 固定50msのsleepは
/// `runInitSequence()`の実行時間がその枠を超えた瞬間に(ログ出力の追加等、
/// 本来の意図と無関係な理由でも)失敗する不安定なテストだった。
/// `SettingsViewModelTests.swift`と同じ、状態が変わるまで短い間隔で
/// ポーリングする方式に統一する(10ms間隔)。タイムアウトしても
/// ループはただ抜けるだけで、後続の`XCTAssertEqual`等が実際の値で
/// 失敗する — 失敗を成功扱いにはしない。
///
/// HQ指示(2026-11-04): 上限を「100回」(名目1秒)から実時間10秒に広げた。CI(65247bbf、
/// iOS Build & Test run 41751826193)で、混んだrunnerでは100回の待ちが実際には2.2秒かかり、
/// そのうえモックのセッション取得自体が637msかかって、状態が変わる直後(約5ms後)に判定して落ちた。
/// 条件が満たされればすぐ返るので、通常の実行時間は変わらない。
private func waitUntil(timeout: TimeInterval = 10, _ condition: @escaping () -> Bool) async {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
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

        let viewModel = SplashViewModel(authService: auth, apiClient: MockAPIClient(), minimumDisplayDuration: .zero) { _ in
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
    /// したことで、この仕様が弱まっていないことを確かめる: 最低表示時間を60秒にしても、
    /// waitUntilの上限(10秒)より前にエラーになり、起動診断にも失敗として残る。
    func testSessionCheckFailureDoesNotWaitForMinimumDisplayDuration() async {
        let auth = MockAuthService()
        auth.sessionResult = .failure(AuthServiceError.network("offline"))

        let viewModel = SplashViewModel(authService: auth, apiClient: MockAPIClient(), minimumDisplayDuration: .seconds(60)) { _ in
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
        let viewModel = SplashViewModel(authService: auth, apiClient: MockAPIClient(), minimumDisplayDuration: .zero) { outcome in
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

    // MARK: - 先行取得(HQ指示 2026-11-05「Splash先行通信・Home Cache起動高速化」)

    /// 認証復元前には`HomePrefetchCoordinator`に何も登録されない — セッション
    /// 取得が完了するまで通信を始めないことの確認。
    func testPrefetchDoesNotStartBeforeSessionCheckResolves() async {
        let auth = MockAuthService()
        auth.sessionResult = .success(nil) // 未ログイン
        let coordinator = HomePrefetchCoordinator()
        let userID = UUID()

        _ = await outcome(for: auth, coordinator: coordinator)

        XCTAssertNil(coordinator.consumeHome(for: userID), "unauthenticated launches must never start a prefetch")
    }

    /// セッション切れ(`.sessionExpired`)はログイン画面へ進むだけで、Home関連の
    /// 通信は始めない(従来の動作を維持)。
    func testPrefetchDoesNotStartForAnExpiredSession() async {
        let auth = MockAuthService()
        let expiredSession = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(-60))
        auth.sessionResult = .success(expiredSession)
        let coordinator = HomePrefetchCoordinator()

        _ = await outcome(for: auth, coordinator: coordinator)

        XCTAssertNil(coordinator.consumeHome(for: expiredSession.userID))
    }

    /// 認証復元が成功した直後に、`HomePrefetchCoordinator`へ先行取得が登録され、
    /// 消費できることを確認する(これが無ければ`HomeViewModel`は常に新規取得に
    /// フォールバックしてしまう)。
    func testPrefetchStartsRightAfterAuthenticatedSessionResolves() async {
        let auth = MockAuthService()
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        auth.sessionResult = .success(session)
        let coordinator = HomePrefetchCoordinator()
        let api = MockAPIClient()
        api.results["home"] = .success(HomeResponse(date: "2026-11-05", timezone: "UTC", events: [], majorFx: []))

        _ = await outcome(for: auth, coordinator: coordinator, apiClient: api)

        let prefetched = coordinator.consumeHome(for: session.userID)
        XCTAssertNotNil(prefetched, "an authenticated launch must register a /home prefetch")
        _ = try? await prefetched?.value
        XCTAssertEqual(api.requestedPaths.filter { $0 == "home" }.count, 1)
    }

    /// Splashは下限(1.6秒等)未満では終わらない — 先行取得が即座に終わっても、
    /// Loadingバーのアニメーションぶんは必ず表示する。
    func testSplashNeverFinishesBeforeTheMinimumDisplayDuration() async {
        let auth = MockAuthService()
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        auth.sessionResult = .success(session)
        let coordinator = HomePrefetchCoordinator()
        let api = MockAPIClient()
        api.results["home"] = .success(HomeResponse(date: "2026-11-05", timezone: "UTC", events: [], majorFx: [])) // 即座に成功する

        let startedAt = Date()
        var finished = false
        let viewModel = SplashViewModel(
            authService: auth, apiClient: api, minimumDisplayDuration: .milliseconds(200),
            maximumDisplayDuration: .seconds(4), prefetchCoordinator: coordinator
        ) { _ in finished = true }
        viewModel.start()
        await waitUntil { finished }

        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(startedAt), 0.2, "must not finish before the minimum display duration")
    }

    /// `/home`の先行取得が下限より後・上限より前に完了したら、上限まで待たずに
    /// 早期終了する。
    func testSplashFinishesEarlyWhenHomePrefetchCompletesBeforeTheMaximum() async {
        let auth = MockAuthService()
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        auth.sessionResult = .success(session)
        let coordinator = HomePrefetchCoordinator()
        let api = DelayedAPIClient(delay: .milliseconds(50))
        api.results["home"] = .success(HomeResponse(date: "2026-11-05", timezone: "UTC", events: [], majorFx: []))

        let startedAt = Date()
        var finished = false
        let viewModel = SplashViewModel(
            authService: auth, apiClient: api, minimumDisplayDuration: .milliseconds(50),
            maximumDisplayDuration: .seconds(3), prefetchCoordinator: coordinator
        ) { _ in finished = true }
        viewModel.start()
        await waitUntil { finished }

        let elapsed = Date().timeIntervalSince(startedAt)
        XCTAssertLessThan(elapsed, 1.0, "the 50ms /home prefetch must let Splash finish well before the 3s maximum")
    }

    /// `/home`が上限(4秒相当)までに終わらなければ、Splashは上限で先に進む
    /// (無期限には待たない)。`/home`のTask自体はキャンセルされず、後から
    /// `HomeViewModel`が結果を受け取れる。
    func testSplashFinishesAtTheMaximumWhenHomePrefetchNeverCompletesInTime() async {
        let auth = MockAuthService()
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        auth.sessionResult = .success(session)
        let coordinator = HomePrefetchCoordinator()
        let api = DelayedAPIClient(delay: .seconds(10)) // 上限よりずっと遅い
        api.results["home"] = .success(HomeResponse(date: "2026-11-05", timezone: "UTC", events: [], majorFx: []))

        let startedAt = Date()
        var finished = false
        let viewModel = SplashViewModel(
            authService: auth, apiClient: api, minimumDisplayDuration: .milliseconds(50),
            maximumDisplayDuration: .milliseconds(300), prefetchCoordinator: coordinator
        ) { _ in finished = true }
        viewModel.start()
        await waitUntil { finished }

        let elapsed = Date().timeIntervalSince(startedAt)
        XCTAssertLessThan(elapsed, 1.0, "must not wait past the maximum display duration")
        XCTAssertGreaterThanOrEqual(elapsed, 0.3, "must still wait at least the maximum before giving up")
        // 上限で先に進んでも、先行取得のTaskはキャンセルされず保持され続ける。
        XCTAssertNotNil(coordinator.consumeHome(for: session.userID), "the prefetch task must survive past the Splash timeout")
    }

    /// `/entitlements`だけが先に完了しても早期終了条件にはしない(`/home`の完了
    /// だけを見る)。
    func testEntitlementsCompletingAloneDoesNotTriggerEarlyExit() async {
        let auth = MockAuthService()
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        auth.sessionResult = .success(session)
        let coordinator = HomePrefetchCoordinator()
        // /entitlementsはすぐ成功するが、/homeは上限(200ms)より遅い(400ms)。
        // /entitlementsの完了を早期終了条件にしてしまう実装なら、ここで
        // 上限よりずっと早く(50〜100ms程度で)終わってしまうはず。
        let api = DelayedAPIClient(delays: ["entitlements": .milliseconds(10), "home": .milliseconds(400)])
        api.results["home"] = .success(HomeResponse(date: "2026-11-05", timezone: "UTC", events: [], majorFx: []))
        api.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil))

        let startedAt = Date()
        var finished = false
        let viewModel = SplashViewModel(
            authService: auth, apiClient: api, minimumDisplayDuration: .milliseconds(50),
            maximumDisplayDuration: .milliseconds(200), prefetchCoordinator: coordinator
        ) { _ in finished = true }
        viewModel.start()
        await waitUntil { finished }

        let elapsed = Date().timeIntervalSince(startedAt)
        XCTAssertGreaterThanOrEqual(elapsed, 0.2, "/entitlements finishing early must not trigger Splash's early exit")
        XCTAssertLessThan(elapsed, 0.6, "must give up at the maximum, not wait for the slower /home")
    }

    /// 通信失敗(オフライン等)時も、先行取得自体はSplashを`.apiConnectionError`
    /// にしない — 既存のエラー処理(Home側のリトライ導線)に委ねる。
    func testPrefetchFailureDoesNotShowAnErrorScreen() async {
        let auth = MockAuthService()
        let session = UserSession(userID: UUID(), accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
        auth.sessionResult = .success(session)
        let coordinator = HomePrefetchCoordinator()
        let api = MockAPIClient()
        api.results["home"] = .failure(APIError.transport("offline"))
        api.results["entitlements"] = .failure(APIError.transport("offline"))

        var finishedOutcome: SplashOutcome?
        let viewModel = SplashViewModel(
            authService: auth, apiClient: api, minimumDisplayDuration: .zero,
            maximumDisplayDuration: .milliseconds(200), prefetchCoordinator: coordinator
        ) { outcome in finishedOutcome = outcome }
        viewModel.start()
        await waitUntil { finishedOutcome != nil }

        XCTAssertEqual(finishedOutcome, .authenticated(session), "a failed prefetch must still route to Home as usual")
    }

    // MARK: - Helper

    private func outcome(
        for auth: MockAuthService, coordinator: HomePrefetchCoordinator? = nil, apiClient: APIClient = MockAPIClient()
    ) async -> SplashOutcome {
        let coordinator = coordinator ?? HomePrefetchCoordinator()
        return await withCheckedContinuation { continuation in
            let viewModel = SplashViewModel(
                authService: auth, apiClient: apiClient, minimumDisplayDuration: .zero, prefetchCoordinator: coordinator
            ) { outcome in
                continuation.resume(returning: outcome)
            }
            viewModel.start()
        }
    }
}
