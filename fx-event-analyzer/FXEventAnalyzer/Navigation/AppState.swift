import Combine
import Foundation

/// Drives which top-level screen `RootView` shows. Deliberately small — a
/// single published phase, no generic routing/deep-link machinery, since
/// Phase 1 only needs SCR-000 → SCR-001 / SCR-004 (design.md 15.1節).
@MainActor
final class AppState: ObservableObject {
    enum Phase: Equatable {
        case launching
        case loggedOut(sessionExpired: Bool)
        case loggedIn
    }

    @Published private(set) var phase: Phase = .launching
    /// 認証済みの今のユーザー(HQ承認 2026-11-02「ホーム画面のキャッシュ表示改善」)。ホームのキャッシュは
    /// このユーザーのものだけを出す。ログインしていない・分からないときはnil(キャッシュを出さない)。
    @Published private(set) var currentUserID: UUID?

    private let authService: AuthServicing
    private let homeCache: HomeCacheStore
    private var observationTask: Task<Void, Never>?

    init(authService: AuthServicing, homeCache: HomeCacheStore = .shared) {
        self.authService = authService
        self.homeCache = homeCache
    }

    /// ログインしていない状態へ移るとき(ログアウト・アカウント削除・セッション切れ・ログイン画面)。
    /// 前のユーザーのホームのキャッシュを残さない。
    private func leaveLoggedIn(sessionExpired: Bool) {
        currentUserID = nil
        homeCache.clear()
        phase = .loggedOut(sessionExpired: sessionExpired)
    }

    /// Called once by `SplashViewModel` when its init sequence (auth
    /// session check, per ui-screens.md SCR-000) has resolved.
    func splashFinished(outcome: SplashOutcome) {
        switch outcome {
        case .authenticated(let session):
            currentUserID = session.userID
            phase = .loggedIn
        case .unauthenticated:
            leaveLoggedIn(sessionExpired: false)
        case .sessionExpired:
            leaveLoggedIn(sessionExpired: true)
        }
        startObservingAuthStateIfNeeded()
    }

    /// Called by `LoginViewModel` after a successful sign-in.
    func handleSuccessfulLogin(_ session: UserSession) {
        currentUserID = session.userID
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
        leaveLoggedIn(sessionExpired: false)
    }

    /// Starts listening for auth state changes that happen *after* launch —
    /// most importantly session expiry while the user is already on Home,
    /// which must route back to SCR-001 (Login) with the "セッションの
    /// 有効期限が切れています" message ("Session Expired" applies for the
    /// whole app session, not only at startup).
    private func startObservingAuthStateIfNeeded() {
        guard observationTask == nil, authService.isConfigured else { return }
        observationTask = Task { [authService] in
            for await event in authService.authStateChanges() {
                switch event {
                case .signedIn(let session):
                    if self.phase != .loggedIn {
                        self.currentUserID = session.userID
                        self.phase = .loggedIn
                    }
                case .signedOut:
                    if case .loggedIn = self.phase {
                        self.leaveLoggedIn(sessionExpired: true)
                    }
                }
            }
        }
    }
}
