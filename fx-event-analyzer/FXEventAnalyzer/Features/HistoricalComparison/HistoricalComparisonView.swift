import Charts
import SwiftUI

/// SCR-006 Historical Comparison (ui-screens.md §5) — "今回だけでなく、
/// 過去の同一指標発表時に相場がどう動いたか比較する".
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5HistoricalComparison` (fixed 234×491 canvas,
/// timeframe pills, one large card with indicator header + bar chart +
/// 過去の発表一覧 table), reproduced as given, with one necessary
/// substitution: HQ's `V5MiniBarChart()` here draws six fixed demo heights
/// with no real data binding — the real per-event bar chart (Swift
/// `Charts`/`BarMark` over `ComparisonEventSummary.actual`, same component
/// used since the original HQ Frontend integration) is kept in the exact
/// same frame instead of a chart that would show invented values.
/// Other adaptations, all wiring:
/// - `ComparisonIndicatorSummary` carries no country code, unlike
///   Indicator/Event Detail — no flag is shown, omitted rather than
///   invented (the same gap Historical Event Detail already has).
/// - "直近5回" is the real `response.events.count`.
/// - HQ's 5 hardcoded table rows are manually space-padded single `Text`
///   lines in a non-monospaced font, which can't stay column-aligned for
///   real numbers of varying width — real rows use the same per-column
///   fixed widths (55/38/38/45) the header directly above already
///   declares, at the same font size/color, `.prefix(5)`-ed to the 5 slots
///   HQ's fixed-height card provisions (no `ScrollView` exists here);
///   each row is tappable to SCR-007 (unchanged real destination).
/// - The 統計/詳細統計 cards this screen carried in the prior (scrolling)
///   HQ UI Master v5 round have no home in this fixed, non-scrolling
///   canvas and are not part of HQ's card — dropped rather than appended
///   past it, per this round's "don't break the coordinate system" rule.
struct HistoricalComparisonView: View {
    @StateObject private var viewModel: HistoricalComparisonViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, indicatorId: String, indicatorName: String, fxPairId: String, fxPairSymbol: String, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: HistoricalComparisonViewModel(
            apiClient: apiClient,
            indicatorId: indicatorId,
            indicatorName: indicatorName,
            fxPairId: fxPairId,
            fxPairSymbol: fxPairSymbol
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
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "過去の比較データはまだ利用できません。") }
        case .notFound:
            loadingScaffold { FXEmptyState(icon: "questionmark.circle", title: "データが見つかりません", message: "指定された指標・通貨ペアの組み合わせが存在しません。") }
        case .notEntitled:
            loadingScaffold { FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは過去の比較データを閲覧できません。") }
        case .loaded(let response):
            V5Viewport {
                V5TopStatus()
                V5Header(title: "過去の比較", back: true, star: false, onBack: { dismiss() })

                HStack(spacing: 4) {
                    ForEach(ReactionTimeframe.all, id: \.self) { timeframe in
                        Button { viewModel.selectedTimeframe = timeframe } label: {
                            Text(timeframe).font(.system(size: 7)).foregroundStyle(.white)
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background(timeframe == viewModel.selectedTimeframe ? V5P.blue : V5P.panel2, in: Capsule())
                        }.buttonStyle(.plain)
                    }
                }.position(x: 117, y: 66)

                V5Card(CGRect(x: 10, y: 80, width: 214, height: 242)) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("過去の同一指標との比較").font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                        HStack {
                            Text("\(viewModel.indicatorName) (\(response.indicator.code))").font(.system(size: 8, weight: .semibold)).foregroundStyle(.white)
                            Spacer()
                            Text("直近\(response.events.count)回⌄").font(.system(size: 7)).foregroundStyle(.white).padding(5).background(V5P.panel2, in: Capsule())
                        }
                        if !response.events.isEmpty {
                            Chart(response.events) { event in
                                BarMark(
                                    x: .value("発表日", ValueFormat.dateTime(event.releaseDatetime)),
                                    y: .value("結果", event.actual ?? 0)
                                ).foregroundStyle(LinearGradient(colors: [V5P.cyan, V5P.blue], startPoint: .top, endPoint: .bottom))
                            }
                            .chartXAxis(.hidden)
                            .chartYAxis(.hidden)
                            .frame(height: 82).padding(.top, 3)
                        }
                        Text("過去の発表一覧").font(.system(size: 8, weight: .bold)).foregroundStyle(.white).padding(.top, 3)
                        HStack {
                            Text("発表日").frame(width: 55, alignment: .leading)
                            Text("結果").frame(width: 38)
                            Text("予想").frame(width: 38)
                            Text("変動").frame(width: 45)
                        }.font(.system(size: 6)).foregroundStyle(V5P.muted)
                        ForEach(response.events.prefix(5)) { event in
                            NavigationLink(value: AppRoute.historicalEventDetail(id: event.id)) {
                                historyRow(event)
                            }.buttonStyle(.plain).accessibilityIdentifier("historyEventRow")
                        }
                    }
                }

                V5BottomBar(selected: $tabSelection)
            }
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

    private func historyRow(_ event: ComparisonEventSummary) -> some View {
        HStack {
            Text(ValueFormat.dateTime(event.releaseDatetime)).frame(width: 55, alignment: .leading)
            Text(ValueFormat.number(event.actual)).frame(width: 38)
            Text(ValueFormat.number(event.forecast)).frame(width: 38)
            Text(event.surprise.map { ValueFormat.number($0, signed: true) } ?? "--")
                .foregroundStyle((event.surprise ?? 0) >= 0 ? V5P.green : V5P.red)
                .frame(width: 45)
        }
        .font(.system(size: 6))
        .foregroundStyle(.white)
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}
