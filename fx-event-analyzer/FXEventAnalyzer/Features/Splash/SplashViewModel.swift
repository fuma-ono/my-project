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
@MainActor
final class SplashViewModel: ObservableObject {
    @Published private(set) var state: SplashState = .initializing

    private let authService: AuthServicing
    private let onFinished: (SplashOutcome) -> Void
    private var hasStarted = false

    init(authService: AuthServicing, onFinished: @escaping (SplashOutcome) -> Void) {
        self.authService = authService
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
        let session: UserSession?
        do {
            session = try await authService.currentSession()
        } catch {
            state = .initializationError
            return
        }

        if let session {
            if session.isExpired {
                onFinished(.sessionExpired)
            } else {
                onFinished(.authenticated(session))
            }
            return
        }

        // Step 3 + 4: required initial settings / Backend API connectivity
        // — intentionally a no-op in Phase 1; see file-level doc comment.

        // Step 6: route.
        onFinished(.unauthenticated)
    }
}
