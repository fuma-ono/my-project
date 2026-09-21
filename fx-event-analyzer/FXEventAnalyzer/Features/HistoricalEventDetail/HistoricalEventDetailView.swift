import SwiftUI

/// SCR-007 Historical Event Detail (ui-screens.md §5): 指標/発表日時/
/// Forecast/Actual/Previous/Surprise/発表前後価格/pips/%、+必須の
/// 「指標詳細を見る」→ SCR-003 遷移.
///
/// HQ Frontend integration (2026-09-21): visual content is HQ's
/// `FXEventAnalyzer_HQFrontend/HistoricalEventDetailView.swift`, driven by
/// the real `HistoricalEventDetailResponse` in place of HQ's demo
/// `FXHistoryUI`/`FXRevisionUI`. HQ's "値動き詳細を見る" and "指標詳細を
/// 見る" links pushed to demo `FXDemo.events[0]`/`FXDemo.indicators[0]` —
/// both now push the real `AppRoute.movementDetail`/`AppRoute.indicatorDetail`
/// for this event/indicator, as before integration.
struct HistoricalEventDetailView: View {
    @StateObject private var viewModel: HistoricalEventDetailViewModel

    init(apiClient: APIClient, eventId: String) {
        _viewModel = StateObject(wrappedValue: HistoricalEventDetailViewModel(apiClient: apiClient, eventId: eventId))
    }

    var body: some View {
        ZStack {
            FXAppBackground()
            content
        }
        .navigationTitle("Past Event")
        .navigationBarTitleDisplayMode(.inline)
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            LoadingView(caption: "読み込み中...")
        case .backendNotConfigured:
            FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "過去のイベント情報はまだ利用できません。")
        case .notFound:
            FXEmptyState(icon: "questionmark.circle", title: "イベントが見つかりません", message: "指定されたイベントは存在しません。")
        case .notEntitled:
            FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは過去のイベント情報を閲覧できません。")
        case .loaded(let response):
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack {
                        FXBadge(text: "HISTORICAL", tint: FXColor.secondaryText)
                        Spacer()
                        Text(response.event.releaseDatetime, style: .date).foregroundStyle(FXColor.secondaryText).font(.system(size: 12))
                    }
                    Text("Past Event Detail").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    Text(response.event.indicatorName).font(.system(size: 15, weight: .semibold)).foregroundStyle(FXColor.cyan)

                    snapshotSection(response.snapshot)

                    if let explanation = response.explanation {
                        explanationSection(explanation)
                    }

                    reactionsSection(response.relatedFxPairs, event: response.event, indicatorId: response.indicatorId)

                    NavigationLink(value: AppRoute.indicatorDetail(id: response.indicatorId)) {
                        HStack { Text("指標詳細を見る"); Spacer(); Image(systemName: "arrow.right") }
                            .foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 52)
                            .background(FXGradient.brand).clipShape(RoundedRectangle(cornerRadius: 15))
                    }.buttonStyle(.plain)
                }.padding(20).frame(maxWidth: 900)
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private func snapshotSection(_ snapshot: HistoricalSnapshot?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let snapshot {
                HStack {
                    HeroMetric(label: "予想", value: ValueFormat.number(snapshot.forecast))
                    HeroMetric(label: "結果", value: ValueFormat.number(snapshot.actual))
                    HeroMetric(label: "Surprise", value: ValueFormat.number(snapshot.surprise, signed: true))
                }
            } else {
                Text("データ未取得").font(.system(size: 14)).foregroundStyle(FXColor.secondaryText)
            }
        }.fxCard()
    }

    private func explanationSection(_ explanation: EventExplanationDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            FXSectionHeader(title: "乖離理由")
            if let summary = explanation.summary {
                Text(summary).font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            }
            if let source = explanation.source, let urlString = explanation.sourceUrl, let url = URL(string: urlString) {
                Link(destination: url) {
                    Text("出典: \(source)").font(.system(size: 12)).foregroundStyle(FXColor.cyan)
                }
            }
        }.fxCard()
    }

    private func reactionsSection(_ pairs: [HistoricalRelatedFxPair], event: HistoricalEventSummary, indicatorId: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            FXSectionHeader(title: "FX Reaction")
            if pairs.isEmpty {
                Text("値動きデータはまだありません。").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            } else {
                ForEach(pairs) { pair in
                    NavigationLink(value: AppRoute.movementDetail(
                        eventId: event.id,
                        indicatorId: indicatorId,
                        fxPairId: pair.fxPairId,
                        symbol: pair.symbol,
                        indicatorName: event.indicatorName,
                        releaseDatetime: event.releaseDatetime
                    )) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(pair.symbol).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                            ForEach(pair.reactions) { reaction in
                                HStack {
                                    Text(reaction.timeframe).font(.system(size: 11)).foregroundStyle(FXColor.secondaryText).frame(width: 36, alignment: .leading)
                                    Spacer()
                                    if reaction.analysisStatus == .ready {
                                        Text(ValueFormat.pips(reaction.pips)).font(.system(size: 12)).foregroundStyle(.white)
                                    } else {
                                        Text(reaction.analysisStatus.label).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
                                    }
                                }
                            }
                        }.fxCard()
                    }.buttonStyle(.plain)
                }
            }
        }
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
