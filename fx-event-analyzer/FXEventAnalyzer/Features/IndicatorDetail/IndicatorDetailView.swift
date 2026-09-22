import SwiftUI

/// SCR-003 Indicator Detail (ui-screens.md §5) — "指標そのものを理解する"。
///
/// HQ UI Master v5 integration (2026-09-22): reproduces
/// `Assets/Reference/SCR-003.png` — flag/name/importance header card, "次回
///発表予定" (next scheduled release) block with 予想/結果/前回/サプライズ,
/// "この指標の影響" description, "関連通貨ペア" chips, "出典". The star icon
/// is decorative (no favoriting API exists, same treatment as Home's bell).
/// "最近の発表結果"/"過去イベントを比較" (not visible in the reference's
/// single screenshot, likely below the fold) are kept further down so that
/// existing functionality isn't dropped.
struct IndicatorDetailView: View {
    @StateObject private var viewModel: IndicatorDetailViewModel

    init(apiClient: APIClient, indicatorId: String) {
        _viewModel = StateObject(wrappedValue: IndicatorDetailViewModel(apiClient: apiClient, indicatorId: indicatorId))
    }

    var body: some View {
        ZStack {
            FXAppBackground()
            content
        }
        .navigationTitle("指標詳細")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {} label: {
                    Image(systemName: "star").foregroundStyle(FXColor.amber)
                }
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
            FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "指標情報はまだ利用できません。")
        case .loaded(let indicator, let relatedFxPairs, let recentEvents, let nextScheduledEvent):
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header(indicator)
                    if let nextScheduledEvent {
                        nextReleaseCard(nextScheduledEvent)
                    }
                    if let description = indicator.description, !description.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("この指標の影響").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
                            Text(description).font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
                        }.fxCard()
                    }
                    if !relatedFxPairs.isEmpty {
                        relatedFxPairsSection(relatedFxPairs)
                    }
                    if let source = indicator.source {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("出典").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
                            if let urlString = indicator.sourceUrl, let url = URL(string: urlString) {
                                Link(source, destination: url).font(.system(size: 13)).foregroundStyle(FXColor.cyan)
                            } else {
                                Text(source).font(.system(size: 13)).foregroundStyle(FXColor.cyan)
                            }
                        }
                    }
                    if !recentEvents.isEmpty {
                        recentEventsSection(recentEvents)
                    }
                    if let primaryPair = relatedFxPairs.first {
                        NavigationLink(value: AppRoute.historicalComparison(
                            indicatorId: indicator.id,
                            indicatorName: indicator.name,
                            fxPairId: primaryPair.fxPairId,
                            fxPairSymbol: primaryPair.symbol
                        )) {
                            FXActionRow(icon: "chart.bar.xaxis", title: "過去イベントを比較", subtitle: "予想・結果・FX反応を時系列で確認", action: {})
                                .allowsHitTesting(false)
                                .contentShape(Rectangle())
                        }
                    }
                }.padding(20).frame(maxWidth: 900)
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private func header(_ indicator: IndicatorSummary) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text(CountryFlag.emoji(for: indicator.countryCode)).font(.system(size: 40))
            VStack(alignment: .leading, spacing: 4) {
                Text("\(CountryFlag.kanjiAbbreviation(for: indicator.countryCode))) \(indicator.name) (\(indicator.code))")
                    .font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(.white)
                Text(indicator.currencyCode).font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
            }
            Spacer()
            FXBadge(text: "重要度 \(indicator.importance.rawValue.capitalized)", tint: importanceTint(indicator.importance))
        }.fxCard()
    }

    private func nextReleaseCard(_ event: IndicatorEventSummary) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("次回発表予定").font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
                Text(ValueFormat.dateTime(event.releaseDatetime)).font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(.white)
            }
            HStack {
                metric(title: "予想", value: ValueFormat.number(event.forecast))
                metric(title: "結果", value: event.actual.map { ValueFormat.number($0) } ?? "-")
                metric(title: "前回", value: ValueFormat.number(event.previous))
            }
            if let surprise = event.surprise {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("サプライズ").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                        Text("(予想比)").font(.system(size: 11)).foregroundStyle(FXColor.secondaryText)
                    }
                    Spacer()
                    Text(ValueFormat.percent(surprise, signed: true)).font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(FXColor.red)
                    Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(FXColor.tertiaryText)
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

    private func importanceTint(_ importance: Importance) -> Color {
        switch importance {
        case .high: return FXColor.red
        case .medium: return FXColor.green
        case .low: return FXColor.blue
        }
    }

    private func relatedFxPairsSection(_ pairs: [RelatedFxPairSummary]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("関連通貨ペア").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
            HStack {
                ForEach(pairs) { pair in
                    Text(pair.symbol)
                        .font(.system(size: 13, weight: .semibold))
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(FXColor.card)
                        .foregroundStyle(.white)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(FXColor.border))
                }
            }
        }
    }

    private func recentEventsSection(_ events: [IndicatorEventSummary]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("最近の発表結果").font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
            ForEach(events) { event in
                NavigationLink(value: AppRoute.historicalEventDetail(id: event.id)) {
                    RecentEventRow(event: event)
                }.buttonStyle(.plain)
            }
        }
    }
}

private struct RecentEventRow: View {
    let event: IndicatorEventSummary
    var body: some View {
        HStack {
            Text(ValueFormat.dateTime(event.releaseDatetime)).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            Spacer()
            if event.dataStatus != .ready {
                Text(event.dataStatus.label).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            } else if let surprise = event.surprise {
                Text("Surprise \(ValueFormat.number(surprise, signed: true))").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
            } else {
                Text("Surprise分析対象外").font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            }
            Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(FXColor.tertiaryText)
        }.padding(15).background(FXColor.card).clipShape(RoundedRectangle(cornerRadius: 15)).overlay(RoundedRectangle(cornerRadius: 15).stroke(FXColor.border))
    }
}
