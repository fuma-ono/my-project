import SwiftUI

/// SCR-005 Movement Detail (ui-screens.md §5) — "発表前後にFX相場が実際に
/// どれくらい動いたのか確認する". Timeframe Segmented Control drives both
/// the Reaction figures (fetched once, every timeframe) and the Chart
/// (re-fetched per timeframe).
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5MovementDetailView` (`HQV5TopBar`,
/// timeframe pill row, chart card, 発表前/発表後/変動幅 metric card, "主要
/// 指標" metric card), reproduced as given, with one necessary substitution:
/// HQ's `HQV5Chart()` here is a fixed decorative line with no real data
/// binding — the real price series (`FXPriceChart` fed
/// `ChartResponse.prices`, unchanged since the prior HQ Frontend
/// integration) is kept in its place instead of a fabricated-looking chart,
/// same "never show real screens with invented data" rule already applied
/// throughout this integration. Other adaptations, all wiring:
/// - The pill row is a real `Picker`-equivalent over `ReactionTimeframe.all`
///   bound to `viewModel.selectedTimeframe`, not HQ's hardcoded 5 pills.
/// - 発表前/発表後/変動幅/最大上昇幅/最大下落幅 use the real
///   `ReactionTimeframeEntry` for the selected timeframe; HQ's demo third
///   "平均変動幅" tile has no backing field and is omitted rather than
///   invented.
/// - `tabSelection`: a real `Binding<Int>` threaded from `MainTabView`.
struct MovementDetailView: View {
    @StateObject private var viewModel: MovementDetailViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, eventId: String, indicatorId: String, fxPairId: String, symbol: String, indicatorName: String, releaseDatetime: Date, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: MovementDetailViewModel(
            apiClient: apiClient,
            eventId: eventId,
            indicatorId: indicatorId,
            fxPairId: fxPairId,
            symbol: symbol,
            indicatorName: indicatorName,
            releaseDatetime: releaseDatetime
        ))
        _tabSelection = tabSelection
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            HQV5Background()
            content
                .safeAreaInset(edge: .bottom) {
                    HQV5BottomBar(selected: $tabSelection).padding(.horizontal, 10).padding(.bottom, 5)
                }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            LoadingView(caption: "読み込み中...")
        case .backendNotConfigured:
            FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "値動き情報はまだ利用できません。")
        case .notFound:
            FXEmptyState(icon: "questionmark.circle", title: "データが見つかりません", message: "指定されたイベント・通貨ペアの組み合わせが存在しません。")
        case .notEntitled:
            FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは値動き情報を閲覧できません。")
        case .loaded(let preReleasePrice, let reactions):
            HQV5Screen {
                HQV5TopBar(title: "変動詳細", onBack: { dismiss() })

                HStack {
                    HQV5Pill(text: viewModel.selectedTimeframe, active: true)
                    Text(viewModel.symbol).font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                    Spacer()
                }.padding(8).background(HQV5.panel2, in: Capsule())

                HStack {
                    ForEach(ReactionTimeframe.all, id: \.self) { timeframe in
                        Button { viewModel.selectedTimeframe = timeframe } label: {
                            HQV5Pill(text: timeframe, active: timeframe == viewModel.selectedTimeframe)
                        }.buttonStyle(.plain)
                    }
                }

                chartSection

                reactionTiles(preReleasePrice: preReleasePrice, reactions: reactions)

                historicalComparisonLink
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    @ViewBuilder
    private var chartSection: some View {
        switch viewModel.chartState {
        case .loading:
            LoadingView(caption: "チャートを読み込み中...").frame(height: 190)
        case .empty:
            FXEmptyState(icon: "chart.xyaxis.line", title: "チャートデータがありません", message: "この時間軸のチャートデータはまだ取得されていません。").frame(height: 190)
        case .error(let message):
            ErrorView(title: "チャート取得に失敗しました", message: message, onRetry: { viewModel.retryChart() }).frame(height: 190)
        case .loaded(let chart):
            FXPriceChart(points: mappedPoints(chart), releaseIndex: releaseIndex(chart)).frame(height: 190)
        }
    }

    private func reactionTiles(preReleasePrice: Double?, reactions: [ReactionTimeframeEntry]) -> some View {
        let selected = reactions.first(where: { $0.timeframe == viewModel.selectedTimeframe })
        return VStack(alignment: .leading, spacing: 12) {
            HQV5NeonCard {
                HStack {
                    HQV5MetricRow(title: "発表前", value: ValueFormat.number(preReleasePrice, fractionDigits: 3), tint: .white)
                    if let selected, selected.analysisStatus == .ready {
                        HQV5MetricRow(title: "発表後", value: ValueFormat.number(selected.postReleasePrice, fractionDigits: 3), tint: .white)
                        HQV5MetricRow(title: "変動幅", value: ValueFormat.number(selected.movement, fractionDigits: 3, signed: true), tint: (selected.movement ?? 0) >= 0 ? HQV5.green : HQV5.red)
                    } else {
                        HQV5MetricRow(title: "発表後", value: selected?.analysisStatus.label ?? "--", tint: .white)
                    }
                }
            }

            if let selected, selected.analysisStatus == .ready {
                Text("主要指標").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                HQV5NeonCard {
                    HStack {
                        HQV5MetricRow(title: "最大上昇幅", value: ValueFormat.number(selected.maxUpward, fractionDigits: 3, signed: true), tint: HQV5.green)
                        HQV5MetricRow(title: "最大下落幅", value: ValueFormat.number(selected.maxDownward, fractionDigits: 3, signed: true), tint: HQV5.red)
                    }
                }
            }
        }
    }

    private var historicalComparisonLink: some View {
        NavigationLink(value: AppRoute.historicalComparison(
            indicatorId: viewModel.indicatorId,
            indicatorName: viewModel.indicatorName,
            fxPairId: viewModel.fxPairId,
            fxPairSymbol: viewModel.symbol
        )) {
            HQV5NeonCard {
                HStack {
                    Image(systemName: "chart.bar.xaxis").foregroundStyle(HQV5.cyan)
                    Text("過去の値動きと比較する").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(HQV5.muted)
                }
            }
        }.buttonStyle(.plain)
    }

    private func mappedPoints(_ chart: ChartResponse) -> [ChartPoint] {
        chart.prices.map { ChartPoint(time: $0.timestamp, value: $0.close) }
    }

    private func releaseIndex(_ chart: ChartResponse) -> Int? {
        guard !chart.prices.isEmpty else { return nil }
        let target = chart.releaseDatetime
        if let exact = chart.prices.firstIndex(where: { $0.timestamp >= target }) {
            return exact
        }
        return chart.prices.count - 1
    }
}
