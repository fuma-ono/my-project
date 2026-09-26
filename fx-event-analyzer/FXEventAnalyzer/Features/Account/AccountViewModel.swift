import Combine
import Foundation

enum AccountState: Equatable {
    case loading
    case backendNotConfigured
    case loaded(account: AccountResponse, subscription: SubscriptionResponse)
    case error(String)
}

enum AccountSignOutState: Equatable {
    case idle
    case signingOut
    case error(String)
}

/// SCR-011 Account — HQ Frontend integration (2026-09-21): the delivered UI
/// package includes an Account screen with no ViewModel of its own (its
/// `AccountView.swift` was static demo data). Wires it to `AccountService`/
/// `SubscriptionService` (Networking/, Phase 2 — implemented but unused by
/// any screen until now) the same way every other screen's ViewModel talks
/// to its own endpoint, via the same `apiClient` `RootView` already
/// constructs.
///
/// HQ UI Master v5 integration (2026-09-22): `Assets/Reference/SCR-011.png`
/// shows its own "ログアウト" row (in addition to Settings' existing one).
/// Rather than duplicating sign-out logic, this ViewModel reuses the same
/// real `AuthServicing.signOut()`/`onSignOut` callback `SettingsViewModel`
/// already drives — a second consumer of an existing capability, not a new
/// one.
@MainActor
final class AccountViewModel: ObservableObject {
    @Published private(set) var state: AccountState = .loading
    @Published private(set) var signOutState: AccountSignOutState = .idle

    private let accountService: AccountService
    private let subscriptionService: SubscriptionService
    /// Optional so `AppRouteDestinationView`'s unreachable-in-practice
    /// `.account` case (real navigation always goes through Settings' own
    /// override, which supplies both) can still construct this ViewModel
    /// without inventing an `AuthServicing` it doesn't have.
    private let authService: AuthServicing?
    private let onSignOut: () -> Void

    init(apiClient: APIClient, authService: AuthServicing? = nil, onSignOut: @escaping () -> Void = {}) {
        self.accountService = AccountService(apiClient: apiClient)
        self.subscriptionService = SubscriptionService(apiClient: apiClient)
        self.authService = authService
        self.onSignOut = onSignOut
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    func signOut() {
        guard let authService else { return }
        guard signOutState != .signingOut else { return }
        signOutState = .signingOut
        Task {
            do {
                try await authService.signOut()
                signOutState = .idle
                onSignOut()
            } catch {
                signOutState = .error("ログアウトに失敗しました。もう一度お試しください。")
            }
        }
    }

    private func fetch() async {
        do {
            async let account: AccountResponse = accountService.fetchAccount()
            async let subscription: SubscriptionResponse = subscriptionService.fetchSubscription()
            let (accountResponse, subscriptionResponse) = try await (account, subscription)
            state = .loaded(account: accountResponse, subscription: subscriptionResponse)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch {
            state = .error("アカウント情報の取得に失敗しました。")
        }
    }
}
