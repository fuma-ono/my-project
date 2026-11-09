@testable import FXEventAnalyzer

final class MockAuthService: AuthServicing {
    var isConfigured: Bool
    var sessionResult: Result<UserSession?, Error> = .success(nil)
    var signInResult: Result<UserSession, Error>?
    var signUpResult: Result<SignUpResult, Error>?
    var signInWithAppleResult: Result<UserSession, Error>?
    var signInWithGoogleResult: Result<UserSession, Error>?
    var resetPasswordError: Error?
    var signOutError: Error?
    var updateEmailError: Error?
    var updatePasswordError: Error?
    private(set) var updatedEmail: String?
    private(set) var updatedPassword: (current: String, new: String)?

    private let stream: AsyncStream<AuthEvent>
    private let continuation: AsyncStream<AuthEvent>.Continuation

    init(isConfigured: Bool = true) {
        self.isConfigured = isConfigured
        let (stream, continuation) = AsyncStream<AuthEvent>.makeStream()
        self.stream = stream
        self.continuation = continuation
    }

    func currentSession() async throws -> UserSession? {
        switch sessionResult {
        case .success(let value):
            return value
        case .failure(let error):
            throw error
        }
    }

    func signIn(email: String, password: String) async throws -> UserSession {
        guard let signInResult else {
            throw AuthServiceError.unknown("MockAuthService.signInResult not configured")
        }
        switch signInResult {
        case .success(let session):
            return session
        case .failure(let error):
            throw error
        }
    }

    func signUp(email: String, password: String) async throws -> SignUpResult {
        guard let signUpResult else {
            throw AuthServiceError.unknown("MockAuthService.signUpResult not configured")
        }
        switch signUpResult {
        case .success(let result):
            return result
        case .failure(let error):
            throw error
        }
    }

    func signInWithApple(idToken: String, nonce: String) async throws -> UserSession {
        guard let signInWithAppleResult else {
            throw AuthServiceError.unknown("MockAuthService.signInWithAppleResult not configured")
        }
        switch signInWithAppleResult {
        case .success(let session):
            return session
        case .failure(let error):
            throw error
        }
    }

    func signInWithGoogle(idToken: String, accessToken: String) async throws -> UserSession {
        guard let signInWithGoogleResult else {
            throw AuthServiceError.unknown("MockAuthService.signInWithGoogleResult not configured")
        }
        switch signInWithGoogleResult {
        case .success(let session):
            return session
        case .failure(let error):
            throw error
        }
    }

    func resetPassword(email: String) async throws {
        if let resetPasswordError {
            throw resetPasswordError
        }
    }

    func signOut() async throws {
        if let signOutError {
            throw signOutError
        }
    }

    func updateEmail(_ newEmail: String) async throws {
        if let updateEmailError { throw updateEmailError }
        updatedEmail = newEmail
    }

    func updatePassword(currentPassword: String, newPassword: String) async throws {
        if let updatePasswordError { throw updatePasswordError }
        updatedPassword = (currentPassword, newPassword)
    }

    func authStateChanges() -> AsyncStream<AuthEvent> {
        stream
    }

    func emit(_ event: AuthEvent) {
        continuation.yield(event)
    }
}
