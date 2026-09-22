import Charts
import SwiftUI

/// SCR-006 Historical Comparison (ui-screens.md §5) — "今回だけでなく、
/// 過去の同一指標発表時に相場がどう動いたか比較する".
///
/// HQ UI Master v5 integration (2026-09-22): reproduces
/// `Assets/Reference/SCR-006.png` — indicator header with a "直近5回"
/// count, a bar chart of each past release's actual value, and a
/// "過去の発表一覧" table (発表日/結果/予想/変動). The bar chart and table
/// use the same real `ComparisonEventSummary` data as before (actual/
/// forecast/surprise); the existing stats/advanced-statistics cards (not
/// visible in the reference's single screenshot) are kept further down so
/// that data isn't dropped.
struct HistoricalComparisonView: View {
    @StateObject private var viewModel: HistoricalComparisonViewModel

    init(apiClient: APIClient, indicatorId: String, indicatorName: String, fxPairId: String, fxPairSymbol: String) {
        _viewModel = StateObject(wrappedValue: HistoricalComparisonViewModel(
            apiClient: apiClient,
            indicatorId: indicatorId,
            indicatorName: indicatorName,
            fxPairId: fxPairId,
            fxPairSymbol: fxPairSymbol
        ))
    }

    var body: some View {
        ZStack {
            FXAppBackground()
            content
        }
        .navigationTitle("過去の比較")
        .navigationBarTitleDisplayMode(.inline)
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            LoadingView(caption: "読み込み中...")
        case .backendNotConfigured:
            FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "過去の比較データはまだ利用できません。")
        case .notFound:
            FXEmptyState(icon: "questionmark.circle", title: "データが見つかりません", message: "指定された指標・通貨ペアの組み合わせが存在しません。")
        case .notEntitled:
            FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは過去の比較データを閲覧できません。")
        case .loaded(let response):
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    timeframePicker
                    comparisonCard(response)
                    statsSection(response)
                    advancedStatisticsSection(response.advancedStatistics)
                }.padding(20).frame(maxWidth: 1000)
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private var timeframePicker: some View {
        Picker("時間軸", selection: $viewModel.selectedTimeframe) {
            ForEach(ReactionTimeframe.all, id: \.self) { Text($0).tag($0) }
        }.pickerStyle(.segmented)
    }

    private func comparisonCard(_ response: ComparisonResponse) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("過去の同一指標との比較").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
            HStack {
                Text("\(viewModel.indicatorName) (\(response.indicator.code))").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                Spacer()
                Text("直近\(response.events.count)回").font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            }
            Text(viewModel.fxPairSymbol).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)

            if !response.events.isEmpty {
                Chart(response.events) { event in
                    BarMark(
                        x: .value("発表日", ValueFormat.dateTime(event.releaseDatetime)),
                        y: .value("結果", event.actual ?? 0)
                    ).foregroundStyle(FXColor.cyan.gradient)
                }
                .chartXAxis(.hidden)
                .chartYAxis {
                    AxisMarks { _ in
                        AxisGridLine().foregroundStyle(FXColor.border)
                        AxisValueLabel().foregroundStyle(FXColor.secondaryText)
                    }
                }
                .frame(height: 180)
            }

            Text("過去の発表一覧").font(.system(size: 15, weight: .bold, design: .rounded)).foregroundStyle(.white)
            VStack(spacing: 0) {
                historyTableHeader
                Divider().background(FXColor.border)
                ForEach(Array(response.events.enumerated()), id: \.element.id) { index, event in
                    NavigationLink(value: AppRoute.historicalEventDetail(id: event.id)) {
                        historyTableRow(event)
                    }.buttonStyle(.plain).accessibilityIdentifier("historyEventRow")
                    if index != response.events.count - 1 {
                        Divider().background(FXColor.border)
                    }
                }
            }
        }.fxCard()
    }

    private var historyTableHeader: some View {
        HStack {
            tableCell("発表日", alignment: .leading)
            tableCell("結果", alignment: .trailing)
            tableCell("予想", alignment: .trailing)
            tableCell("変動", alignment: .trailing)
        }.font(.system(size: 11, weight: .semibold)).foregroundStyle(FXColor.secondaryText)
    }

    private func historyTableRow(_ event: ComparisonEventSummary) -> some View {
        HStack {
            tableCell(ValueFormat.dateTime(event.releaseDatetime), alignment: .leading, color: .white)
            tableCell(ValueFormat.number(event.actual), alignment: .trailing, color: .white)
            tableCell(ValueFormat.number(event.forecast), alignment: .trailing, color: .white)
            tableCell(
                event.surprise.map { ValueFormat.number($0, signed: true) } ?? "--",
                alignment: .trailing,
                color: (event.surprise ?? 0) >= 0 ? FXColor.green : FXColor.red
            )
        }.font(.system(size: 12)).padding(.vertical, 10).contentShape(Rectangle())
    }

    private func tableCell(_ text: String, alignment: Alignment, color: Color = FXColor.secondaryText) -> some View {
        Text(text).foregroundStyle(color).frame(maxWidth: .infinity, alignment: alignment)
    }

    private func statsSection(_ response: ComparisonResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("分析可能 \(response.analyzableEvents) / 全 \(response.totalEvents) 件").font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            HStack {
                FXMetricTile(label: "平均変動幅", value: ValueFormat.number(response.stats.averageMovement, fractionDigits: 3, signed: true), tint: FXColor.cyan)
                FXMetricTile(label: "平均Pips", value: ValueFormat.pips(response.stats.averagePips), tint: FXColor.pink)
            }
            HStack {
                FXMetricTile(label: "最大変動", value: ValueFormat.number(response.stats.maxMovement, fractionDigits: 3, signed: true))
                FXMetricTile(label: "最小変動", value: ValueFormat.number(response.stats.minMovement, fractionDigits: 3, signed: true))
            }
            HStack(spacing: 18) {
                countColumn(title: "上昇", value: response.stats.upwardCount, color: FXColor.green)
                countColumn(title: "下落", value: response.stats.downwardCount, color: FXColor.red)
                countColumn(title: "変化なし", value: response.stats.noChangeCount, color: FXColor.secondaryText)
            }
        }.fxCard()
    }

    @ViewBuilder
    private func advancedStatisticsSection(_ advanced: AdvancedStatistics) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("詳細統計 (Advanced Statistics)").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
            if advanced.available, let data = advanced.data {
                HStack {
                    FXMetricTile(label: "平均絶対変動幅", value: ValueFormat.number(data.averageAbsoluteMovement, fractionDigits: 3))
                    FXMetricTile(label: "平均絶対Pips", value: ValueFormat.pips(data.averageAbsolutePips, signed: false))
                }
            } else {
                Text("この統計はPro会員限定です。").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            }
        }.fxCard()
    }

    private func countColumn(title: String, value: Int, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            Text("\(value)").font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(color)
        }
    }
}
