import SwiftUI

/// SCR-004 Event Detail (ui-screens.md §5, H-1) — "予想と結果、その結果に
/// よる相場の反応を一画面で理解する". Display order fixed by H-1: 指標名/
/// 国地域/通貨/重要度/発表日時 → Forecast/Actual/Previous → Surprise →
/// 乖離理由 → 市場への影響 → 関連FXペア/Reaction.
///
/// HQ Frontend integration (2026-09-21): card layout/typography/colors are
/// HQ's `FXEventAnalyzer_HQFrontend/EventDetailView.swift`. HQ's version
/// took a single flat `FXEventUI` — the real `GET /events/{id}` response
/// (`EventDetailResponse`) carries more than that shape holds (a separate
/// snapshot/analysis/explanation, and each related FX pair's own Reaction
/// with its own `analysis_status`), so this reads straight from the real
/// response types instead of going through `FXEventUI`, keeping HQ's exact
/// section styling. HQ's bottom "過去イベントと比較" CTA had no indicator/
/// pair context to link with (demo data only) — it now pushes
/// `AppRoute.historicalComparison` for the primary related FX pair, same
/// as before integration.
struct EventDetailView: View {
    @StateObject private var viewModel: EventDetailViewModel

    init(apiClient: APIClient, eventId: String) {
        _viewModel = StateObject(wrappedValue: EventDetailViewModel(apiClient: apiClient, eventId: eventId))
    }

    var body: some View {
        ZStack {
            FXAppBackground()
            content
        }
        .navigationTitle("イベント詳細")
        .navigationBarTitleDisplayMode(.inline)
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
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header(response.event)
                    snapshot(response)
                    if response.event.status == .released, response.event.dataStatus == .ready {
                        surprise(response)
                    }
                    if let explanation = response.explanation {
                        explanationSection(explanation)
                    }
                    reactionSection(response)
                    if let primaryPair = response.relatedFxPairs.first {
                        NavigationLink(value: AppRoute.historicalComparison(
                            indicatorId: response.event.indicatorId,
                            indicatorName: response.event.indicatorName,
                            fxPairId: primaryPair.fxPairId,
                            fxPairSymbol: primaryPair.symbol
                        )) {
                            HStack { Text("過去イベントと比較").font(.system(size: 15, weight: .bold)); Spacer(); Image(systemName: "arrow.right") }
                                .foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 54)
                                .background(FXGradient.pink).clipShape(RoundedRectangle(cornerRadius: 16))
                        }.buttonStyle(.plain)
                    }
                }.padding(20).frame(maxWidth: 950)
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private func header(_ event: EventDetailEvent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                FXBadge(text: event.importance.rawValue, tint: event.importance == .high ? FXColor.pink : FXColor.cyan)
                Spacer()
                Text(event.releaseDatetime, style: .date).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            }
            Text(event.indicatorName).font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)
            Text("\(event.countryCode) · \(event.currencyCode) · \(event.status.rawValue)").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            if event.revisionStatus == .revised {
                FXBadge(text: "改定あり", tint: FXColor.amber)
            }
        }
    }

    private func snapshot(_ response: EventDetailResponse) -> some View {
        Group {
            switch response.event.dataStatus {
            case .dataPending, .dataUnavailable:
                Text(response.event.dataStatus.label).font(.system(size: 14)).foregroundStyle(FXColor.secondaryText)
            default:
                HStack(spacing: 8) {
                    HeroMetric(label: "予想", value: ValueFormat.number(response.snapshot?.forecast))
                    HeroMetric(label: "結果", value: response.event.status == .released ? ValueFormat.number(response.snapshot?.actual) : "--")
                    HeroMetric(label: "前回", value: ValueFormat.number(response.snapshot?.previous))
                }
            }
        }.fxCard()
    }

    private func surprise(_ response: EventDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("SURPRISE").font(.system(size: 11, weight: .bold)).tracking(2).foregroundStyle(FXColor.pink)
            if let surprise = response.analysis.surprise, let direction = response.analysis.surpriseDirection {
                Text(ValueFormat.number(surprise, signed: true)).font(.system(size: 34, weight: .bold, design: .rounded)).foregroundStyle(.white)
                if let label = ValueFormat.surpriseComparisonLabel(surprise) {
                    Text(label).font(.system(size: 13, weight: .semibold)).foregroundStyle(FXColor.secondaryText)
                }
                Text(direction.label).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            } else {
                Text("Forecastが存在しないため、Surprise分析対象外です。").font(.system(size: 14)).foregroundStyle(FXColor.secondaryText)
            }
            Text("Surprise = Actual − Forecast").font(.system(size: 11)).foregroundStyle(FXColor.tertiaryText)
        }.fxCard()
    }

    private func explanationSection(_ explanation: EventExplanationDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            FXSectionHeader(title: "結果の背景", subtitle: "公式ソースに基づく要約")
            if let summary = explanation.summary {
                Text(summary).font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            } else {
                Text("公式発表の内容はデータソース連携後に表示されます。推測による説明は表示しません。").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            }
            if let source = explanation.source, let urlString = explanation.sourceUrl, let url = URL(string: urlString) {
                Link(destination: url) {
                    FXActionRow(icon: "link", title: "公式ソース", subtitle: source, action: {})
                        .allowsHitTesting(false)
                        .contentShape(Rectangle())
                }
            }
        }.fxCard()
    }

    private func reactionSection(_ response: EventDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            FXSectionHeader(title: "市場への影響", subtitle: "関連通貨ペア")
            let event = response.event
            if response.relatedFxPairs.isEmpty {
                Text("関連する通貨ペアはありません。").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            } else {
                ForEach(response.relatedFxPairs) { pair in
                    NavigationLink(value: AppRoute.movementDetail(
                        eventId: event.id,
                        indicatorId: event.indicatorId,
                        fxPairId: pair.fxPairId,
                        symbol: pair.symbol,
                        indicatorName: event.indicatorName,
                        releaseDatetime: event.releaseDatetime
                    )) {
                        reactionRow(pair)
                    }.buttonStyle(.plain)
                }
            }
        }.fxCard()
    }

    private func reactionRow(_ pair: EventRelatedFxPair) -> some View {
        HStack {
            Text(pair.symbol).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
            Spacer()
            switch pair.reaction.analysisStatus {
            case .ready:
                VStack(alignment: .trailing, spacing: 2) {
                    Text(ValueFormat.pips(pair.reaction.pips)).font(.system(size: 13)).foregroundStyle(.white)
                    Text(ValueFormat.percent(pair.reaction.changePercent, signed: true))
                        .font(.system(size: 12)).foregroundStyle((pair.reaction.changePercent ?? 0) >= 0 ? FXColor.green : FXColor.red)
                }
            default:
                Text(pair.reaction.analysisStatus.label).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            }
            Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(FXColor.tertiaryText)
        }.padding(.vertical, 6).contentShape(Rectangle())
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
