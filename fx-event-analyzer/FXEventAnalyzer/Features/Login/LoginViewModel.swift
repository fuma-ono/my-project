import Combine
import Foundation
import GoogleSignIn

enum LoginState: Equatable {
    case idle
    case submitting
    case error(String)
}

/// SCR-001 ログイン画面。Per ui-screens.md: "メールアドレス / パスワード / ログイン /
/// パスワードリセット / 新規登録導線。認証方式は別途詳細設計で確定する"。
/// 新規登録(SCR-002)・パスワード再設定(SCR-003)は`LoginView`がこの画面と
/// 同じ`NavigationStack`に本実装(`SignUpView`/`PasswordResetView`)を
/// push する(HQ指示 2026-10-09)。
@MainActor
final class LoginViewModel: ObservableObject {
    @Published var email: String = ""
    @Published var password: String = ""
    @Published private(set) var state: LoginState = .idle

    // Not `private` — `LoginView` reuses both to build `SignUpViewModel`
    // (same auto-sign-in-on-success callback as Login itself) and
    // `PasswordResetViewModel` (same `authService`) for the screens it
    // pushes onto its `NavigationStack`.
    let authService: AuthServicing
    let onSuccess: (UserSession) -> Void

    init(authService: AuthServicing, onSuccess: @escaping (UserSession) -> Void) {
        self.authService = authService
        self.onSuccess = onSuccess
    }

    var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty
            && !password.isEmpty
            && state != .submitting
    }

    func submit() {
        guard canSubmit else { return }
        guard authService.isConfigured else {
            state = .error("認証機能は現在準備中です(Supabaseプロジェクト未接続)。")
            return
        }
        state = .submitting
        Task {
            do {
                let session = try await authService.signIn(email: email, password: password)
                state = .idle
                onSuccess(session)
            } catch let error as AuthServiceError {
                state = .error(Self.message(for: error))
            } catch {
                state = .error("ログインに失敗しました。")
            }
        }
    }

    func signInWithApple() {
        guard state != .submitting else { return }
        guard authService.isConfigured else {
            state = .error("認証機能は現在準備中です(Supabaseプロジェクト未接続)。")
            return
        }
        state = .submitting
        Task {
            do {
                let (idToken, nonce) = try await AppleSignInCoordinator().signIn()
                let session = try await authService.signInWithApple(idToken: idToken, nonce: nonce)
                state = .idle
                onSuccess(session)
            } catch AppleSignInCoordinator.SignInError.cancelled {
                // User dismissed the Face ID / Apple ID sheet — back to the
                // form silently, not an error.
                state = .idle
            } catch let error as AuthServiceError {
                state = .error(Self.message(for: error))
            } catch {
                state = .error("Appleサインインに失敗しました。")
            }
        }
    }

    func signInWithGoogle() {
        guard state != .submitting else { return }
        guard authService.isConfigured else {
            state = .error("認証機能は現在準備中です(Supabaseプロジェクト未接続)。")
            return
        }
        state = .submitting
        Task {
            do {
                let (idToken, accessToken) = try await GoogleSignInCoordinator().signIn()
                let session = try await authService.signInWithGoogle(idToken: idToken, accessToken: accessToken)
                state = .idle
                onSuccess(session)
            } catch GoogleSignInCoordinator.SignInError.notConfigured {
                state = .error("Googleサインインは現在準備中です。")
            } catch GIDSignInError.canceled {
                state = .idle
            } catch let error as AuthServiceError {
                state = .error(Self.message(for: error))
            } catch {
                state = .error("Googleサインインに失敗しました。")
            }
        }
    }

    private static func message(for error: AuthServiceError) -> String {
        switch error {
        case .notConfigured:
            return "認証機能は現在準備中です(Supabaseプロジェクト未接続)。"
        case .invalidCredentials:
            return "メールアドレスまたはパスワードが正しくありません。"
        // `.emailAlreadyInUse`/`.weakPassword` are `signUp`-only outcomes —
        // `signIn` never throws them — so they fall back to the generic
        // message here just like `.network`/`.unknown`.
        case .emailAlreadyInUse, .weakPassword, .network, .unknown:
            return "通信に失敗しました。もう一度お試しください。"
        }
    }
}
