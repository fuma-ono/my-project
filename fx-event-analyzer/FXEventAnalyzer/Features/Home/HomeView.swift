import SwiftUI

/// SCR-001 Home (ui-screens.md §5). Real `GET /home` data — SCHEDULED /
/// RELEASED events, each tappable to SCR-004 Event Detail.
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5HomeView` (`HQV5Logo`, "Upcoming Events"
/// hero card, "Recent Events" list, "主要FX" pair row, `HQV5BottomBar`),
/// reproduced as given. Adaptations, all wiring, not redesign:
/// - `HQV5DemoRouter.push("event")` → real `AppRoute.eventDetail`
///   `NavigationLink`.
/// - `HQV5Store.shared.upcoming`/`.recent` → `HomeViewModel`'s real
///   `upcomingEvents`/`recentEvents`, mapped to `HQV5Event`. HQ's demo
///   always shows one upcoming event; the real day can have none, so the
///   hero card is shown only `if let`, matching how every other real-data
///   gap in this app is handled (never fabricated).
/// - The two hardcoded `pairCard` calls (USD/JPY, EUR/USD) → a `ForEach`
///   over the real `GET /home` major-FX list, so no pair the API returns
///   is dropped just because HQ's file only demoed two.
/// - `@State private var tab` (a local, disconnected int) → `tabSelection`,
///   a real `Binding<Int>` threaded down from `MainTabView`'s actual tab
///   selection, so `HQV5BottomBar` switches tabs for real.
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
            ZStack(alignment: .bottom) {
                HQV5Background()
                content
                    .safeAreaInset(edge: .bottom) {
                        HQV5BottomBar(selected: $tabSelection).padding(.horizontal, 10).padding(.bottom, 5)
                    }
            }
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
            LoadingView(caption: "読み込み中...")
        case .backendNotConfigured:
            FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "経済指標データはまだ利用できません。実装が完了次第、ここに表示されます。")
        case .loaded(let events, let majorFx) where events.isEmpty && majorFx.isEmpty:
            FXEmptyState(icon: "calendar", title: "本日のイベントはありません", message: "本日発表予定の経済指標はありません。")
        case .loaded:
            loadedScroll
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private var loadedScroll: some View {
        HQV5Screen {
            HStack { HQV5Logo(); Spacer(); Image(systemName: "bell").foregroundStyle(.white) }

            if let hero = mappedEvents.upcoming.first {
                HQV5NeonCard {
                    VStack(alignment: .leading, spacing: 9) {
                        Text("Upcoming Events").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                        Text("Today \(ValueFormat.time(hero.releaseDatetime))").font(.system(size: 9)).foregroundStyle(HQV5.muted)
                        NavigationLink(value: AppRoute.eventDetail(id: hero.id)) {
                            eventLine(HQV5Event(home: hero))
                        }.buttonStyle(.plain)
                    }
                }
            }

            if !mappedEvents.rest.isEmpty {
                Text("Recent Events").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                ForEach(mappedEvents.rest) { event in
                    NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                        eventCard(HQV5Event(home: event))
                    }.buttonStyle(.plain)
                }
            }

            if !mappedPairs.isEmpty {
                Text("主要FX").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                HStack(spacing: 7) {
                    ForEach(mappedPairs) { pair in pairCard(pair) }
                }
                .padding(.bottom, 12)
            }
        }
    }

    @ViewBuilder private func eventLine(_ e: HQV5Event) -> some View {
        HStack { Text(e.flag); Text(e.name).font(.system(size: 10, weight: .semibold)).foregroundStyle(.white); Spacer(); HQV5Badge(text: e.importanceText, kind: e.importance); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.white) }
        HStack { HQV5MetricRow(title: "予想", value: e.forecast, tint: .white); HQV5MetricRow(title: "結果", value: e.actual, tint: .white); HQV5MetricRow(title: "前回", value: e.previous, tint: .white) }
    }
    @ViewBuilder private func eventCard(_ e: HQV5Event) -> some View {
        HQV5NeonCard {
            HStack { Text(e.flag); Text(e.name).font(.system(size: 10, weight: .semibold)).foregroundStyle(.white); Spacer(); HQV5Badge(text: e.importanceText, kind: e.importance); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.white) }
            HStack { HQV5MetricRow(title: "予想", value: e.forecast, tint: .white); HQV5MetricRow(title: "結果", value: e.actual, tint: .white); HQV5MetricRow(title: "前回", value: e.previous, tint: .white) }
        }
    }
    @ViewBuilder private func pairCard(_ pair: FXPairUI) -> some View {
        HQV5NeonCard {
            VStack(alignment: .leading, spacing: 5) {
                HStack { Text(pair.symbol).font(.system(size: 10, weight: .bold)).foregroundStyle(.white); Spacer(); Circle().fill(pair.isUp ? HQV5.green : HQV5.red).frame(width: 5, height: 5) }
                Text(pair.price).font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
                Text(pair.change).font(.system(size: 9, weight: .semibold)).foregroundStyle(pair.isUp ? HQV5.green : HQV5.red)
            }
        }
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

extension HQV5Event {
    init(home event: HomeEventSummary) {
        self.init(
            id: event.id,
            flag: CountryFlag.emoji(for: event.countryCode),
            name: "\(CountryFlag.kanjiAbbreviation(for: event.countryCode))) \(event.indicatorName)",
            code: event.currencyCode,
            importance: event.importance.hqv5Kind,
            importanceText: event.importance.rawValue.capitalized,
            time: ValueFormat.dateTime(event.releaseDatetime),
            forecast: event.forecast.map { ValueFormat.number($0) } ?? "-",
            actual: event.status == .released ? (event.actual.map { ValueFormat.number($0) } ?? "-") : "—",
            previous: event.previous.map { ValueFormat.number($0) } ?? "-",
            surprise: event.surprise.map { ValueFormat.number($0, signed: true) } ?? "—"
        )
    }
}

extension Importance {
    var hqv5Kind: HQV5Badge.Kind {
        switch self {
        case .high: return .high
        case .medium: return .medium
        case .low: return .low
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
