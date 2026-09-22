import SwiftUI

/// SCR-005 Movement Detail (ui-screens.md §5) — "発表前後にFX相場が実際に
/// どれくらい動いたのか確認する". Timeframe Segmented Control drives both
/// the Reaction figures (fetched once, every timeframe) and the Chart
/// (re-fetched per timeframe).
///
/// HQ Frontend integration (2026-09-21): visual content — segmented picker,
/// elevated chart card, metric tiles — is HQ's
/// `FXEventAnalyzer_HQFrontend/MovementDetailView.swift`, including its
/// `FXPriceChart` component (`FXComponents.swift`) fed real
/// `ChartResponse.prices` mapped into `ChartPoint`, with `releaseIndex`
/// computed from the real `releaseDatetime` rather than HQ's fixed demo
/// index. Reaction figures use HQ's `FXMetricTile` with the real selected
/// timeframe's `ReactionTimeframeEntry`, and the loading/empty/error states
/// HQ's mockup didn't cover (chart not yet available, entitlement, 404) are
/// kept via the existing components.
struct MovementDetailView: View {
    @StateObject private var viewModel: MovementDetailViewModel

    init(apiClient: APIClient, eventId: String, indicatorId: String, fxPairId: String, symbol: String, indicatorName: String, releaseDatetime: Date) {
        _viewModel = StateObject(wrappedValue: MovementDetailViewModel(
            apiClient: apiClient,
            eventId: eventId,
            indicatorId: indicatorId,
            fxPairId: fxPairId,
            symbol: symbol,
            indicatorName: indicatorName,
            releaseDatetime: releaseDatetime
        ))
    }

    var body: some View {
        ZStack {
            FXAppBackground()
            content
        }
        .navigationTitle("変動詳細")
        .navigationBarTitleDisplayMode(.inline)
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
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    timeframePicker
                    chartSection
                    reactionTiles(preReleasePrice: preReleasePrice, reactions: reactions)
                    historicalComparisonLink
                }.padding(20).frame(maxWidth: 1000)
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text(viewModel.selectedTimeframe)
                .font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(FXColor.cyan).clipShape(Capsule())
            Text(viewModel.symbol).font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(.white)
            Spacer()
        }.fxCard(padding: 14)
    }

    private var timeframePicker: some View {
        Picker("Timeframe", selection: $viewModel.selectedTimeframe) {
            ForEach(ReactionTimeframe.all, id: \.self) { Text($0).tag($0) }
        }.pickerStyle(.segmented)
    }

    @ViewBuilder
    private var chartSection: some View {
        switch viewModel.chartState {
        case .loading:
            LoadingView(caption: "チャートを読み込み中...").frame(height: 220)
        case .empty:
            FXEmptyState(icon: "chart.xyaxis.line", title: "チャートデータがありません", message: "この時間軸のチャートデータはまだ取得されていません。").frame(height: 220)
        case .error(let message):
            ErrorView(title: "チャート取得に失敗しました", message: message, onRetry: { viewModel.retryChart() }).frame(height: 220)
        case .loaded(let chart):
            FXPriceChart(points: mappedPoints(chart), releaseIndex: releaseIndex(chart)).frame(height: 280).fxCard(padding: 10)
        }
    }

    private func reactionTiles(preReleasePrice: Double?, reactions: [ReactionTimeframeEntry]) -> some View {
        let selected = reactions.first(where: { $0.timeframe == viewModel.selectedTimeframe })
        return VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 10) {
                Text("発表前後の変動").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
                HStack {
                    metric(title: "発表前", value: ValueFormat.number(preReleasePrice, fractionDigits: 3))
                    if let selected, selected.analysisStatus == .ready {
                        metric(title: "発表後", value: ValueFormat.number(selected.postReleasePrice, fractionDigits: 3))
                        metric(title: "変動幅", value: ValueFormat.number(selected.movement, fractionDigits: 3, signed: true), tint: (selected.movement ?? 0) >= 0 ? FXColor.green : FXColor.red)
                    } else {
                        metric(title: "発表後", value: selected?.analysisStatus.label ?? "--")
                    }
                }
            }.fxCard()

            if let selected, selected.analysisStatus == .ready {
                VStack(alignment: .leading, spacing: 10) {
                    Text("主要指標").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    HStack {
                        metric(title: "最大上昇幅", value: ValueFormat.number(selected.maxUpward, fractionDigits: 3, signed: true), tint: FXColor.green)
                        metric(title: "最大下落幅", value: ValueFormat.number(selected.maxDownward, fractionDigits: 3, signed: true), tint: FXColor.red)
                    }
                }.fxCard()
            }
        }
    }

    private func metric(title: String, value: String, tint: Color = .white) -> some View {
        VStack(spacing: 4) {
            Text(title).font(.system(size: 11)).foregroundStyle(FXColor.secondaryText)
            Text(value).font(.system(size: 17, weight: .bold, design: .rounded)).foregroundStyle(tint)
        }.frame(maxWidth: .infinity)
    }

    private var historicalComparisonLink: some View {
        NavigationLink(value: AppRoute.historicalComparison(
            indicatorId: viewModel.indicatorId,
            indicatorName: viewModel.indicatorName,
            fxPairId: viewModel.fxPairId,
            fxPairSymbol: viewModel.symbol
        )) {
            HStack { Text("過去の値動きと比較する"); Spacer(); Image(systemName: "arrow.right") }
                .foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 52)
                .background(FXColor.card).clipShape(RoundedRectangle(cornerRadius: 15)).overlay(RoundedRectangle(cornerRadius: 15).stroke(FXColor.border))
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
