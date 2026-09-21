import SwiftUI

/// SCR-001 Home (ui-screens.md §5). Real `GET /home` data — "今日の注目
/// イベント" (SCHEDULED + RELEASED) / "主要通貨ペアの動向" (major_fx), each
/// event tappable to SCR-004 Event Detail.
///
/// HQ Frontend integration (2026-09-21): visual content — hero card,
/// section headers, FX pair grid, event rows — is HQ's
/// `FXEventAnalyzer_HQFrontend/HomeView.swift`, reproduced with its own
/// `HeroEventCard`/`HeroMetric`/`FXPairCard`/`EventRow` bodies unchanged.
/// What changed: HQ's default parameters were `FXDemo` sample arrays (its
/// README is explicit that demo data must not ship); those are replaced by
/// mapping the real `HomeViewModel`'s `HomeEventSummary`/`MajorFxSummary`
/// into HQ's own `FXEventUI`/`FXPairUI` shapes (`FrontendModels.swift`),
/// and the still-owned `HomeViewModel`/`NavigationPath`/`AppRoute` wiring —
/// same data flow, `NavigationStack`, and loading/error/empty states as
/// before — is kept intact around HQ's content.
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

                VStack(alignment: .leading, spacing: 8) {
                    Text("MARKET PULSE").font(.system(size: 11, weight: .bold)).tracking(2).foregroundStyle(FXColor.cyan)
                    Text("今日の注目イベント").font(.system(size: 29, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    Text("予想 → 結果 → FX反応を一画面で確認").font(.system(size: 14)).foregroundStyle(FXColor.secondaryText)
                }

                if let heroEvent = mappedEvents.first {
                    NavigationLink(value: AppRoute.eventDetail(id: heroEvent.id)) {
                        HeroEventCard(event: heroEvent)
                    }.buttonStyle(.plain)
                }

                if !mappedPairs.isEmpty {
                    FXSectionHeader(title: "主要FX", subtitle: "リアルタイム価格")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 145), spacing: 12)], spacing: 12) {
                        ForEach(mappedPairs) { pair in FXPairCard(pair: pair) }
                    }
                }

                if !mappedEvents.isEmpty {
                    FXSectionHeader(title: "今日のイベント", subtitle: "重要度の高い順")
                    LazyVStack(spacing: 10) {
                        ForEach(mappedEvents) { event in
                            NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                                EventRow(event: event)
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal, FXMetric.horizontal)
            .padding(.vertical, 22)
            .frame(maxWidth: 1050)
        }.scrollIndicators(.hidden)
    }

    private var mappedEvents: [FXEventUI] {
        viewModel.todaysEvents.map(FXEventUI.init(home:))
    }

    private var mappedPairs: [FXPairUI] {
        viewModel.majorFxList.map(FXPairUI.init(major:))
    }
}

private struct HeroEventCard: View {
    let event: FXEventUI
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                FXBadge(text: event.importance == "HIGH" ? "HIGH IMPACT" : event.importance, tint: event.importance == "HIGH" ? FXColor.pink : FXColor.cyan)
                Spacer()
                Text(event.releaseDate, style: .time).font(.system(size: 12, weight: .semibold)).foregroundStyle(FXColor.secondaryText)
            }
            Text(event.indicatorName).font(.system(size: 24, weight: .bold, design: .rounded)).foregroundStyle(.white)
            HStack(spacing: 18) {
                HeroMetric(label: "予想", value: event.forecast ?? "—")
                HeroMetric(label: "結果", value: event.actual ?? "—")
                HeroMetric(label: "前回", value: event.previous ?? "—")
            }
            HStack {
                Text(event.pair).font(.system(size: 13, weight: .bold)).foregroundStyle(FXColor.cyan)
                Spacer()
                Image(systemName: "arrow.up.right").foregroundStyle(FXColor.cyan)
            }
        }.fxCard(padding: 20).overlay(RoundedRectangle(cornerRadius: FXMetric.radius).stroke(FXGradient.brand, lineWidth: 1).opacity(0.35))
    }
}

private struct HeroMetric: View {
    let label: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 11)).foregroundStyle(FXColor.secondaryText)
            Text(value).font(.system(size: 19, weight: .bold, design: .rounded)).foregroundStyle(.white)
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

private struct EventRow: View {
    let event: FXEventUI
    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 3).fill(event.importance == "HIGH" ? FXColor.pink : FXColor.cyan).frame(width: 4, height: 54)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(event.indicatorName).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                    FXBadge(text: event.currency, tint: FXColor.secondaryText)
                }
                Text(event.releaseDate, style: .time).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(event.actual ?? "未発表").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                Text(event.pair).font(.system(size: 11, weight: .semibold)).foregroundStyle(FXColor.cyan)
            }
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(FXColor.tertiaryText)
        }.padding(15).background(FXColor.card.opacity(0.85)).clipShape(RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(FXColor.border))
    }
}

private extension HomeViewModel {
    var majorFxList: [MajorFxSummary] {
        guard case .loaded(_, let majorFx) = state else { return [] }
        return majorFx
    }

    var todaysEvents: [HomeEventSummary] {
        (upcomingEvents + recentEvents).sorted { $0.releaseDatetime < $1.releaseDatetime }
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
