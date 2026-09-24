import Charts
import SwiftUI

/// SCR-006 Historical Comparison (ui-screens.md §5) — "今回だけでなく、
/// 過去の同一指標発表時に相場がどう動いたか比較する".
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5HistoricalComparisonView` (`HQV5TopBar`,
/// timeframe pill row, `HQV5NeonCard` with indicator header + "直近N回"
/// pill + bar chart + 過去の発表一覧), reproduced as given, with one
/// necessary substitution: HQ's `HQV5BarChart()` here draws six fixed demo
/// heights with no real data binding — the real per-event bar chart (Swift
/// `Charts`/`BarMark` over `ComparisonEventSummary.actual`, unchanged since
/// the prior HQ Frontend integration) is kept in its place instead of a
/// chart that would show invented values, the same rule already applied to
/// Movement Detail's chart in this integration. Other adaptations, all
/// wiring:
/// - The pill row is real, bound to `viewModel.selectedTimeframe` over
///   `ReactionTimeframe.all`, not HQ's static 5 pills.
/// - "過去の発表一覧" rows are the real `response.events`, each tappable to
///   SCR-007 (unchanged real destination), not HQ's 4 hardcoded text lines.
/// - 統計/詳細統計 cards (not visible in HQ's single screenshot) are kept
///   further down, restyled to HQV5's card language, so real data isn't
///   dropped.
/// - `tabSelection`: a real `Binding<Int>` threaded from `MainTabView`.
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
            FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "過去の比較データはまだ利用できません。")
        case .notFound:
            FXEmptyState(icon: "questionmark.circle", title: "データが見つかりません", message: "指定された指標・通貨ペアの組み合わせが存在しません。")
        case .notEntitled:
            FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは過去の比較データを閲覧できません。")
        case .loaded(let response):
            HQV5Screen {
                HQV5TopBar(title: "過去の比較", onBack: { dismiss() })

                HStack {
                    ForEach(ReactionTimeframe.all, id: \.self) { timeframe in
                        Button { viewModel.selectedTimeframe = timeframe } label: {
                            HQV5Pill(text: timeframe, active: timeframe == viewModel.selectedTimeframe)
                        }.buttonStyle(.plain)
                    }
                }

                HQV5NeonCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("過去の同一指標との比較").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                        HStack {
                            Text("\(viewModel.indicatorName) (\(response.indicator.code))").font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
                            Spacer()
                            HQV5Pill(text: "直近\(response.events.count)回", active: false)
                        }
                        Text(viewModel.fxPairSymbol).font(.system(size: 9)).foregroundStyle(HQV5.muted)

                        if !response.events.isEmpty {
                            Chart(response.events) { event in
                                BarMark(
                                    x: .value("発表日", ValueFormat.dateTime(event.releaseDatetime)),
                                    y: .value("結果", event.actual ?? 0)
                                ).foregroundStyle(HQV5.cyan.gradient)
                            }
                            .chartXAxis(.hidden)
                            .chartYAxis {
                                AxisMarks { _ in
                                    AxisGridLine().foregroundStyle(Color.white.opacity(0.08))
                                    AxisValueLabel().foregroundStyle(HQV5.muted)
                                }
                            }
                            .frame(height: 120)
                        }

                        Text("過去の発表一覧").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                        VStack(spacing: 0) {
                            ForEach(response.events) { event in
                                NavigationLink(value: AppRoute.historicalEventDetail(id: event.id)) {
                                    historyRow(event)
                                }.buttonStyle(.plain).accessibilityIdentifier("historyEventRow")
                            }
                        }
                    }
                }

                statsSection(response)
                advancedStatisticsSection(response.advancedStatistics)
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private func historyRow(_ event: ComparisonEventSummary) -> some View {
        HStack {
            Text(ValueFormat.dateTime(event.releaseDatetime)).font(.system(size: 8)).foregroundStyle(HQV5.muted)
            Spacer()
            Text("結果 \(ValueFormat.number(event.actual))").font(.system(size: 8)).foregroundStyle(.white)
            Text("予想 \(ValueFormat.number(event.forecast))").font(.system(size: 8)).foregroundStyle(.white)
            Text(event.surprise.map { ValueFormat.number($0, signed: true) } ?? "--")
                .font(.system(size: 8, weight: .semibold))
                .foregroundStyle((event.surprise ?? 0) >= 0 ? HQV5.green : HQV5.red)
        }.padding(.vertical, 5).contentShape(Rectangle())
    }

    private func statsSection(_ response: ComparisonResponse) -> some View {
        HQV5NeonCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("分析可能 \(response.analyzableEvents) / 全 \(response.totalEvents) 件").font(.system(size: 9)).foregroundStyle(HQV5.muted)
                HStack {
                    HQV5MetricRow(title: "平均変動幅", value: ValueFormat.number(response.stats.averageMovement, fractionDigits: 3, signed: true), tint: HQV5.cyan)
                    HQV5MetricRow(title: "平均Pips", value: ValueFormat.pips(response.stats.averagePips), tint: HQV5.purple)
                }
                HStack {
                    HQV5MetricRow(title: "最大変動", value: ValueFormat.number(response.stats.maxMovement, fractionDigits: 3, signed: true), tint: .white)
                    HQV5MetricRow(title: "最小変動", value: ValueFormat.number(response.stats.minMovement, fractionDigits: 3, signed: true), tint: .white)
                }
                HStack(spacing: 18) {
                    countColumn(title: "上昇", value: response.stats.upwardCount, color: HQV5.green)
                    countColumn(title: "下落", value: response.stats.downwardCount, color: HQV5.red)
                    countColumn(title: "変化なし", value: response.stats.noChangeCount, color: HQV5.muted)
                }
            }
        }
    }

    @ViewBuilder
    private func advancedStatisticsSection(_ advanced: AdvancedStatistics) -> some View {
        HQV5NeonCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("詳細統計 (Advanced Statistics)").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                if advanced.available, let data = advanced.data {
                    HStack {
                        HQV5MetricRow(title: "平均絶対変動幅", value: ValueFormat.number(data.averageAbsoluteMovement, fractionDigits: 3), tint: .white)
                        HQV5MetricRow(title: "平均絶対Pips", value: ValueFormat.pips(data.averageAbsolutePips, signed: false), tint: .white)
                    }
                } else {
                    Text("この統計はPro会員限定です。").font(.system(size: 10)).foregroundStyle(HQV5.muted)
                }
            }
        }
    }

    private func countColumn(title: String, value: Int, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 9)).foregroundStyle(HQV5.muted)
            Text("\(value)").font(.system(size: 15, weight: .bold)).foregroundStyle(color)
        }
    }
}
