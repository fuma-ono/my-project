import Combine
import Foundation

/// Result of Splash's init sequence, reported once to `AppState` — see
/// `RootView`.
enum SplashOutcome: Equatable {
    case authenticated(UserSession)
    case unauthenticated
    case sessionExpired
}

/// What Splash shows *while it is still the active screen*. Once resolved,
/// `AppState` swaps Splash out entirely (ui-screens.md SCR-000: Splash is
/// not a place the user lingers or navigates within).
enum SplashState: Equatable {
    case initializing
    case initializationError
    case apiConnectionError
}

/// Drives SCR-000's 6-step init sequence (ui-screens.md 5.0節):
/// 1. app initial-state check, 2+5. Supabase Auth session check / logged-in
/// determination, 3+4. required settings / Backend API connectivity check,
/// 6. route.
///
/// Phase 1 note on step 3/4: no Backend exists yet (that's Phase 6), so
/// there is nothing to reach — this step is skipped rather than failed.
/// Once a Backend base URL is configured, a real reachability check
/// belongs here and *should* be able to fail into `.apiConnectionError`;
/// wiring that in is flagged as a Phase 6 follow-up in the Phase 1 report,
/// not silently dropped.
///
/// HQ指示(2026-11-05)「Splash先行通信・Home Cache起動高速化」: 認証復元
/// (step 2+5)が`.authenticated`で終わった直後、`HomePrefetchCoordinator`に
/// `/home`・`/entitlements`の先行取得を始めさせる(fire-and-forget)。先行取得
/// 自体が失敗してもSplashを`.apiConnectionError`にはしない — 失敗は
/// `HomeViewModel`/`PlanStore`側の既存のエラー処理(キャッシュ表示・
/// リトライ導線)にそのまま委ねる。認証復元前には一切通信しない
/// (未ログイン・セッション切れのときは先行取得を始めない)。
@MainActor
final class SplashViewModel: ObservableObject {
    @Published private(set) var state: SplashState = .initializing

    private let authService: AuthServicing
    private let apiClient: APIClient
    private let onFinished: (SplashOutcome) -> Void
    /// `private`ではない — `SplashView`が`SplashLoadingBar`に同じ値を渡し、バーの
    /// アニメーション時間を実際の待機時間と揃えるため(HQ指摘2026-11-09フォローアップ
    /// 「loadingバーは右端に達しているのに次に遷移されない」、`SplashLoadingBar.swift`参照)。
    let minimumDisplayDuration: Duration
    let maximumDisplayDuration: Duration
    private let prefetchCoordinator: HomePrefetchCoordinator
    private var hasStarted = false

    /// `minimumDisplayDuration`はSplashを少なくともこれだけ表示してから成功時に
    /// 先へ進む — `SplashLoadingBar`の一発アニメーション(1.6秒、そのファイル
    /// 参照)が最後まで再生される前に、init sequenceがほぼ即終わって切り替わって
    /// しまわないようにするため(ユーザー指摘「一瞬でサインイン画面に行く」)。
    /// 成功した場合だけ待つ(`.initializationError`は分かった時点ですぐ表示する)。
    ///
    /// `maximumDisplayDuration`は、先行取得(`/home`)の完了を待つ場合の上限。
    /// 下限(`minimumDisplayDuration`)に達した後、`/home`の先行取得が完了すれば
    /// その時点で先に進み(早期終了)、完了しなくてもこの上限に達したら先に進む
    /// (`/entitlements`だけ完了しても早期終了条件にはしない — Home表示に必須
    /// なのは`/home`の方で、`/entitlements`はキャッシュ表示の許可判定にしか
    /// 使わないため)。上限に達しても先行取得のTask自体はキャンセルしない
    /// (`HomePrefetchCoordinator`が保持し続け、`HomeViewModel`/`PlanStore`が
    /// 後から結果を受け取れる)。
    ///
    /// テストは`.zero`を渡して高速に保つ。
    init(
        authService: AuthServicing,
        apiClient: APIClient,
        minimumDisplayDuration: Duration = .seconds(1.6),
        maximumDisplayDuration: Duration = .seconds(4),
        prefetchCoordinator: HomePrefetchCoordinator = .shared,
        onFinished: @escaping (SplashOutcome) -> Void
    ) {
        self.authService = authService
        self.apiClient = apiClient
        self.minimumDisplayDuration = minimumDisplayDuration
        self.maximumDisplayDuration = maximumDisplayDuration
        self.prefetchCoordinator = prefetchCoordinator
        self.onFinished = onFinished
    }

    func start() {
        guard !hasStarted else { return }
        hasStarted = true
        Task { await runInitSequence() }
    }

    /// User-initiated retry from `.initializationError` /
    /// `.apiConnectionError` — HQ's explicit rule: never leave the user in
    /// infinite loading, always offer a way forward.
    func retry() {
        hasStarted = false
        state = .initializing
        start()
    }

