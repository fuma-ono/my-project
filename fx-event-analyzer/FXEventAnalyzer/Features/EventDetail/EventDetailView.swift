import SwiftUI

/// SCR-004 Event Detail (ui-screens.md §5, H-1) — "予想と結果、その結果に
/// よる相場の反応を一画面で理解する".
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5EventDetailView` (`HQV5TopBar` with
/// favorite star, `HQV5NeonCard` header, "発表日時" + メトリクス +
/// サプライズ card, "市場への影響 (想定)" reaction rows, "関連する通貨ペアを
/// 見る" CTA, "詳細情報"), reproduced as given. Adaptations, all wiring, not
/// redesign:
/// - HQ's hardcoded CPI header/metrics/reaction rows/explanation → the real
///   `EventDetailViewModel` state (`event`/`snapshot`/`analysis`/
///   `relatedFxPairs`/`explanation`), each section shown only `if let`/
///   `!isEmpty` per the existing real-data rules (未発表/分析対象外 labels
///   kept, not fabricated).
/// - The favorite star stays decorative (no favoriting API exists).
/// - HQ's reaction rows have no tap target; the existing real destination
///   (Movement Detail) is kept, same as before this integration.
/// - "過去イベントと比較" (not visible in HQ's single screenshot for this
///   screen) is kept further down so existing functionality isn't dropped.
/// - `tabSelection`: a real `Binding<Int>` threaded from `MainTabView`, so
///   this pushed screen's own `HQV5BottomBar` switches tabs for real.
struct EventDetailView: View {
    @StateObject private var viewModel: EventDetailViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, eventId: String, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: EventDetailViewModel(apiClient: apiClient, eventId: eventId))
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
            FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "イベント情報はまだ利用できません。")
        case .notFound:
            FXEmptyState(icon: "questionmark.circle", title: "イベントが見つかりません", message: "指定されたイベントは存在しません。")
        case .notEntitled:
            FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランではこのイベント情報を閲覧できません。")
        case .loaded(let response):
            HQV5Screen {
                HQV5TopBar(title: "イベント詳細", favorite: true, onBack: { dismiss() })

                HQV5NeonCard {
                    HStack {
                        Text(CountryFlag.emoji(for: response.event.countryCode)).font(.title)
                        VStack(alignment: .leading) {
                            Text("\(CountryFlag.kanjiAbbreviation(for: response.event.countryCode))) \(response.event.indicatorName)")
                                .font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                            Text(response.event.currencyCode).font(.system(size: 9)).foregroundStyle(HQV5.muted)
                        }
                        Spacer()
                        HQV5Badge(text: response.event.importance.rawValue.capitalized, kind: response.event.importance.hqv5Kind)
                    }
                }

                Text("発表日時").font(.system(size: 10)).foregroundStyle(HQV5.muted)
                Text(ValueFormat.dateTime(response.event.releaseDatetime)).font(.system(size: 12, weight: .bold)).foregroundStyle(.white)

                HQV5NeonCard {
                    VStack(spacing: 10) {
                        switch response.event.dataStatus {
                        case .dataPending, .dataUnavailable:
                            Text(response.event.dataStatus.label).font(.system(size: 12)).foregroundStyle(HQV5.muted)
                        default:
                            HStack {
                                HQV5MetricRow(title: "予想", value: ValueFormat.number(response.snapshot?.forecast), tint: .white)
                                HQV5MetricRow(title: "結果", value: response.event.status == .released ? ValueFormat.number(response.snapshot?.actual) : "-", tint: .white)
                                HQV5MetricRow(title: "前回", value: ValueFormat.number(response.snapshot?.previous), tint: .white)
                            }
                        }
                        if response.event.status == .released, response.event.dataStatus == .ready {
                            Divider().overlay(Color.white.opacity(0.08))
                            HStack {
                                Text("サプライズ\n(予想比)").font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
                                Spacer()
                                if let surprise = response.analysis.surprise {
                                    Text(ValueFormat.percent(surprise, signed: true)).font(.system(size: 17, weight: .bold)).foregroundStyle(HQV5.red)
                                } else {
                                    Text("分析対象外").font(.system(size: 11)).foregroundStyle(HQV5.muted)
                                }
                            }
                        }
                    }
                }

                Text("市場への影響 (想定)").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                if response.relatedFxPairs.isEmpty {
                    Text("関連する通貨ペアはありません。").font(.system(size: 10)).foregroundStyle(HQV5.muted)
                } else {
                    ForEach(response.relatedFxPairs) { pair in
                        NavigationLink(value: AppRoute.movementDetail(
                            eventId: response.event.id,
                            indicatorId: response.event.indicatorId,
                            fxPairId: pair.fxPairId,
                            symbol: pair.symbol,
                            indicatorName: response.event.indicatorName,
                            releaseDatetime: response.event.releaseDatetime
                        )) {
                            reactionRow(pair)
                        }.buttonStyle(.plain)
                    }

                    if let primaryPair = response.relatedFxPairs.first {
                        NavigationLink(value: AppRoute.movementDetail(
                            eventId: response.event.id,
                            indicatorId: response.event.indicatorId,
                            fxPairId: primaryPair.fxPairId,
                            symbol: primaryPair.symbol,
                            indicatorName: response.event.indicatorName,
                            releaseDatetime: response.event.releaseDatetime
                        )) {
                            Text("関連する通貨ペアを見る")
                        }
                        .buttonStyle(HQV5PrimaryButton())
                    }
                }

                if let explanation = response.explanation {
                    explanationSection(explanation)
                }

                if let primaryPair = response.relatedFxPairs.first {
                    NavigationLink(value: AppRoute.historicalComparison(
                        indicatorId: response.event.indicatorId,
                        indicatorName: response.event.indicatorName,
                        fxPairId: primaryPair.fxPairId,
                        fxPairSymbol: primaryPair.symbol
                    )) {
                        HQV5NeonCard {
                            HStack {
                                Image(systemName: "chart.bar.xaxis").foregroundStyle(HQV5.cyan)
                                Text("過去イベントと比較").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(HQV5.muted)
                            }
                        }
                    }.buttonStyle(.plain)
                }
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    @ViewBuilder private func reactionRow(_ pair: EventRelatedFxPair) -> some View {
        HQV5NeonCard {
            HStack {
                Image(systemName: "arrow.down.right").foregroundStyle(HQV5.muted)
                Text(pair.symbol).font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
                Spacer()
                switch pair.reaction.analysisStatus {
                case .ready:
                    Text(ValueFormat.percent(pair.reaction.changePercent, signed: true))
                        .foregroundStyle((pair.reaction.changePercent ?? 0) >= 0 ? HQV5.green : HQV5.red)
                        .font(.system(size: 10, weight: .bold))
                default:
                    Text(pair.reaction.analysisStatus.label).font(.system(size: 9)).foregroundStyle(HQV5.muted)
                }
            }
        }
    }

    private func explanationSection(_ explanation: EventExplanationDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("詳細情報").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
            if let summary = explanation.summary {
                Text(summary).font(.system(size: 9)).foregroundStyle(HQV5.muted)
            } else {
                Text("公式発表の内容はデータソース連携後に表示されます。推測による説明は表示しません。").font(.system(size: 9)).foregroundStyle(HQV5.muted)
            }
            if let source = explanation.source, let urlString = explanation.sourceUrl, let url = URL(string: urlString) {
                Link("出典: \(source)", destination: url).font(.system(size: 9)).foregroundStyle(HQV5.cyan)
            }
        }
    }
}
