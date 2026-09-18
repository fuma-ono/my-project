import Combine
import Foundation

enum SettingsSignOutState: Equatable {
    case idle
    case signingOut
    case error(String)
}

/// SCR-009 Settings — Phase 5 §2 minimum: a working ログアウト導線, not a
/// full Settings screen. Guards against double-tap re-entrancy and never
/// leaves the user stuck if `signOut()` fails.
@MainActor
final class SettingsViewModel: ObservableObject {
    @Published private(set) var state: SettingsSignOutState = .idle

    private let authService: AuthServicing
    private let onSignOut: () -> Void

    init(authService: AuthServicing, onSignOut: @escaping () -> Void) {
        self.authService = authService
        self.onSignOut = onSignOut
    }

    func signOut() {
        guard state != .signingOut else { return }
        state = .signingOut
        Task {
            do {
                try await authService.signOut()
                state = .idle
                onSignOut()
            } catch {
                state = .error("ログアウトに失敗しました。もう一度お試しください。")
            }
        }
    }
}
