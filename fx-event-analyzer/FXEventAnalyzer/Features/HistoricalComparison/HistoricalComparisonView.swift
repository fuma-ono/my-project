import SwiftUI

/// SCR-006 Historical Comparison (ui-screens.md §5) — "今回だけでなく、
/// 過去の同一指標発表時に相場がどう動いたか比較する". Statistics are the
/// Backend's Source of Truth; Advanced Statistics follows the existing
/// partial-gating contract (§21.3) rather than a blanket 403.
///
/// HQ Frontend integration (2026-09-21): visual content — stat tiles, event
/// rows — is HQ's `FXEventAnalyzer_HQFrontend/HistoricalComparisonView.swift`.
/// HQ's stats card showed only average movement/pips from its demo data;
/// the real `ComparisonStats`/`AdvancedStatistics` carry more (max/min,
/// up/down/no-change counts, and a separate Pro-gated advanced section),
/// so those are added in HQ's own tile/typography style rather than
/// dropped, and each event row links to the real
/// `AppRoute.historicalEventDetail`.
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
                    header
                    timeframePicker
                    statsSection(response)
                    advancedStatisticsSection(response.advancedStatistics)
                    eventsSection(response.events)
                }.padding(20).frame(maxWidth: 1000)
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("HISTORICAL COMPARISON").font(.system(size: 11, weight: .bold)).tracking(2).foregroundStyle(FXColor.cyan)
            Text(viewModel.indicatorName).font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)
            Text(viewModel.fxPairSymbol).font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
        }
    }

    private var timeframePicker: some View {
        Picker("時間軸", selection: $viewModel.selectedTimeframe) {
            ForEach(ReactionTimeframe.all, id: \.self) { Text($0).tag($0) }
        }.pickerStyle(.segmented)
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

    private func eventsSection(_ events: [ComparisonEventSummary]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            FXSectionHeader(title: "過去のイベント", subtitle: "タップして詳細を見る")
            if events.isEmpty {
                Text("比較対象のイベントはまだありません。").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(events) { event in
                        NavigationLink(value: AppRoute.historicalEventDetail(id: event.id)) {
                            HistoryRow(event: event)
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func countColumn(title: String, value: Int, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            Text("\(value)").font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(color)
        }
    }
}

private struct HistoryRow: View {
    let event: ComparisonEventSummary
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 5) {
                Text(event.releaseDatetime, style: .date).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                Text("予想 \(ValueFormat.number(event.forecast)) → 結果 \(ValueFormat.number(event.actual))").font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                if let surprise = event.surprise {
                    Text("Surprise \(ValueFormat.number(surprise, signed: true))").font(.system(size: 15, weight: .bold)).foregroundStyle(FXColor.cyan)
                } else {
                    Text("--").font(.system(size: 15, weight: .bold)).foregroundStyle(FXColor.secondaryText)
                }
            }
            Image(systemName: "chevron.right").foregroundStyle(FXColor.tertiaryText)
        }.padding(15).background(FXColor.card).clipShape(RoundedRectangle(cornerRadius: 15)).overlay(RoundedRectangle(cornerRadius: 15).stroke(FXColor.border))
    }
}
