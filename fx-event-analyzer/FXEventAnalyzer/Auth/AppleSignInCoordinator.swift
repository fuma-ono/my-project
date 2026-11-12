import AuthenticationServices
import CryptoKit
import Foundation

/// Bridges `ASAuthorizationController`'s delegate-based API to async/await
/// for `LoginViewModel`/`SignUpViewModel`'s Apple button, and generates +
/// SHA256-hashes the nonce Apple's native Sign In with Apple replay-
/// protection flow expects (`ASAuthorizationAppleIDRequest.nonce` gets the
/// hash; the raw value is returned so the caller can pass it on to
/// `AuthServicing.signInWithApple`, which forwards it to Supabase for
/// verification against the ID token's own `nonce` claim).
@MainActor
final class AppleSignInCoordinator: NSObject {
    enum SignInError: Error, Equatable {
        case cancelled
        case missingIdentityToken
    }

    private var continuation: CheckedContinuation<(idToken: String, nonce: String), Error>?
    private var currentNonce: String?

    func signIn() async throws -> (idToken: String, nonce: String) {
        let nonce = Self.randomNonceString()
        currentNonce = nonce

        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.email]
        request.nonce = Self.sha256(nonce)

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            controller.performRequests()
        }
    }

    /// Apple's own sample-code pattern: a cryptographically random string
    /// drawn from `SecRandomCopyBytes`, rejecting bytes outside the
    /// charset rather than modulo-biasing them.
    private static func randomNonceString(length: Int = 32) -> String {
        let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remainingLength = length
        while remainingLength > 0 {
            var randomBytes = [UInt8](repeating: 0, count: 16)
            let status = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
            precondition(status == errSecSuccess, "Unable to generate nonce.")
            for random in randomBytes where remainingLength > 0 {
                if random < charset.count {
                    result.append(charset[Int(random)])
                    remainingLength -= 1
                }
            }
        }
        return result
    }

    private static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8))
            .compactMap { String(format: "%02x", $0) }
            .joined()
    }
}

extension AppleSignInCoordinator: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        defer { continuation = nil }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8),
              let nonce = currentNonce else {
            continuation?.resume(throwing: SignInError.missingIdentityToken)
            return
        }
        continuation?.resume(returning: (idToken: idToken, nonce: nonce))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        defer { continuation = nil }
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            continuation?.resume(throwing: SignInError.cancelled)
        } else {
            continuation?.resume(throwing: error)
        }
    }
}

extension AppleSignInCoordinator: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        PresentationAnchor.keyWindow() ?? ASPresentationAnchor()
    }
}
