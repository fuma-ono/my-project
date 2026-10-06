import SwiftUI

/// Top-level screen switch: SCR-000 → SCR-001 / SCR-004
/// (design.md 15.1節 起動フロー).
struct RootView: View {
    @StateObject private var appState: AppState
    @Environment(\.scenePhase) private var scenePhase
    private let authService: AuthServicing
    private let apiClient: APIClient

    init(authService: AuthServicing, apiClient: APIClient) {
        self.authService = authService
        self.apiClient = apiClient
        _appState = StateObject(wrappedValue: AppState(authService: authService))
    }

    var body: some View {
        Group {
            switch appState.phase {
            case .launching:
                SplashView(
                    viewModel: SplashViewModel(authService: authService) { outcome in
                        appState.splashFinished(outcome: outcome)
                    }
                )
            case .loggedOut(let sessionExpired):
                LoginView(
                    viewModel: LoginViewModel(authService: authService) { session in
                        appState.handleSuccessfulLogin(session)
                    },
                    sessionExpired: sessionExpired
                )
            case .loggedIn:
                MainTabView(apiClient: apiClient, authService: authService) {
                    // ログアウト・アカウント削除: 前のユーザーの通知を残さない。
                    LocalNotificationScheduler(apiClient: apiClient).reset()
                    appState.handleSignOut()
                }
                .task(id: scenePhase) {
                    // 起動時・フォアグラウンド復帰時にローカル通知を予約し直し、
                    // 表示中は通知時刻を過ぎた分をベルの赤バッジに反映する。
                    if scenePhase == .background {
                        NotificationBackgroundRefresh.schedule()
                    }
                    guard scenePhase == .active else { return }
                    // SCR-017: 自動更新・解約などの購読の変化をBackendへ送る。
                    SubscriptionSync.shared.start(apiClient: apiClient)
                    await LocalNotificationScheduler(apiClient: apiClient).refresh()
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(30))
                        NotificationsStore.shared.refreshUnread()
                    }
                }
            }
        }
        .preferredColorScheme(.dark) // MVP baseline theme (ui-screens.md 5.0節); see DesignTokens.swift
    }
}
