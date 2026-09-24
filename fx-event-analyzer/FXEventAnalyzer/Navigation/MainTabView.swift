import SwiftUI

/// ui-screens.md §4: main navigation frame.
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): HQ's screens
/// (`V5PixelFrontend.swift`) each render their own `V5BottomBar` inline
/// inside their own fixed 234×491 canvas, unlike the pre-integration
/// mockup which relied on a native `TabView` tab bar. Keeping the system
/// `TabView` here would draw two tab bars at once, so portrait mode is a
/// plain switch over a real `tabSelection: Int` (matching `V5BottomBar`'s
/// 0-3 index order) — each screen owns its own `NavigationStack` and
/// bottom bar; `MainTabView` only picks which one is visible. Carried over
/// unchanged from the prior HQ UI Master v5 round. iPad landscape's
/// collapsible left sidebar predates both v5 UI packages (not one of HQ's
/// 12 screens) and is kept as-is, driven by the same `tabSelection` state.
struct MainTabView: View {
    let apiClient: APIClient
    let authService: AuthServicing
    let onSignOut: () -> Void

    @State private var tabSelection = 0
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
    private var portraitLayout: some View {
        switch tabSelection {
        case 0: HomeView(apiClient: apiClient, path: $homePath, tabSelection: $tabSelection)
        case 1: IndicatorsView(apiClient: apiClient, path: $indicatorsPath, tabSelection: $tabSelection)
        case 2: SearchView(apiClient: apiClient, tabSelection: $tabSelection)
        default: SettingsView(apiClient: apiClient, authService: authService, onSignOut: onSignOut, tabSelection: $tabSelection)
        }
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
                    Button { tabSelection = tab.index } label: {
                        HStack {
                            Image(systemName: tab.icon).frame(width: 22)
                            if !collapsed { Text(tab.title) }
                            Spacer()
                        }
                        .padding(.horizontal, 14).frame(height: 48)
                        .foregroundStyle(tabSelection == tab.index ? FXColor.cyan : FXColor.secondaryText)
                        .background(tabSelection == tab.index ? FXColor.cyan.opacity(0.10) : .clear)
                        .clipShape(RoundedRectangle(cornerRadius: 13))
                    }.buttonStyle(.plain)
                }
                Spacer()
            }
            .frame(width: collapsed ? 78 : 230)
            .background(FXColor.backgroundElevated.opacity(0.86))
            .overlay(alignment: .trailing) { Rectangle().fill(FXColor.border).frame(width: 1) }

            portraitLayout.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

enum FXTab: String, CaseIterable, Identifiable {
    case home, indicators, search, settings
    var id: String { rawValue }

    /// Matches `V5BottomBar`'s fixed 0-3 tab order.
    var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }

    var title: String {
        switch self {
        case .home: return "ホーム"
        case .indicators: return "指標一覧"
        case .search: return "検索"
        case .settings: return "設定"
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
