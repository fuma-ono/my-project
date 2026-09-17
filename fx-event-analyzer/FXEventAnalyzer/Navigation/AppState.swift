import Combine
import Foundation

/// Drives which top-level screen `RootView` shows. Deliberately small — a
/// single published phase, no generic routing/deep-link machinery, since
/// Phase 1 only needs SCR-000 → SCR-010 / SCR-001 (design.md 15.1節).
@MainActor
final class AppState: ObservableObject {
    enum Phase: Equatable {
        case launching
        case loggedOut(sessionExpired: Bool)
        case loggedIn
    }

    @Published private(set) var phase: Phase = .launching

    private let authService: AuthServicing
    private var observationTask: Task<Void, Never>?

    init(authService: AuthServicing) {
        self.authService = authService
    }

    /// Called once by `SplashViewModel` when its init sequence (auth
    /// session check, per ui-screens.md SCR-000) has resolved.
    func splashFinished(outcome: SplashOutcome) {
        switch outcome {
        case .authenticated:
            phase = .loggedIn
        case .unauthenticated:
            phase = .loggedOut(sessionExpired: false)
        case .sessionExpired:
            phase = .loggedOut(sessionExpired: true)
        }
        startObservingAuthStateIfNeeded()
    }

    /// Called by `LoginViewModel` after a successful sign-in.
    func handleSuccessfulLogin(_ session: UserSession) {
        phase = .loggedIn
    }

    /// Called by `SettingsViewModel` after a deliberate, user-initiated
    /// sign-out succeeds. Deliberately distinct from the `.signedOut`
    /// branch in `startObservingAuthStateIfNeeded()` below — that path means
    /// "セッションの有効期限が切れています", which would be the wrong
    /// message for a user who just tapped ログアウト themselves. The auth
    /// state stream still delivers its own `.signedOut` event after this
    /// runs; by then `phase` is no longer `.loggedIn`, so that handler's
    /// guard makes it a no-op.
    func handleSignOut() {
        phase = .loggedOut(sessionExpired: false)
    }

    /// Starts listening for auth state changes that happen *after* launch —
    /// most importantly session expiry while the user is already on Home,
    /// which must route back to SCR-010 with the "セッションの有効期限が
    /// 切れています" message (ui-screens.md SCR-000 "Session Expired"
    /// applies for the whole app session, not only at startup).
    private func startObservingAuthStateIfNeeded() {
        guard observationTask == nil, authService.isConfigured else { return }
        observationTask = Task { [authService] in
            for await event in authService.authStateChanges() {
                switch event {
                case .signedIn:
                    if self.phase != .loggedIn {
                        self.phase = .loggedIn
                    }
                case .signedOut:
                    if case .loggedIn = self.phase {
                        self.phase = .loggedOut(sessionExpired: true)
                    }
                }
            }
        }
    }
}
