import SwiftUI

/// SCR-001 Home (ui-screens.md §5). Real `GET /home` data — SCHEDULED /
/// RELEASED events, each tappable to SCR-004 Event Detail.
///
/// HQ UI Master v5 integration (2026-09-22): visual content — the
/// "Upcoming Events" hero card (the single next SCHEDULED event) and the
/// separate "Recent Events" list card below it — reproduces
/// `Assets/Reference/SCR-001.png` exactly, per HQ's explicit instruction
/// that this reference is final and not to be redesigned. The only
/// adaptation: `HomeViewModel`'s `upcomingEvents`/`recentEvents` already
/// split events by status — "Upcoming Events" shows the soonest upcoming
/// one as the hero, "Recent Events" shows every other event today (the
/// rest of upcoming + all released), so no event the API returns is
/// dropped from the screen just because the reference mockup only showed
/// one example row under "Upcoming Events". The major-FX-pairs card
/// (existing `GET /home` data, not visible in the reference's single
/// screenshot viewport) is kept below, so that existing data isn't lost.
struct HomeView: View {
    @StateObject private var viewModel: HomeViewModel
    @Binding var path: NavigationPath
    private let apiClient: APIClient

    init(apiClient: APIClient, path: Binding<NavigationPath>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: HomeViewModel(apiClient: apiClient))
        _path = path
    }

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                FXAppBackground()
                content
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient)
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
        ScrollView {
            VStack(alignment: .leading, spacing: FXMetric.sectionGap) {
                HStack {
                    FXBrandMark()
                    Spacer()
                    Button {} label: {
                        Image(systemName: "bell").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white).frame(width: 42, height: 42).background(FXColor.card).clipShape(Circle())
                    }
                }

                if let hero = mappedEvents.upcoming.first {
                    upcomingEventsCard(hero)
                }

                if !mappedEvents.rest.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Recent Events").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(.white)
                        VStack(spacing: 0) {
                            ForEach(Array(mappedEvents.rest.enumerated()), id: \.element.id) { index, event in
                                NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                                    EventRow(event: event)
                                }.buttonStyle(.plain)
                                if index != mappedEvents.rest.count - 1 {
                                    Divider().background(FXColor.border)
                                }
                            }
                        }.fxCard()
                    }
                }

                if !mappedPairs.isEmpty {
                    FXSectionHeader(title: "主要FX", subtitle: "リアルタイム価格")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 145), spacing: 12)], spacing: 12) {
                        ForEach(mappedPairs) { pair in FXPairCard(pair: pair) }
                    }
                }
            }
            .padding(.horizontal, FXMetric.horizontal)
            .padding(.vertical, 22)
            .frame(maxWidth: 1050)
        }.scrollIndicators(.hidden)
    }

    private func upcomingEventsCard(_ event: FXEventUI) -> some View {
        NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Upcoming Events").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(.white)
                Text("Today \(ValueFormat.time(event.releaseDate))").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
                EventRow(event: event)
            }.fxCard()
        }.buttonStyle(.plain)
    }

    private var mappedEvents: (upcoming: [FXEventUI], rest: [FXEventUI]) {
        let upcoming = viewModel.upcomingEvents.sorted { $0.releaseDatetime < $1.releaseDatetime }.map(FXEventUI.init(home:))
        let rest = (viewModel.upcomingEvents.dropFirst() + viewModel.recentEvents)
            .sorted { $0.releaseDatetime < $1.releaseDatetime }
            .map(FXEventUI.init(home:))
        return (upcoming, rest)
    }

    private var mappedPairs: [FXPairUI] {
        viewModel.majorFxList.map(FXPairUI.init(major:))
    }
}

private struct EventRow: View {
    let event: FXEventUI
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Text(CountryFlag.emoji(for: event.country)).font(.system(size: 24))
                Text(event.currency).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                Text(event.indicatorName).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                Spacer()
                FXBadge(text: event.importance.capitalized, tint: importanceTint)
                Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(FXColor.tertiaryText)
            }
            HStack {
                metric(title: "予想", value: event.forecast ?? "-")
                metric(title: "結果", value: event.actual ?? "-")
                metric(title: "前回", value: event.previous ?? "-")
            }
        }.padding(.vertical, 10)
    }

    private var importanceTint: Color {
        switch event.importance {
        case "HIGH": return FXColor.red
        case "MEDIUM": return FXColor.green
        default: return FXColor.blue
        }
    }

    private func metric(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.system(size: 11)).foregroundStyle(FXColor.secondaryText)
            Text(value).font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FXPairCard: View {
    let pair: FXPairUI
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text(pair.symbol).font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                Spacer()
                Circle().fill(pair.isUp ? FXColor.green : FXColor.red).frame(width: 6, height: 6)
            }
            Text(pair.price).font(.system(size: 22, weight: .bold, design: .rounded))
            Text(pair.change).font(.system(size: 12, weight: .semibold)).foregroundStyle(pair.isUp ? FXColor.green : FXColor.red)
        }.fxCard(padding: 14)
    }
}

private extension HomeViewModel {
    var majorFxList: [MajorFxSummary] {
        guard case .loaded(_, let majorFx) = state else { return [] }
        return majorFx
    }
}

private extension FXEventUI {
    init(home event: HomeEventSummary) {
        self.init(
            id: event.id,
            indicatorID: event.indicatorId,
            indicatorName: event.indicatorName,
            country: event.countryCode,
            currency: event.currencyCode,
            importance: event.importance.rawValue,
            releaseDate: event.releaseDatetime,
            status: event.status.rawValue,
            dataStatus: event.dataStatus.rawValue,
            forecast: event.forecast.map { ValueFormat.number($0) },
            actual: event.status == .released ? event.actual.map { ValueFormat.number($0) } : nil,
            previous: event.previous.map { ValueFormat.number($0) },
            surprise: event.surprise.map { ValueFormat.number($0, signed: true) },
            surpriseLabel: event.surpriseDirection?.label,
            pair: event.relatedFxPairs.first?.symbol ?? "--",
            reaction5m: nil
        )
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
