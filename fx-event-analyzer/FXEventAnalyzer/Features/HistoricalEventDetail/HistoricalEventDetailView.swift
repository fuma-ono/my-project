import SwiftUI

/// SCR-007 Historical Event Detail (ui-screens.md §5): 指標/発表日時/
/// Forecast/Actual/Previous/Surprise/発表前後価格/pips/%、+必須の
/// 「指標詳細を見る」→ SCR-003 遷移.
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5HistoricalEventDetailView` (`HQV5TopBar`,
/// `HQV5NeonCard` header, 発表日時 + 結果/予想/前回 + サプライズ card,
/// "発表後の相場反応"), reproduced as given. Adaptations, all wiring, not
/// redesign:
/// - HQ's hardcoded flag/CPI header → the real `HistoricalEventSummary`
///   (`indicatorName`/`importance.starDisplay`). This endpoint carries no
///   country/currency, unlike Indicator/Event Detail, so no flag is shown —
///   omitted rather than invented, same rule as elsewhere in this
///   integration.
/// - HQ's two `HQV5Chart()` price-movement placeholders have no real data
///   source at this endpoint (`HistoricalReaction` is per-timeframe
///   pips/%, not a price series) — omitted rather than shown with
///   fabricated values; the real per-pair, per-timeframe reaction rows
///   (unchanged since the prior HQ Frontend integration) are kept instead.
/// - "乖離理由" (explanation) and the "指標詳細を見る" CTA are not visible
///   in HQ's single screenshot but are existing real functionality — kept,
///   styled to HQV5's card language.
/// - `tabSelection`: a real `Binding<Int>` threaded from `MainTabView`.
struct HistoricalEventDetailView: View {
    @StateObject private var viewModel: HistoricalEventDetailViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, eventId: String, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: HistoricalEventDetailViewModel(apiClient: apiClient, eventId: eventId))
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
            FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "過去のイベント情報はまだ利用できません。")
        case .notFound:
            FXEmptyState(icon: "questionmark.circle", title: "イベントが見つかりません", message: "指定されたイベントは存在しません。")
        case .notEntitled:
            FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは過去のイベント情報を閲覧できません。")
        case .loaded(let response):
            HQV5Screen {
                HQV5TopBar(title: "過去のイベント詳細", onBack: { dismiss() })

                HQV5NeonCard {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(response.event.indicatorName).font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                        Text("重要度 \(response.event.importance.starDisplay)").font(.system(size: 9, weight: .bold)).foregroundStyle(HQV5.red)
                    }
                }

                HStack {
                    Text("発表日時").font(.system(size: 10)).foregroundStyle(HQV5.muted)
                    Spacer()
                    Text(ValueFormat.dateTime(response.event.releaseDatetime)).font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                }

                HQV5NeonCard {
                    if let snapshot = response.snapshot {
                        VStack(spacing: 10) {
                            HStack {
                                HQV5MetricRow(title: "結果", value: ValueFormat.number(snapshot.actual), tint: .white)
                                HQV5MetricRow(title: "予想", value: ValueFormat.number(snapshot.forecast), tint: .white)
                                HQV5MetricRow(title: "前回", value: ValueFormat.number(snapshot.previous), tint: .white)
                            }
                            if let surprise = snapshot.surprise {
                                Divider().overlay(Color.white.opacity(0.08))
                                HStack {
                                    Text("サプライズ").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                                    Spacer()
                                    Text(ValueFormat.number(surprise, signed: true)).font(.system(size: 16, weight: .bold)).foregroundStyle(HQV5.red)
                                }
                            }
                        }
                    } else {
                        Text("データ未取得").font(.system(size: 10)).foregroundStyle(HQV5.muted)
                    }
                }

                if let explanation = response.explanation {
                    explanationSection(explanation)
                }

                Text("発表後の相場反応").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                if response.relatedFxPairs.isEmpty {
                    Text("値動きデータはまだありません。").font(.system(size: 10)).foregroundStyle(HQV5.muted)
                } else {
                    ForEach(response.relatedFxPairs) { pair in
                        NavigationLink(value: AppRoute.movementDetail(
                            eventId: response.event.id,
                            indicatorId: response.indicatorId,
                            fxPairId: pair.fxPairId,
                            symbol: pair.symbol,
                            indicatorName: response.event.indicatorName,
                            releaseDatetime: response.event.releaseDatetime
                        )) {
                            HQV5NeonCard {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(pair.symbol).font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                                    ForEach(pair.reactions) { reaction in
                                        HStack {
                                            Text(reaction.timeframe).font(.system(size: 9)).foregroundStyle(HQV5.muted).frame(width: 32, alignment: .leading)
                                            Spacer()
                                            if reaction.analysisStatus == .ready {
                                                Text("\(ValueFormat.pips(reaction.pips)) (\(ValueFormat.percent(reaction.changePercent, signed: true)))")
                                                    .font(.system(size: 9)).foregroundStyle(.white)
                                            } else {
                                                Text(reaction.analysisStatus.label).font(.system(size: 9)).foregroundStyle(HQV5.muted)
                                            }
                                        }
                                    }
                                }
                            }
                        }.buttonStyle(.plain)
                    }
                }

                NavigationLink(value: AppRoute.indicatorDetail(id: response.indicatorId)) {
                    Text("指標詳細を見る")
                }
                .buttonStyle(HQV5PrimaryButton())
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private func explanationSection(_ explanation: EventExplanationDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("乖離理由").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
            if let summary = explanation.summary {
                Text(summary).font(.system(size: 9)).foregroundStyle(HQV5.muted)
            }
            if let source = explanation.source, let urlString = explanation.sourceUrl, let url = URL(string: urlString) {
                Link("出典: \(source)", destination: url).font(.system(size: 9)).foregroundStyle(HQV5.cyan)
            }
        }
    }
}
