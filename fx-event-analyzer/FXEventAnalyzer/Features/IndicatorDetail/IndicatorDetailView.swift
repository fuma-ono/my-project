import SwiftUI

/// SCR-003 Indicator Detail (ui-screens.md §5) — "指標そのものを理解する"。
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5IndicatorDetailView` (`HQV5TopBar` with
/// favorite star, `HQV5NeonCard` header, "次回発表予定"/メトリクス/
/// サプライズ card, "この指標の影響", "関連通貨ペア", "出典",
/// `HQV5BottomBar`), reproduced as given. Adaptations, all wiring, not
/// redesign:
/// - HQ's hardcoded 米CPI header/next-release/description/pairs/source →
///   the real `IndicatorDetailViewModel` state
///   (`indicator`/`nextScheduledEvent`/`relatedFxPairs`), each section shown
///   only `if let`/`!isEmpty` since a real indicator may lack any of these,
///   never fabricated.
/// - The favorite star stays decorative (no favoriting API exists, same
///   treatment as Home's bell).
/// - "最近の発表結果"/"過去イベントを比較" are not part of HQ's single
///   screenshot for this screen but are existing real functionality
///   (`recentEvents`, the historical-comparison route) — kept, styled to
///   match HQV5's card language, so nothing already shipped is silently
///   dropped.
/// - `tabSelection`: a real `Binding<Int>` threaded from `MainTabView`, so
///   this pushed screen's own `HQV5BottomBar` (HQ's screens render one on
///   every screen, not just tab roots) switches tabs for real.
struct IndicatorDetailView: View {
    @StateObject private var viewModel: IndicatorDetailViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, indicatorId: String, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: IndicatorDetailViewModel(apiClient: apiClient, indicatorId: indicatorId))
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
            FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "指標情報はまだ利用できません。")
        case .loaded(let indicator, let relatedFxPairs, let recentEvents, let nextScheduledEvent):
            HQV5Screen {
                HQV5TopBar(title: "指標詳細", favorite: true, onBack: { dismiss() })

                HQV5NeonCard {
                    HStack {
                        Text(CountryFlag.emoji(for: indicator.countryCode)).font(.title)
                        VStack(alignment: .leading) {
                            Text("\(CountryFlag.kanjiAbbreviation(for: indicator.countryCode))) \(indicator.name)")
                                .font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                            Text(indicator.currencyCode).font(.system(size: 9)).foregroundStyle(HQV5.muted)
                        }
                        Spacer()
                        HQV5Badge(text: "重要度 \(indicator.importance.rawValue.capitalized)", kind: indicator.importance.hqv5Kind)
                    }
                }

                if let nextScheduledEvent {
                    Text("次回発表予定").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                    Text(ValueFormat.dateTime(nextScheduledEvent.releaseDatetime))
                        .font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                    HQV5NeonCard {
                        VStack(spacing: 10) {
                            HStack {
                                HQV5MetricRow(title: "予想", value: ValueFormat.number(nextScheduledEvent.forecast), tint: .white)
                                HQV5MetricRow(title: "結果", value: nextScheduledEvent.actual.map { ValueFormat.number($0) } ?? "—", tint: .white)
                                HQV5MetricRow(title: "前回", value: ValueFormat.number(nextScheduledEvent.previous), tint: .white)
                            }
                            if let surprise = nextScheduledEvent.surprise {
                                Divider().overlay(Color.white.opacity(0.08))
                                HStack {
                                    Text("サプライズ").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                                    Spacer()
                                    Text(ValueFormat.percent(surprise, signed: true))
                                        .foregroundStyle(HQV5.red).font(.system(size: 16, weight: .bold))
                                }
                            }
                        }
                    }
                }

                if let description = indicator.description, !description.isEmpty {
                    Text("この指標の影響").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                    Text(description).font(.system(size: 10)).foregroundStyle(HQV5.muted)
                }

                if !relatedFxPairs.isEmpty {
                    Text("関連通貨ペア").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                    HStack {
                        ForEach(relatedFxPairs) { pair in
                            Text(pair.symbol)
                                .font(.system(size: 9, weight: .semibold)).foregroundStyle(.white)
                                .padding(8).background(HQV5.panel2, in: Capsule())
                        }
                    }
                }

                if let source = indicator.source {
                    Text("出典").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                    if let urlString = indicator.sourceUrl, let url = URL(string: urlString) {
                        Link(source, destination: url).font(.system(size: 10)).foregroundStyle(HQV5.cyan)
                    } else {
                        Text(source).font(.system(size: 10)).foregroundStyle(HQV5.cyan)
                    }
                }

                if !recentEvents.isEmpty {
                    Text("最近の発表結果").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                    ForEach(recentEvents) { event in
                        NavigationLink(value: AppRoute.historicalEventDetail(id: event.id)) {
                            recentEventRow(event)
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
                        HQV5NeonCard {
                            HStack {
                                Image(systemName: "chart.bar.xaxis").foregroundStyle(HQV5.cyan)
                                Text("過去イベントを比較").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
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

    @ViewBuilder private func recentEventRow(_ event: IndicatorEventSummary) -> some View {
        HQV5NeonCard {
            HStack {
                Text(ValueFormat.dateTime(event.releaseDatetime)).font(.system(size: 9)).foregroundStyle(HQV5.muted)
                Spacer()
                if event.dataStatus != .ready {
                    Text(event.dataStatus.label).font(.system(size: 9)).foregroundStyle(HQV5.muted)
                } else if let surprise = event.surprise {
                    Text("Surprise \(ValueFormat.number(surprise, signed: true))").font(.system(size: 9, weight: .semibold)).foregroundStyle(.white)
                } else {
                    Text("Surprise分析対象外").font(.system(size: 9)).foregroundStyle(HQV5.muted)
                }
                Image(systemName: "chevron.right").font(.system(size: 9)).foregroundStyle(HQV5.muted)
            }
        }
    }
}
