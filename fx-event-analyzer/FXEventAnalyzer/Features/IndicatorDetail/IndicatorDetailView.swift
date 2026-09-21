import SwiftUI

/// SCR-003 Indicator Detail (ui-screens.md §5) — "指標そのものを理解する"。
/// Distinct from SCR-004 Event Detail: no single event's Surprise is the
/// headline here, only the indicator's own metadata and a "最近の発表結果"
/// list that taps through to SCR-007.
///
/// HQ Frontend integration (2026-09-21): header/metadata/related-pair
/// visual is HQ's `FXEventAnalyzer_HQFrontend/IndicatorDetailView.swift`.
/// Two corrections from HQ's mockup, both required to keep real navigation
/// working rather than a redesign: HQ's recent-events list pushed to
/// `EventDetailView` (Event Detail) using demo events — the real recent
/// events here are RELEASED-only summaries meant for SCR-007 Historical
/// Event Detail (`AppRoute.historicalEventDetail`), so that's what each row
/// links to; and HQ's "過去イベントを比較" `FXActionRow` had an empty
/// `action: {}` (no comparison screen existed in its demo) — it now pushes
/// `AppRoute.historicalComparison` for the indicator's primary related FX
/// pair, exactly as this screen already did before integration.
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
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            LoadingView(caption: "読み込み中...")
        case .backendNotConfigured:
            FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "指標情報はまだ利用できません。")
        case .loaded(let indicator, let relatedFxPairs, let recentEvents):
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header(indicator)
                    FXSectionHeader(title: "関連イベント", subtitle: "最新リリース")
                    if recentEvents.isEmpty {
                        Text("発表済みのデータはまだありません。").font(.system(size: 13)).foregroundStyle(FXColor.secondaryText)
                    } else {
                        ForEach(recentEvents) { event in
                            NavigationLink(value: AppRoute.historicalEventDetail(id: event.id)) {
                                RecentEventRow(event: event)
                            }.buttonStyle(.plain)
                        }
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
                        }
                    }
                }.padding(20).frame(maxWidth: 900)
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private func header(_ indicator: IndicatorSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                FXBadge(text: indicator.code, tint: FXColor.cyan)
                FXBadge(text: indicator.importance.rawValue, tint: indicator.importance == .high ? FXColor.pink : FXColor.cyan)
            }
            Text(indicator.name).font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)
            Text("\(indicator.countryCode) · \(indicator.currencyCode)").foregroundStyle(FXColor.secondaryText)
            if let description = indicator.description, !description.isEmpty {
                Text(description).font(.system(size: 14)).foregroundStyle(FXColor.secondaryText).lineSpacing(4)
            }
            metadataRow(title: "発表頻度", value: indicator.frequency)
            if let unit = indicator.unit {
                metadataRow(title: "単位", value: unit)
            }
            if let source = indicator.source {
                metadataRow(title: "出典", value: source)
            }
        }.fxCard()
    }

    private func metadataRow(title: String, value: String) -> some View {
        HStack {
            Text(title).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
            Spacer()
            Text(value).font(.system(size: 12)).foregroundStyle(.white)
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
