import SwiftUI

/// ui-screens.md §4: main navigation frame.
///
/// HQ Frontend integration (2026-09-21): structure and responsive rule are
/// HQ's `FXEventAnalyzer_HQFrontend/MainTabView.swift` verbatim — iPhone +
/// iPad portrait use the bottom `TabView`; iPad landscape (width > height
/// and width >= 900pt) switches to a collapsible left sidebar with no
/// bottom tab bar. What changed from HQ's mockup is wiring only: HQ's
/// `HomeView()`/`IndicatorsView()`/`SearchView()`/`SettingsView()` took no
/// arguments; the real screens need `apiClient`/`authService`/`onSignOut`
/// and (Home/Indicators) a per-tab `NavigationPath`, so `contentFor(_:)`
/// supplies those — same as the pre-integration `MainTabView` did.
struct MainTabView: View {
    let apiClient: APIClient
    let authService: AuthServicing
    let onSignOut: () -> Void

    @State private var selected: FXTab = .home
    @State private var collapsed = false
    @State private var homePath = NavigationPath()
    @State private var indicatorsPath = NavigationPath()

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height && geo.size.width >= 900
            Group {
                if landscape { landscapeLayout } else { portraitLayout }
            }
        }.preferredColorScheme(.dark)
    }

    @ViewBuilder
    private func contentFor(_ tab: FXTab) -> some View {
        switch tab {
        case .home: HomeView(apiClient: apiClient, path: $homePath)
        case .indicators: IndicatorsView(apiClient: apiClient, path: $indicatorsPath)
        case .search: SearchView(apiClient: apiClient)
        case .settings: SettingsView(apiClient: apiClient, authService: authService, onSignOut: onSignOut)
        }
    }

    private var portraitLayout: some View {
        TabView(selection: $selected) {
            ForEach(FXTab.allCases) { tab in
                contentFor(tab)
                    .tabItem { Label(tab.title, systemImage: tab.icon) }
                    .tag(tab)
            }
        }.tint(FXColor.cyan)
    }

    private var landscapeLayout: some View {
        HStack(spacing: 0) {
            VStack(spacing: 18) {
                HStack {
                    if !collapsed { FXBrandMark(compact: true) }
                    Spacer()
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { collapsed.toggle() }
                    } label: {
                        Image(systemName: "sidebar.left").foregroundStyle(FXColor.secondaryText)
                    }
                }.padding(.horizontal, 14).padding(.top, 12)
                ForEach(FXTab.allCases) { tab in
                    Button { selected = tab } label: {
                        HStack {
                            Image(systemName: tab.icon).frame(width: 22)
                            if !collapsed { Text(tab.title) }
                            Spacer()
                        }
                        .padding(.horizontal, 14).frame(height: 48)
                        .foregroundStyle(selected == tab ? FXColor.cyan : FXColor.secondaryText)
                        .background(selected == tab ? FXColor.cyan.opacity(0.10) : .clear)
                        .clipShape(RoundedRectangle(cornerRadius: 13))
                    }.buttonStyle(.plain)
                }
                Spacer()
            }
            .frame(width: collapsed ? 78 : 230)
            .background(FXColor.backgroundElevated.opacity(0.86))
            .overlay(alignment: .trailing) { Rectangle().fill(FXColor.border).frame(width: 1) }

            contentFor(selected).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

enum FXTab: String, CaseIterable, Identifiable {
    case home, indicators, search, settings
    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .indicators: return "Indicators"
        case .search: return "Search"
        case .settings: return "Settings"
        }
    }

    var icon: String {
        switch self {
        case .home: return "house.fill"
        case .indicators: return "chart.bar.xaxis"
        case .search: return "magnifyingglass"
        case .settings: return "gearshape.fill"
        }
    }
}
