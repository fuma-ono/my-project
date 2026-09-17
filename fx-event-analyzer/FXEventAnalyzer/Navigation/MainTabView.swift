import SwiftUI

/// ui-screens.md §4: 4-tab main navigation (Home / Indicators / Search /
/// Settings) — "Analysisタブは作らない。分析機能はイベントを起点とした
/// 画面遷移の中に配置する". Each tab owns its own `NavigationPath` so
/// switching tabs preserves each stack's position independently.
struct MainTabView: View {
    let apiClient: APIClient
    let authService: AuthServicing
    let onSignOut: () -> Void

    @State private var homePath = NavigationPath()
    @State private var indicatorsPath = NavigationPath()

    var body: some View {
        TabView {
            HomeView(apiClient: apiClient, path: $homePath)
                .tabItem { Label("Home", systemImage: "house.fill") }

            IndicatorsView(apiClient: apiClient, path: $indicatorsPath)
                .tabItem { Label("Indicators", systemImage: "chart.bar.fill") }

            SearchPlaceholderView()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }

            SettingsView(authService: authService, onSignOut: onSignOut)
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .tint(DesignTokens.Colors.accentPrimary)
    }
}

/// SCR-008 Search — out of Phase 3's screen priority list (HQ Phase 3
/// instruction §優先順位 covers only SCR-001〜004/007). The tab exists now
/// because ui-screens.md §4 fixes the 4-tab structure as the app's main
/// navigation frame; its content is a later phase.
private struct SearchPlaceholderView: View {
    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
                EmptyStateView(
                    title: "Searchは準備中です",
                    message: "指標・イベント・通貨ペアの検索は今後追加予定です。",
                    systemImage: "magnifyingglass"
                )
            }
            .navigationTitle("Search")
            .toolbarBackground(DesignTokens.Colors.backgroundPrimary, for: .navigationBar)
        }
    }
}
