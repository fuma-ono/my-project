import Combine
import Foundation

enum SignUpState: Equatable {
    case idle
    case submitting
    case error(String)
    /// Supabase Auth's project has email confirmation turned on: the
    /// account was created, but there's no session yet — the user has to
    /// tap the link in the confirmation email before they can sign in.
    case confirmationRequired
}

/// SCR-002 新規会員登録(HQ指示 2026-10-09)。`LoginView`から同じ
/// `NavigationStack`にpushされ、成功時は`LoginViewModel`と同じ
/// `onSuccess`コールバックでそのままサインインさせる — ただしSupabase
/// 側でメール確認が有効な場合は`signUp`がセッションを返さないため、その
/// 場合は`.confirmationRequired`で案内だけ出し、ログインは行わない。
@MainActor
final class SignUpViewModel: ObservableObject {
    @Published var email: String = ""
    @Published var password: String = ""
    @Published var confirmPassword: String = ""
    @Published private(set) var state: SignUpState = .idle

    private let authService: AuthServicing
    private let onSuccess: (UserSession) -> Void

    init(authService: AuthServicing, onSuccess: @escaping (UserSession) -> Void) {
        self.authService = authService
        self.onSuccess = onSuccess
    }

    /// Both non-empty and only used once typing has actually started on the
    /// confirm field — avoids flashing "一致しません" while the user is
    /// still typing the first one.
    var passwordsMismatch: Bool {
        !confirmPassword.isEmpty && password != confirmPassword
    }

    var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty
            && !password.isEmpty
            && password == confirmPassword
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
                switch try await authService.signUp(email: email, password: password) {
                case .signedIn(let session):
                    state = .idle
                    onSuccess(session)
                case .confirmationRequired:
                    state = .confirmationRequired
                }
            } catch let error as AuthServiceError {
                state = .error(Self.message(for: error))
            } catch {
                state = .error("登録に失敗しました。もう一度お試しください。")
            }
        }
    }

    private static func message(for error: AuthServiceError) -> String {
        switch error {
        case .notConfigured:
            return "認証機能は現在準備中です(Supabaseプロジェクト未接続)。"
        case .emailAlreadyInUse:
            return "このメールアドレスは既に登録されています。"
        case .weakPassword(let reason):
            return reason
        case .invalidCredentials, .network, .unknown:
            return "登録に失敗しました。もう一度お試しください。"
        }
    }
}