    private func runInitSequence() async {
        let startedAt = ContinuousClock.now
        ClientTiming.log("label=runInitSequence.start process_uptime_s=\(ProcessInfo.processInfo.systemUptime)")
        // HQ指示(2026-10-20)「起動診断画面」: os.Loggerへのログ出力(上の行)
        // に加え、同じ計測イベントの場で構造化データとしても保持する。
        DiagnosticsStore.shared.recordRunInitSequenceStart()

        // Step 1: app initial-state check. Nothing beyond process launch to
        // verify in Phase 1.

        // Test-only instrumentation: a 60s hold here previously broke
        // XCUIApplication.launch() itself ("Timed out while launching
        // application via Xcode" — confirmed via a real CI failure), so
        // that approach was reverted to plain best-effort. Real CI runs
        // since then show automation-session-setup latency as low as
        // ~13s some runs, so a much shorter, safely-bounded hold — well
        // under whatever pushed 60s over the launch timeout — should
        // still catch Splash on faster runs without risking that failure
        // again. Only when the screenshot test target sets this launch
        // environment flag; never in the shipped app.
        if ProcessInfo.processInfo.environment["UI_SCREENSHOT_HOLD_SPLASH"] != nil {
            try? await Task.sleep(nanoseconds: 20_000_000_000)
        }

        // Step 2 + 5: Supabase Auth session check / logged-in determination.
        // HQ指示(2026-10-20)「初回起動が約30秒かかる原因調査」: セッション
        // 取得(トークンの検証・必要なら更新で、Supabaseへの通信が発生し
        // うる)にかかる時間を計測する。
        let session: UserSession?
        DiagnosticsStore.shared.recordSessionCheckStart()
        do {
            session = try await ClientTiming.measure("authService.currentSession") {
                try await authService.currentSession()
            }
        } catch {
            DiagnosticsStore.shared.recordSessionCheckEnd(succeeded: false)
            DiagnosticsStore.shared.recordRunInitSequenceFinished(succeeded: false)
            state = .initializationError
            return
        }
        DiagnosticsStore.shared.recordSessionCheckEnd(succeeded: true)

        let outcome: SplashOutcome
        var homeTask: Task<HomeResponse, Error>?
        if let session {
            outcome = session.isExpired ? .sessionExpired : .authenticated(session)
            // HQ指示(2026-11-05): 認証復元直後(ここ)が、Home関連の通信を始めて
            // よい最初のタイミング。セッション切れ(.sessionExpired)はログイン
            // 画面へ進むだけでHomeは出さないため、先行取得しない。
            if case .authenticated = outcome {
                homeTask = prefetchCoordinator.start(userID: session.userID, apiClient: apiClient)
            }
        } else {
            // Step 3 + 4: required initial settings / Backend API
            // connectivity — intentionally a no-op in Phase 1; see
            // file-level doc comment. 未ログインなので先行取得も始めない。
            outcome = .unauthenticated
        }

        // Step 6: route — but not before minimumDisplayDuration has
        // elapsed, so the loading bar isn't cut off mid-animation. 先行取得が
        // あれば、その完了(または上限)まで待ってから進む(doc comment参照)。
        await waitForDisplayDuration(since: startedAt, homeTask: homeTask)
        ClientTiming.log("label=runInitSequence.total duration_ms=\((ContinuousClock.now - startedAt).milliseconds)")
        DiagnosticsStore.shared.recordRunInitSequenceFinished(succeeded: true)
        onFinished(outcome)
    }

    private func waitForDisplayDuration(since startedAt: ContinuousClock.Instant, homeTask: Task<HomeResponse, Error>?) async {
        // 下限: 先行取得の有無・進捗に関わらず、Loadingバーのアニメーションぶんは
        // 必ずSplashを表示する。
        let elapsedAtMinCheck = ContinuousClock.now - startedAt
        if elapsedAtMinCheck < minimumDisplayDuration {
            try? await Task.sleep(for: minimumDisplayDuration - elapsedAtMinCheck)
        }
        guard let homeTask else { return }
        // 上限: 下限を満たした後、/homeの先行取得が完了するか、起動基準点から
        // maximumDisplayDurationに達するか、どちらか早い方まで待つ。
        let remaining = maximumDisplayDuration - (ContinuousClock.now - startedAt)
        guard remaining > .zero else { return }
        await Self.waitForHomeTaskOrTimeout(homeTask: homeTask, timeout: remaining)
    }

    /// `homeTask`の完了、または`timeout`の経過のどちらか早い方で返る。どちらが
    /// 先でも`homeTask`自体はキャンセルしない — `HomePrefetchCoordinator`が
    /// 保持し続け、`HomeViewModel`が後から結果を受け取れるようにするため。
    /// (`TaskGroup`は全ての子Taskの完了を待ってしまうため使わない — ここでは
    /// 構造化されていない`Task`を2つ立てて、先に終わった方だけを待つ。)
    private static func waitForHomeTaskOrTimeout(homeTask: Task<HomeResponse, Error>, timeout: Duration) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let box = ResumeOnceBox(continuation)
            Task {
                _ = try? await homeTask.value
                await box.resume()
            }
            Task {
                try? await Task.sleep(for: timeout)
                await box.resume()
            }
        }
    }
}

/// `waitForHomeTaskOrTimeout`の2つの競合するTaskのうち、先に終わった方だけが
/// continuationを再開できるようにする(2回目のresumeはCheckedContinuationが
/// トラップするため、actorで排他する)。
private actor ResumeOnceBox {
    private var resumed = false
    private let continuation: CheckedContinuation<Void, Never>

    init(_ continuation: CheckedContinuation<Void, Never>) {
        self.continuation = continuation
    }

    func resume() {
        guard !resumed else { return }
        resumed = true
        continuation.resume()
    }
}
