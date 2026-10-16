import Combine
import Foundation

enum PasswordResetState: Equatable {
    case idle
    case submitting
    case error(String)
    /// Supabase's reset email was sent; actually changing the password
    /// happens on the link inside it, outside this app.
    case sent
}

/// SCR-003 パスワード再設定(HQ指示 2026-10-09)。`LoginView`から同じ
/// `NavigationStack`にpushされる。メールアドレスだけを受け取り、Supabase
/// Authの標準のリセットメール送信APIを呼ぶ — 新しいパスワードの入力は
/// メール内のリンク先(Supabase側のページ)で行うため、この画面にその
/// 入力欄は無い。
@MainActor
final class PasswordResetViewModel: ObservableObject {
    @Published var email: String = ""
    @Published private(set) var state: PasswordResetState = .idle

    private let authService: AuthServicing

    init(authService: AuthServicing) {
        self.authService = authService
    }

    var canSubmit: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && state != .submitting
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
                try await authService.resetPassword(email: email)
                state = .sent
            } catch let error as AuthServiceError {
                state = .error(Self.message(for: error))
            } catch {
                state = .error("送信に失敗しました。もう一度お試しください。")
            }
        }
    }

    private static func message(for error: AuthServiceError) -> String {
        switch error {
        case .notConfigured:
            return "認証機能は現在準備中です(Supabaseプロジェクト未接続)。"
        case .invalidCredentials, .emailAlreadyInUse, .weakPassword, .network, .unknown:
            return "送信に失敗しました。もう一度お試しください。"
        }
    }
}
