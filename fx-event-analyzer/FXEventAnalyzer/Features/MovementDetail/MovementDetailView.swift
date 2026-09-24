import SwiftUI

/// SCR-005 Movement Detail (ui-screens.md §5) — "発表前後にFX相場が実際に
/// どれくらい動いたのか確認する". Timeframe Segmented Control drives both
/// the Reaction figures (fetched once, every timeframe) and the Chart
/// (re-fetched per timeframe).
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5MovementDetail` (fixed 234×491 canvas,
/// timeframe pill rows, chart, 発表前/発表後/変動幅 metric card, "主要指標"
/// metric card), reproduced as given, with one necessary substitution:
/// HQ's `V5CandleChart()` here draws a fixed, hardcoded candle series with
/// no real data binding — the real price series (`FXPriceChart` fed
/// `ChartResponse.prices`, unchanged since the original HQ Frontend
/// integration) is kept in the exact same 204×135 frame/position instead
/// of a chart that would show invented candles, the same rule already
/// applied to this screen's chart in the prior HQ UI Master v5 round.
/// Other adaptations, all wiring:
/// - Both timeframe pill rows are real, bound to
///   `viewModel.selectedTimeframe` over `ReactionTimeframe.all`.
/// - 発表前/発表後/変動幅/最大上昇幅/最大下落幅 use the real
///   `ReactionTimeframeEntry` for the selected timeframe. HQ's demo's
///   two-line 変動幅 ("+0.33\n(+0.22%)") and third "主要指標" slot
///   ("平均変動幅") have no backing percent/average field on this model —
///   shown as a single line / omitted rather than fabricated.
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
        content
            .toolbar(.hidden, for: .navigationBar)
            .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "値動き情報はまだ利用できません。") }
        case .notFound:
            loadingScaffold { FXEmptyState(icon: "questionmark.circle", title: "データが見つかりません", message: "指定されたイベント・通貨ペアの組み合わせが存在しません。") }
        case .notEntitled:
            loadingScaffold { FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは値動き情報を閲覧できません。") }
        case .loaded(let preReleasePrice, let reactions):
            V5Viewport {
                V5TopStatus()
                V5Header(title: "変動詳細", back: true, star: false, onBack: { dismiss() })

                HStack {
                    Text(viewModel.selectedTimeframe).font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 9).padding(.vertical, 5).background(V5P.blue, in: Capsule())
                    Text(viewModel.symbol).font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                    Spacer()
                }
                .frame(width: 204, height: 27).padding(.horizontal, 7).background(V5P.panel2, in: Capsule()).position(x: 117, y: 66)

                HStack(spacing: 4) {
                    ForEach(ReactionTimeframe.all, id: \.self) { timeframe in
                        Button { viewModel.selectedTimeframe = timeframe } label: {
                            Text(timeframe).font(.system(size: 7)).foregroundStyle(.white)
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(timeframe == viewModel.selectedTimeframe ? V5P.blue : V5P.panel2, in: Capsule())
                        }.buttonStyle(.plain)
                    }
                }.position(x: 117, y: 91)

                chartSection.frame(width: 204, height: 135).position(x: 117, y: 165)

                Text("発表前後の変動").font(.system(size: 9, weight: .bold)).foregroundStyle(.white).position(x: 48, y: 247)
                V5Card(CGRect(x: 10, y: 257, width: 214, height: 64)) {
                    let selected = reactions.first(where: { $0.timeframe == viewModel.selectedTimeframe })
                    HStack {
                        metric("発表前", ValueFormat.number(preReleasePrice, fractionDigits: 3))
                        if let selected, selected.analysisStatus == .ready {
                            metric("発表後", ValueFormat.number(selected.postReleasePrice, fractionDigits: 3))
                            metric("変動幅", ValueFormat.number(selected.movement, fractionDigits: 3, signed: true))
                        } else {
                            metric("発表後", selected?.analysisStatus.label ?? "--")
                        }
                    }
                }

                if let selected = reactions.first(where: { $0.timeframe == viewModel.selectedTimeframe }), selected.analysisStatus == .ready {
                    Text("主要指標").font(.system(size: 9, weight: .bold)).foregroundStyle(.white).position(x: 39, y: 335)
                    V5Card(CGRect(x: 10, y: 345, width: 214, height: 58)) {
                        HStack {
                            metric("最大上昇幅", ValueFormat.number(selected.maxUpward, fractionDigits: 3, signed: true))
                            metric("最大下落幅", ValueFormat.number(selected.maxDownward, fractionDigits: 3, signed: true))
                        }
                    }
                }

                V5BottomBar(selected: $tabSelection)
            }
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    @ViewBuilder
    private var chartSection: some View {
        switch viewModel.chartState {
        case .loading:
            LoadingView(caption: "チャートを読み込み中...")
        case .empty:
            FXEmptyState(icon: "chart.xyaxis.line", title: "チャートデータがありません", message: "この時間軸のチャートデータはまだ取得されていません。")
        case .error(let message):
            ErrorView(title: "チャート取得に失敗しました", message: message, onRetry: { viewModel.retryChart() })
        case .loaded(let chart):
            FXPriceChart(points: mappedPoints(chart), releaseIndex: releaseIndex(chart))
        }
    }

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: () -> some View) -> some View {
        ZStack {
            LinearGradient(colors: [V5P.bg0, V5P.bg1, V5P.bg0], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            content()
        }
    }

    @ViewBuilder private func metric(_ a: String, _ b: String) -> some View {
        VStack(spacing: 2) {
            Text(a).font(.system(size: 6)).foregroundStyle(V5P.muted)
            Text(b).font(.system(size: 10, weight: .bold)).foregroundStyle(b.hasPrefix("-") ? V5P.red : (b.hasPrefix("+") ? V5P.green : .white))
        }.frame(maxWidth: .infinity)
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
