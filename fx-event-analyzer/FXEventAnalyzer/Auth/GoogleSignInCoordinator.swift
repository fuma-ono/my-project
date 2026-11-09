import GoogleSignIn
import UIKit

/// Wraps the `GoogleSignIn-iOS` SDK for `LoginViewModel`/`SignUpViewModel`'s
/// Google button. `GIDSignIn` auto-configures its client ID from the
/// `GIDClientID` Info.plist key at first access (no explicit `configure()`
/// call needed — see `project.yml`'s `GOOGLE_SIGNIN_CLIENT_ID` build
/// setting), so `signIn()` fails fast with `.notConfigured` instead of
/// letting the SDK raise an `NSInvalidArgumentException` when that key is
/// blank (unset Secrets, same blank-by-default policy as `SUPABASE_URL`).
@MainActor
struct GoogleSignInCoordinator {
    enum SignInError: Error, Equatable {
        case notConfigured
        case noPresentingWindow
        case missingIdentityToken
    }

    /// Returns both the ID token and the access token — Supabase's own
    /// native-iOS sample (supabase.com/docs/guides/auth/social-login/
    /// auth-google, Swift section, verified live 2026-10-20) passes both
    /// to `signInWithIdToken`, since Google's ID token carries an
    /// `at_hash` claim that `OpenIDConnectCredentials.accessToken` exists
    /// specifically to let the server verify.
    func signIn() async throws -> (idToken: String, accessToken: String) {
        guard let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
              !clientID.isEmpty else {
            throw SignInError.notConfigured
        }
        guard let presenting = PresentationAnchor.keyWindow()?.rootViewController else {
            throw SignInError.noPresentingWindow
        }
        // `signIn(withPresenting:)` is Swift's automatic async wrapper over
        // the SDK's Objective-C `signInWithPresentingViewController:completion:`
        // (no Swift-native async overload is declared in GIDSignIn.h itself).
        let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenting)
        guard let idToken = result.user.idToken?.tokenString else {
            throw SignInError.missingIdentityToken
        }
        return (idToken: idToken, accessToken: result.user.accessToken.tokenString)
    }
}
