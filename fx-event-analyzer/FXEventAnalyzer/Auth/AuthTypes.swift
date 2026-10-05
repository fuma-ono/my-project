import Foundation

/// App-level representation of a signed-in user, decoupled from
/// supabase-swift's `Session`/`User` types so the rest of the app never
/// imports the Auth SDK directly (only this module does).
struct UserSession: Equatable {
    let userID: UUID
    let accessToken: String
    let expiresAt: Date
    /// Supabase Auth's email for the user (SCR-015 shows it). Not part of
    /// `GET /account` — email/password are owned by Supabase Auth
    /// (api-design.md §24.2), so it comes from the session itself.
    var email: String? = nil

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
    case network(String)
    case unknown(String)
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

    func signOut() async throws

    /// Requests an email change (SCR-015). Supabase Auth sends a
    /// confirmation link to the new address; the change takes effect only
    /// once that link is opened, so the session's email is unchanged here.
    func updateEmail(_ newEmail: String) async throws

    /// Changes the password after re-checking the current one (SCR-015),
    /// so an unattended unlocked device can't be used to take the account
    /// over. Throws `.invalidCredentials` when `currentPassword` is wrong.
    func updatePassword(currentPassword: String, newPassword: String) async throws

    /// Ongoing auth state changes, primarily used to detect session expiry
    /// while the app is already past Splash (ui-screens.md SCR-000
    /// "Session Expired" flow applies at any point, not only at launch).
    func authStateChanges() -> AsyncStream<AuthEvent>
}
