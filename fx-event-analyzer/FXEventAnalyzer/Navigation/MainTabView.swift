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
    @State private var selectedTab: Tab = .home

    /// SCR-001 Home Reference's Bottom Tab Bar: the selected tab shows a
    /// filled icon, every other tab an outline one — SwiftUI's `TabView`
    /// doesn't switch a tab's SF Symbol on selection by itself (verified;
    /// there is no automatic outline↔filled behavior), so the tag/selection
    /// is tracked explicitly here just to pick each icon's name.
    private enum Tab {
        case home, indicators, search, settings
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView(apiClient: apiClient, path: $homePath)
                .tabItem { Label("Home", systemImage: selectedTab == .home ? "house.fill" : "house") }
                .tag(Tab.home)

            IndicatorsView(apiClient: apiClient, path: $indicatorsPath)
                .tabItem { Label("Indicators", systemImage: selectedTab == .indicators ? "chart.bar.fill" : "chart.bar") }
                .tag(Tab.indicators)

            SearchPlaceholderView()
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(Tab.search)

            SettingsView(authService: authService, onSignOut: onSignOut)
                .tabItem { Label("Settings", systemImage: selectedTab == .settings ? "gearshape.fill" : "gearshape") }
                .tag(Tab.settings)
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
