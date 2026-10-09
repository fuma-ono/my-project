import Foundation

/// App-level representation of a signed-in user, decoupled from
/// supabase-swift's `Session`/`User` types so the rest of the app never
/// imports the Auth SDK directly (only this module does).
struct UserSession: Equatable {
    let userID: UUID
    let accessToken: String
    let expiresAt: Date

    var isExpired: Bool {
        expiresAt <= Date()
    }
}

/// Emitted by `AuthServicing.authStateChanges()` for the app to react to,
/// most importantly session expiry while the app is already running (not
/// just at Splash launch) — HQ's explicit Phase 1 requirement "Session状態
///監視".
enum AuthEvent: Equatable {
    case signedIn(UserSession)
    case signedOut
}

enum AuthServiceError: Error, Equatable {
    /// No Supabase project is configured yet (expected throughout Phase 1).
    case notConfigured
    case invalidCredentials
    /// Sign up with an email that already has an account (Supabase
    /// `user_already_exists`).
    case emailAlreadyInUse
    /// Sign up with a password Supabase Auth's own policy rejects
    /// (`AuthError.weakPassword`) — the message already explains why.
    case weakPassword(String)
    case network(String)
    case unknown(String)
}

/// `AuthServicing.signUp`'s outcome — Supabase Auth returns a full session
/// only when the project has email confirmation turned off; otherwise it
/// returns just the created user and the session arrives later, once the
/// user taps the confirmation link in their email.
enum SignUpResult: Equatable {
    case signedIn(UserSession)
    case confirmationRequired
}

/// Abstraction over Supabase Auth so the rest of the app depends on this
/// protocol, not on supabase-swift directly. Deliberately small — only what
/// Phase 1's Splash/Login screens and session monitoring need.
protocol AuthServicing {
    var isConfigured: Bool { get }

    /// The current session, or `nil` if signed out. Throws only for
    /// genuine failures (network, config); an absent session is a normal
    /// `nil`, not an error.
    func currentSession() async throws -> UserSession?

    @discardableResult
    func signIn(email: String, password: String) async throws -> UserSession

    /// SCR-002 新規会員登録. See `SignUpResult`'s doc comment for why this
    /// doesn't just return `UserSession` the way `signIn` does.
    @discardableResult
    func signUp(email: String, password: String) async throws -> SignUpResult

    /// SCR-003 パスワード再設定. Sends Supabase's own reset-password email;
    /// completing the reset happens on the link inside it, not in this app.
    func resetPassword(email: String) async throws

    func signOut() async throws

    /// Ongoing auth state changes, primarily used to detect session expiry
    /// while the app is already past Splash (ui-screens.md SCR-000
    /// "Session Expired" flow applies at any point, not only at launch).
    func authStateChanges() -> AsyncStream<AuthEvent>
}
