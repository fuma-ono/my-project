import Combine
import Foundation

enum AccountState: Equatable {
    case loading
    case backendNotConfigured
    case loaded(account: AccountResponse, subscription: SubscriptionResponse)
    case error(String)
}

/// SCR-011 Account — HQ Frontend integration (2026-09-21): the delivered UI
/// package includes an Account screen with no ViewModel of its own (its
/// `AccountView.swift` was static demo data). Wires it to `AccountService`/
/// `SubscriptionService` (Networking/, Phase 2 — implemented but unused by
/// any screen until now) the same way every other screen's ViewModel talks
/// to its own endpoint, via the same `apiClient` `RootView` already
/// constructs.
@MainActor
final class AccountViewModel: ObservableObject {
    @Published private(set) var state: AccountState = .loading

    private let accountService: AccountService
    private let subscriptionService: SubscriptionService

    init(apiClient: APIClient) {
        self.accountService = AccountService(apiClient: apiClient)
        self.subscriptionService = SubscriptionService(apiClient: apiClient)
    }

    func load() {
        state = .loading
        Task { await fetch() }
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
