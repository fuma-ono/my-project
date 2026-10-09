@testable import FXEventAnalyzer

final class MockAuthService: AuthServicing {
    var isConfigured: Bool
    var sessionResult: Result<UserSession?, Error> = .success(nil)
    var signInResult: Result<UserSession, Error>?
    var signUpResult: Result<SignUpResult, Error>?
    var resetPasswordError: Error?
    var signOutError: Error?

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

    func authStateChanges() -> AsyncStream<AuthEvent> {
        stream
    }

    func emit(_ event: AuthEvent) {
        continuation.yield(event)
    }
}
