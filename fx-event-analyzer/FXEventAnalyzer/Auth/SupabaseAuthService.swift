import Auth
import Foundation

/// `AuthServicing` backed by supabase-swift's `Auth` module. This is the
/// only file in the app allowed to `import Auth` — everything else talks to
/// `AuthServicing`/`UserSession`/`AuthEvent`.
///
/// When `config` is `nil` (no Supabase project provisioned yet — expected
/// for all of Phase 1), every method fails fast with
/// `AuthServiceError.notConfigured` instead of touching the SDK, so the app
/// never crashes on missing configuration.
final class SupabaseAuthService: AuthServicing {
    private let client: AuthClient?

    let isConfigured: Bool

    init(config: SupabaseConfig?) {
        self.isConfigured = config != nil
        if let config {
            self.client = AuthClient(
                configuration: .init(
                    url: config.authURL,
                    headers: ["apikey": config.anonKey],
                    localStorage: KeychainLocalStorage()
                )
            )
        } else {
            self.client = nil
        }
    }

    func currentSession() async throws -> UserSession? {
        guard let client else { throw AuthServiceError.notConfigured }
        do {
            let session = try await client.session
            return Self.mapSession(session)
        } catch {
            // supabase-swift throws when there is no session at all; treat
            // that as "signed out", not a failure. Anything else surfaces
            // as a real error.
            if Self.isMissingSessionError(error) {
                return nil
            }
            throw AuthServiceError.network(error.localizedDescription)
        }
    }

    @discardableResult
    func signIn(email: String, password: String) async throws -> UserSession {
        guard let client else { throw AuthServiceError.notConfigured }
        do {
            let session = try await client.signIn(email: email, password: password)
            return Self.mapSession(session)
        } catch {
            throw AuthServiceError.invalidCredentials
        }
    }

    func signOut() async throws {
        guard let client else { throw AuthServiceError.notConfigured }
        do {
            try await client.signOut()
        } catch {
            throw AuthServiceError.network(error.localizedDescription)
        }
    }

    func authStateChanges() -> AsyncStream<AuthEvent> {
        guard let client else {
            return AsyncStream { $0.finish() }
        }
        return AsyncStream { continuation in
            let task = Task {
                for await (_, session) in client.authStateChanges {
                    if let session {
                        continuation.yield(.signedIn(Self.mapSession(session)))
                    } else {
                        continuation.yield(.signedOut)
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func mapSession(_ session: Session) -> UserSession {
        UserSession(
            userID: session.user.id,
            accessToken: session.accessToken,
            expiresAt: Date(timeIntervalSince1970: session.expiresAt)
        )
    }

    private static func isMissingSessionError(_ error: Error) -> Bool {
        // supabase-swift's "no session" error doesn't have a stable public
        // case we can switch on across versions; matching on the
        // description is intentionally conservative (false negatives just
        // surface as a network error, which is still safe — never a crash).
        error.localizedDescription.lowercased().contains("session")
            && error.localizedDescription.lowercased().contains("missing")
    }
}
