import SwiftUI

/// SCR-007 Historical Event Detail (ui-screens.md §5): 指標/発表日時/
/// Forecast/Actual/Previous/Surprise/発表前後価格/pips/%、+必須の
/// 「指標詳細を見る」→ SCR-003 遷移.
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5HistoricalEventDetail` (fixed 234×491
/// canvas, header card, 発表日時 + 結果/予想/前回 card, "発表後の相場反応"
/// row, "発表前後の価格変動（1分足）" + candle chart), reproduced as given.
/// Adaptations, all wiring, not redesign:
/// - `HistoricalEventSummary` carries no country/currency code (this
///   endpoint's own gap, same as before) — no flag is shown, omitted
///   rather than invented.
/// - HQ's fixed "USD/JPY +0.41 (+0.26%)" row shows the real primary
///   related pair's nearest-to-5m reaction (HQ's design provisions exactly
///   one row, no `ScrollView`, so only one pair/timeframe can be shown
///   here; the full per-pair, per-timeframe breakdown remains reachable
///   from Movement Detail).
/// - HQ's "発表前後の価格変動（1分足）" heading + `V5CandleChart()` have no
///   backing data at all — this endpoint returns no price series — so
///   both are omitted rather than shown with fabricated candles, the same
///   call the prior HQ UI Master v5 round made for this exact screen.
/// - ui-screens.md requires a "指標詳細を見る" navigation from this screen;
///   HQ's fixed canvas has no button for it, so (rather than adding new
///   visible UI) the existing header card — already visually a distinct,
///   card-shaped element — becomes the tap target for it, with no pixel
///   changed.
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
        content
            .toolbar(.hidden, for: .navigationBar)
            .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "過去のイベント情報はまだ利用できません。") }
        case .notFound:
            loadingScaffold { FXEmptyState(icon: "questionmark.circle", title: "イベントが見つかりません", message: "指定されたイベントは存在しません。") }
        case .notEntitled:
            loadingScaffold { FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは過去のイベント情報を閲覧できません。") }
        case .loaded(let response):
            V5Viewport {
                V5TopStatus()
                V5Header(title: "過去のイベント詳細", back: true, star: false, onBack: { dismiss() })

                NavigationLink(value: AppRoute.indicatorDetail(id: response.indicatorId)) {
                    V5Card(CGRect(x: 10, y: 57, width: 214, height: 54)) {
                        HStack {
                            Text(response.event.indicatorName).font(.system(size: 8, weight: .bold))
                            Spacer()
                            V5Badge(text: "重要度 \(response.event.importance.rawValue.capitalized)", color: response.event.importance.v5Color)
                        }.foregroundStyle(.white)
                    }
                }.buttonStyle(.plain)

                HStack {
                    Text("発表日時").font(.system(size: 7)).foregroundStyle(.white)
                    Spacer()
                    Text(ValueFormat.dateTime(response.event.releaseDatetime)).font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
                }.frame(width: 204).position(x: 117, y: 126)

                V5Card(CGRect(x: 10, y: 136, width: 214, height: 55)) {
                    if let snapshot = response.snapshot {
                        HStack {
                            metric("結果", ValueFormat.number(snapshot.actual))
                            metric("予想", ValueFormat.number(snapshot.forecast))
                            metric("前回", ValueFormat.number(snapshot.previous))
                        }
                    } else {
                        Text("データ未取得").font(.system(size: 8)).foregroundStyle(V5P.muted)
                    }
                }

                if let primaryPair = response.relatedFxPairs.first {
                    Text("発表後の相場反応").font(.system(size: 9, weight: .bold)).foregroundStyle(.white).position(x: 52, y: 208)
                    HStack {
                        Text(primaryPair.symbol).font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
                        Spacer()
                        reactionValue(primaryPair)
                    }.frame(width: 204).position(x: 117, y: 225)
                }

                V5BottomBar(selected: $tabSelection)
            }
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: () -> some View) -> some View {
        ZStack {
            LinearGradient(colors: [V5P.bg0, V5P.bg1, V5P.bg0], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            content()
        }
    }

    @ViewBuilder private func metric(_ a: String, _ b: String) -> some View {
        VStack(spacing: 2) { Text(a).font(.system(size: 6)).foregroundStyle(V5P.muted); Text(b).font(.system(size: 10, weight: .bold)).foregroundStyle(.white) }.frame(maxWidth: .infinity)
    }

    @ViewBuilder private func reactionValue(_ pair: HistoricalRelatedFxPair) -> some View {
        let reaction = pair.reactions.first(where: { $0.timeframe == "5m" }) ?? pair.reactions.first
        if let reaction, reaction.analysisStatus == .ready {
            Text("\(ValueFormat.pips(reaction.pips)) (\(ValueFormat.percent(reaction.changePercent, signed: true)))")
                .font(.system(size: 7, weight: .bold))
                .foregroundStyle((reaction.changePercent ?? 0) >= 0 ? V5P.green : V5P.red)
        } else {
            Text(reaction?.analysisStatus.label ?? "分析対象外").font(.system(size: 7)).foregroundStyle(V5P.muted)
        }
    }
}
