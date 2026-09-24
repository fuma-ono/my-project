import SwiftUI

/// SCR-001 Home (ui-screens.md §5). Real `GET /home` data — SCHEDULED /
/// RELEASED events, each tappable to SCR-004 Event Detail.
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5Home` (fixed 234×491 coordinate space via
/// `V5Viewport`, absolute-positioned cards), reproduced as given.
/// Adaptations, all wiring, not redesign:
/// - HQ's `V5Home` has no `ScrollView` at all — the whole screen is one
///   fixed, non-scrolling composition, unlike the prior HQV5 integration.
///   Because every element here is placed with `.position()` (not normal
///   flow layout), hiding an absent element never shifts anything else —
///   so "no real data → hidden, never fabricated" is layout-safe by
///   construction, not a coordinate change.
/// - The hero "Upcoming Events" card is real `HomeViewModel.upcomingEvents`
///   `.first`, shown only `if let` (a real day can have none; HQ's demo
///   always shows one).
/// - HQ's 4 hardcoded "Recent Events" rows and 3 hardcoded "主要FX" boxes
///   are real `ForEach`s bound to the real lists, `.prefix`-ed to the same
///   4/3 slot counts HQ's fixed coordinates provision for (174+idx*53 for
///   4 rows; 3 side-by-side boxes) — extra real items beyond that are not
///   shown (Home is a preview; the full lists live on the Indicators tab
///   and are not cut off there), fewer real items just leave the
///   remaining fixed slots empty, never inventing rows to fill them.
/// - `HQV5DemoRouter.push(...)` → real `AppRoute.eventDetail`
///   `NavigationLink`s.
/// - `tabSelection`: a real `Binding<Int>` threaded from `MainTabView`, so
///   `V5BottomBar` switches tabs for real.
struct HomeView: View {
    @StateObject private var viewModel: HomeViewModel
    @Binding var path: NavigationPath
    @Binding var tabSelection: Int
    private let apiClient: APIClient

    init(apiClient: APIClient, path: Binding<NavigationPath>, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: HomeViewModel(apiClient: apiClient))
        _path = path
        _tabSelection = tabSelection
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: AppRoute.self) { route in
                    AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
                }
        }
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "経済指標データはまだ利用できません。実装が完了次第、ここに表示されます。") }
        case .loaded(let events, let majorFx) where events.isEmpty && majorFx.isEmpty:
            loadingScaffold { FXEmptyState(icon: "calendar", title: "本日のイベントはありません", message: "本日発表予定の経済指標はありません。") }
        case .loaded:
            loadedScreen
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: () -> some View) -> some View {
        ZStack {
            LinearGradient(colors: [V5P.bg0, V5P.bg1, V5P.bg0], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            content()
        }
    }

    private var loadedScreen: some View {
        V5Viewport {
            V5TopStatus()
            HStack {
                Image(systemName: "chart.line.uptrend.xyaxis").foregroundStyle(V5P.cyan)
                Text("FX Event Analyzer").font(.system(size: 12, weight: .bold))
                Spacer()
                Image(systemName: "bell").font(.system(size: 12))
            }
            .foregroundStyle(.white)
            .frame(width: 204)
            .position(x: 117, y: 40)

            if let hero = mappedEvents.upcoming.first {
                NavigationLink(value: AppRoute.eventDetail(id: hero.id)) {
                    V5Card(CGRect(x: 10, y: 58, width: 214, height: 94)) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Upcoming Events").font(.system(size: 11, weight: .bold))
                            Text("Today  \(ValueFormat.time(hero.releaseDatetime))").font(.system(size: 7)).foregroundStyle(V5P.muted)
                            V5EventRow(home: hero)
                        }
                    }
                }.buttonStyle(.plain)
            }

            Text("Recent Events").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                .position(x: 49, y: 162)
            ForEach(Array(mappedEvents.rest.prefix(4).enumerated()), id: \.element.id) { idx, event in
                NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                    V5Card(CGRect(x: 10, y: 174 + CGFloat(idx) * 53, width: 214, height: 48)) {
                        V5EventRow(home: event)
                    }
                }.buttonStyle(.plain)
            }

            if !mappedPairs.isEmpty {
                Text("主要FX").font(.system(size: 11, weight: .bold)).foregroundStyle(.white).position(x: 35, y: 395)
                HStack(spacing: 5) {
                    ForEach(mappedPairs.prefix(3)) { pair in fxBox(pair) }
                }.frame(width: 214).position(x: 117, y: 421)
            }

            V5BottomBar(selected: $tabSelection)
        }
    }

    @ViewBuilder private func fxBox(_ pair: FXPairUI) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text(pair.symbol).font(.system(size: 7, weight: .bold)); Spacer(); Circle().fill(pair.isUp ? V5P.green : V5P.red).frame(width: 4, height: 4) }
            Text(pair.price).font(.system(size: 12, weight: .bold))
            Text(pair.change).font(.system(size: 7, weight: .semibold)).foregroundStyle(pair.isUp ? V5P.green : V5P.red)
        }
        .foregroundStyle(.white)
        .padding(6).frame(width: 68, height: 55, alignment: .topLeading)
        .background(V5P.panel, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(V5P.line.opacity(0.6), lineWidth: 0.5))
    }

    private var mappedEvents: (upcoming: [HomeEventSummary], rest: [HomeEventSummary]) {
        let upcoming = viewModel.upcomingEvents.sorted { $0.releaseDatetime < $1.releaseDatetime }
        let rest = (viewModel.upcomingEvents.dropFirst() + viewModel.recentEvents)
            .sorted { $0.releaseDatetime < $1.releaseDatetime }
        return (upcoming, rest)
    }

    private var mappedPairs: [FXPairUI] {
        viewModel.majorFxList.map(FXPairUI.init(major:))
    }
}

private extension HomeViewModel {
    var majorFxList: [MajorFxSummary] {
        guard case .loaded(_, let majorFx) = state else { return [] }
        return majorFx
    }
}

extension V5EventRow {
    init(home event: HomeEventSummary) {
        self.init(
            flag: CountryFlag.emoji(for: event.countryCode),
            name: event.indicatorName,
            code: event.currencyCode,
            badge: event.importance.rawValue.capitalized,
            badgeColor: event.importance.v5Color,
            forecast: event.forecast.map { ValueFormat.number($0) } ?? "-",
            actual: event.status == .released ? (event.actual.map { ValueFormat.number($0) } ?? "-") : "-",
            previous: event.previous.map { ValueFormat.number($0) } ?? "-"
        )
    }
}

extension Importance {
    var v5Color: Color {
        switch self {
        case .high: return V5P.red
        case .medium: return V5P.green
        case .low: return V5P.blue
        }
    }
}

private extension FXPairUI {
    init(major fx: MajorFxSummary) {
        self.init(
            id: fx.fxPairId,
            symbol: fx.symbol,
            price: ValueFormat.number(fx.price, fractionDigits: fx.symbol.contains("JPY") ? 2 : 4),
            change: ValueFormat.percent(fx.changePercent, signed: true),
            isUp: (fx.changePercent ?? 0) >= 0
        )
    }
}
