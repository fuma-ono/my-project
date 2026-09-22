import SwiftUI

/// SCR-004 Event Detail (ui-screens.md §5, H-1) — "予想と結果、その結果に
/// よる相場の反応を一画面で理解する".
///
/// HQ UI Master v5 integration (2026-09-22): reproduces
/// `Assets/Reference/SCR-004.png` — header card (flag/name/currency/
/// importance), a "発表日時" + 予想/結果/前回 + サプライズ card, "市場への
/// 影響 (想定)" pair rows with a blue "関連する通貨ペアを見る" CTA (wired to
/// Movement Detail for the primary pair, since the button has no other
/// real destination), then "詳細情報". The existing "過去イベントと比較"
/// CTA (not visible in the reference's single screenshot, presumably below
/// the fold) is kept further down so existing functionality isn't dropped.
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
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {} label: { Image(systemName: "star").foregroundStyle(FXColor.amber) }
            }
        }
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
                VStack(alignment: .leading, spacing: 20) {
                    header(response.event)
                    snapshotCard(response)
                    reactionSection(response)
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
        HStack(alignment: .top, spacing: 14) {
            Text(CountryFlag.emoji(for: event.countryCode)).font(.system(size: 40))
            VStack(alignment: .leading, spacing: 4) {
                Text("\(CountryFlag.kanjiAbbreviation(for: event.countryCode))) \(event.indicatorName)")
                    .font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(.white)
                Text(event.currencyCode).font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            }
            Spacer()
            FXBadge(text: event.importance.rawValue.capitalized, tint: importanceTint(event.importance))
        }.fxCard()
    }

    private func importanceTint(_ importance: Importance) -> Color {
        switch importance {
        case .high: return FXColor.red
        case .medium: return FXColor.green
        case .low: return FXColor.blue
        }
    }

    private func snapshotCard(_ response: EventDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("発表日時").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
                Spacer()
                Text(ValueFormat.dateTime(response.event.releaseDatetime)).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
            }
            switch response.event.dataStatus {
            case .dataPending, .dataUnavailable:
                Text(response.event.dataStatus.label).font(.system(size: 14)).foregroundStyle(FXColor.secondaryText)
            default:
                HStack {
                    metric(title: "予想", value: ValueFormat.number(response.snapshot?.forecast))
                    metric(title: "結果", value: response.event.status == .released ? ValueFormat.number(response.snapshot?.actual) : "-")
                    metric(title: "前回", value: ValueFormat.number(response.snapshot?.previous))
                }
            }
            if response.event.status == .released, response.event.dataStatus == .ready {
                Divider().background(FXColor.border)
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("サプライズ").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                        Text("(予想比)").font(.system(size: 11)).foregroundStyle(FXColor.secondaryText)
                    }
                    Spacer()
                    if let surprise = response.analysis.surprise {
                        Text(ValueFormat.percent(surprise, signed: true)).font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(FXColor.red)
                        Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(FXColor.tertiaryText)
                    } else {
                        Text("分析対象外").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
                    }
                }
            }
        }.fxCard()
    }

    private func metric(title: String, value: String) -> some View {
        VStack(spacing: 4) {
            Text(title).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            Text(value).font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(.white)
        }.frame(maxWidth: .infinity)
    }

    private func reactionSection(_ response: EventDetailResponse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("市場への影響 (想定)").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
            if response.relatedFxPairs.isEmpty {
                Text("関連する通貨ペアはありません。").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText).fxCard()
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(response.relatedFxPairs.enumerated()), id: \.element.id) { index, pair in
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
                        if index != response.relatedFxPairs.count - 1 {
                            Divider().background(FXColor.border)
                        }
                    }
                }.fxCard()

                if let primaryPair = response.relatedFxPairs.first {
                    NavigationLink(value: AppRoute.movementDetail(
                        eventId: response.event.id,
                        indicatorId: response.event.indicatorId,
                        fxPairId: primaryPair.fxPairId,
                        symbol: primaryPair.symbol,
                        indicatorName: response.event.indicatorName,
                        releaseDatetime: response.event.releaseDatetime
                    )) {
                        Text("関連する通貨ペアを見る").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).frame(height: 50)
                            .background(FXGradient.brand).clipShape(RoundedRectangle(cornerRadius: 14))
                    }.buttonStyle(.plain)
                }
            }
        }
    }

    private func reactionRow(_ pair: EventRelatedFxPair) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "mappin.circle").foregroundStyle(FXColor.secondaryText)
            Text(pair.symbol).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
            Spacer()
            switch pair.reaction.analysisStatus {
            case .ready:
                Text(ValueFormat.percent(pair.reaction.changePercent, signed: true))
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle((pair.reaction.changePercent ?? 0) >= 0 ? FXColor.green : FXColor.red)
            default:
                Text(pair.reaction.analysisStatus.label).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            }
        }.padding(14).contentShape(Rectangle())
    }

    private func explanationSection(_ explanation: EventExplanationDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("詳細情報").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
            if let summary = explanation.summary {
                Text(summary).font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            } else {
                Text("公式発表の内容はデータソース連携後に表示されます。推測による説明は表示しません。").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            }
            if let source = explanation.source, let urlString = explanation.sourceUrl, let url = URL(string: urlString) {
                Link("出典: \(source)", destination: url).font(.system(size: 12)).foregroundStyle(FXColor.cyan)
            }
        }.fxCard()
    }
}
