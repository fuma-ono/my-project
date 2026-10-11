import SwiftUI

/// Top-level screen switch: SCR-000 → SCR-001 / SCR-004
/// (design.md 15.1節 起動フロー).
struct RootView: View {
    @StateObject private var appState: AppState
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var preferences = AppPreferences.shared
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
                    appState.handleSignOut()
                }
                .task(id: scenePhase) {
                    // HQ指示(Calendar/Settings/Accountのみ移植): 元の実装は
                    // ここで通知の予約し直し(LocalNotificationScheduler)・
                    // バックグラウンド更新(NotificationBackgroundRefresh)・
                    // 購読の同期(SubscriptionSync)・未読バッジのポーリング
                    // (NotificationsStore)も行っていたが、それらの基盤自体は
                    // 今回のポート対象外のため呼ばない。表示・地域設定
                    // (SCR-018/019)とプラン上限(カレンダーの無料枠など)の
                    // 読み込みだけ行う。
                    guard scenePhase == .active else { return }
                    await AppPreferences.shared.load(apiClient: apiClient)
                    await PlanStore.shared.load(apiClient: apiClient)
                }
            }
        }
        // SCR-018の文字サイズ(iOS標準の部品に効く)。
        .dynamicTypeSize(preferences.dynamicTypeSize)
        .preferredColorScheme(.dark) // MVP baseline theme (ui-screens.md 5.0節); see DesignTokens.swift
    }
}
