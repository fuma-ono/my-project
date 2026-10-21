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
    /// カレンダータブを常駐化する(`portraitLayout`参照)にあたり、起動直後
    /// (ホームタブが初期選択)からカレンダーも即座に生成して`/calendar`を
    /// 先読みしてしまうと、使われるとは限らない通信を毎回の起動に追加する
    /// ことになる。初めてカレンダータブが選ばれた時点で初めて生成し、以後は
    /// 常駐させる(2回目以降の切り替えで再生成・再取得しない)。
    @State private var hasVisitedCalendarTab = false

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height && geo.size.width >= 900
            Group {
                if landscape { landscapeLayout } else { portraitLayout }
            }
        }
        .preferredColorScheme(.dark)
        // HQ指示(2026-10-20)「起動診断画面」: Splash完了後にメイン画面が
        // 画面上に現れた「表示イベント」の時刻。`.onAppear`は描画が完全に
        // 終わったことの保証ではなく、あくまでイベント発生の記録(診断
        // 画面側の説明文でも明記する)。初回だけ記録する(内部でガード済み)。
        .onAppear { DiagnosticsStore.shared.recordMainScreenAppeared() }
        .onChange(of: tabSelection) { _, newValue in
            if newValue == 2 { hasVisitedCalendarTab = true }
        }
    }

    /// HQ緊急指示(2026-10-21)「起動・画面表示の高速化」: 以前は`switch`で
    /// タブごとにViewを都度生成しており、タブを離れて戻るたびに`HomeView`/
    /// `CalendarTabView`(と中の`@StateObject`)が作り直され、`.task`が
    /// 再実行されて`/home`・`/calendar`を毎回フルに再取得していた
    /// (起動診断の`homeRequestCount`が複数回に増えていた既知の挙動の
    /// 発生源そのもの)。`CalendarViewModel.load()`は元々
    /// `itemsByDay.isEmpty`のときだけ`.loading`にする作り(stale-while-
    /// revalidate相当)だったが、Viewごと破棄されるため活きていなかった。
    ///
    /// ホーム・カレンダーの2タブだけ、`ZStack`+`opacity`で常駐させる形に
    /// 変更し、タブ復帰時に再生成・再取得が起きないようにした
    /// (`.task`はViewが最初に生成された1回だけ走る)。指標・検索・設定の
    /// 3タブは、この問題が報告されていないため、従来通り`switch`での
    /// 都度生成のまま変更していない(影響範囲を最小限にするため)。
    /// `HomeView`/`CalendarTabView`のどちらにも`.onDisappear`に依存する
    /// 処理が無いことを確認済み(常駐化しても副作用が無い)。
    @ViewBuilder
    private var portraitLayout: some View {
        ZStack {
            // `authService`はHQ決定(2026-10-21「起動の遅れの改善A1」)対応:
            // ログイン中の利用者IDを`HomeViewModel`が解決するために渡す
            // (`HomeView.init`のドキュメントコメント参照)。
            HomeView(apiClient: apiClient, path: $homePath, tabSelection: $tabSelection, authService: authService)
                .opacity(tabSelection == 0 ? 1 : 0)
                .allowsHitTesting(tabSelection == 0)
                .accessibilityHidden(tabSelection != 0)
            if hasVisitedCalendarTab || tabSelection == 2 {
                CalendarTabView(apiClient: apiClient, tabSelection: $tabSelection)
                    .opacity(tabSelection == 2 ? 1 : 0)
                    .allowsHitTesting(tabSelection == 2)
                    .accessibilityHidden(tabSelection != 2)
            }
            if tabSelection != 0 && tabSelection != 2 {
                switch tabSelection {
                case 1: IndicatorsView(apiClient: apiClient, path: $indicatorsPath, tabSelection: $tabSelection)
                case 3: SearchView(apiClient: apiClient, tabSelection: $tabSelection)
                default: SettingsView(apiClient: apiClient, authService: authService, onSignOut: onSignOut, tabSelection: $tabSelection)
                }
            }
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
    /// HQ指示(2026-10-03、画面構成全面更新)「旧『分析』タブは廃止。最新版の
    /// 5タブはホーム/指標/カレンダー/検索/設定」。旧`.analysis`
    /// (旧SCR-011 チャート分析)を`.calendar`(SCR-010 経済カレンダー)に
    /// 置き換えた。宣言順が`index`(≒`tabSelection`/`V5BottomBar`の並び)を
    /// 決めるため、ここでの並びをHQ指定の「ホーム/指標/カレンダー/検索/
    /// 設定」と一致させること。
    case home, indicators, calendar, search, settings
    var id: String { rawValue }

    /// Matches `V5BottomBar`'s fixed 0-4 tab order.
    var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }

    var title: String {
        switch self {
        case .home: return "ホーム"
        case .indicators: return "指標"
        case .calendar: return "カレンダー"
        case .search: return "検索"
        case .settings: return "設定"
        }
    }

    var icon: String {
        switch self {
        case .home: return "house.fill"
        case .indicators: return "chart.bar.xaxis"
        case .calendar: return "calendar"
        case .search: return "magnifyingglass"
        case .settings: return "gearshape.fill"
        }
    }
}
