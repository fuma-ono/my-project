import SwiftUI

/// SCR-003 Indicator Detail (ui-screens.md §5) — "指標そのものを理解する"。
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5IndicatorDetail` (fixed 234×491 canvas,
/// header, header card, 次回発表予定 + metrics + サプライズ card, この指標
/// の影響, 関連通貨ペア, 出典), reproduced as given. Adaptations, all
/// wiring, not redesign:
/// - HQ's hardcoded header/next-release/description/pairs/source → the
///   real `IndicatorDetailViewModel` state, each section shown only
///   `if let`/`!isEmpty`. Every element here is absolute-positioned, so
///   hiding a section never shifts anything else on screen.
/// - HQ's "次回発表予定" always shows a サプライズ value even though a
///   SCHEDULED (not yet released) event cannot have one — the real
///   `surprise` is shown only `if let`, never fabricated for an event that
///   hasn't happened yet.
/// - The favorite star stays decorative (no favoriting API exists).
/// - This design has no `ScrollView` (a fixed, non-scrolling 234×491
///   composition) and no "最近の発表結果"/"過去イベントを比較" section at
///   all, unlike the prior (scrolling) HQ UI Master v5 integration — kept
///   out entirely rather than appended past HQ's fixed canvas, per this
///   round's explicit "don't break the coordinate system" instruction.
struct IndicatorDetailView: View {
    @StateObject private var viewModel: IndicatorDetailViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, indicatorId: String, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: IndicatorDetailViewModel(apiClient: apiClient, indicatorId: indicatorId))
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
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "指標情報はまだ利用できません。") }
        case .loaded(let indicator, let relatedFxPairs, _, let nextScheduledEvent):
            V5Viewport {
                V5TopStatus()
                V5Header(title: "指標詳細", back: true, star: true, onBack: { dismiss() })

                V5Card(CGRect(x: 10, y: 57, width: 214, height: 59)) {
                    HStack(spacing: 5) {
                        Text(CountryFlag.emoji(for: indicator.countryCode)).font(.system(size: 22))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(CountryFlag.kanjiAbbreviation(for: indicator.countryCode))) \(indicator.name)").font(.system(size: 9, weight: .bold))
                            Text(indicator.currencyCode).font(.system(size: 7)).foregroundStyle(V5P.muted)
                        }
                        Spacer()
                        V5Badge(text: "重要度 \(indicator.importance.rawValue.capitalized)", color: indicator.importance.v5Color)
                    }.foregroundStyle(.white)
                }

                if let nextScheduledEvent {
                    Text("次回発表予定").font(.system(size: 7)).foregroundStyle(V5P.muted).position(x: 39, y: 128)
                    Text(ValueFormat.dateTime(nextScheduledEvent.releaseDatetime)).font(.system(size: 9, weight: .bold)).foregroundStyle(.white).position(x: 95, y: 140)
                    V5Card(CGRect(x: 10, y: 151, width: 214, height: 95)) {
                        VStack(spacing: 6) {
                            HStack {
                                metric("予想", ValueFormat.number(nextScheduledEvent.forecast))
                                metric("結果", nextScheduledEvent.actual.map { ValueFormat.number($0) } ?? "-")
                                metric("前回", ValueFormat.number(nextScheduledEvent.previous))
                            }
                            if let surprise = nextScheduledEvent.surprise {
                                Divider().overlay(V5P.line)
                                HStack {
                                    Text("サプライズ\n(予想比)").font(.system(size: 8)).foregroundStyle(.white)
                                    Spacer()
                                    Text(ValueFormat.percent(surprise, signed: true)).font(.system(size: 13, weight: .bold)).foregroundStyle(V5P.red)
                                    Image(systemName: "chevron.right").foregroundStyle(V5P.red)
                                }
                            }
                        }
                    }
                }

                if let description = indicator.description, !description.isEmpty {
                    Text("この指標の影響").font(.system(size: 9, weight: .bold)).foregroundStyle(.white).position(x: 43, y: 260)
                    Text(description)
                        .font(.system(size: 7)).foregroundStyle(V5P.muted).frame(width: 204, alignment: .leading).position(x: 117, y: 281)
                }

                if !relatedFxPairs.isEmpty {
                    Text("関連通貨ペア").font(.system(size: 9, weight: .bold)).foregroundStyle(.white).position(x: 44, y: 307)
                    HStack(spacing: 5) {
                        ForEach(relatedFxPairs) { pair in smallPill(pair.symbol) }
                    }.position(x: 117, y: 326)
                }

                if let source = indicator.source {
                    Text("出典").font(.system(size: 9, weight: .bold)).foregroundStyle(.white).position(x: 25, y: 352)
                    if let urlString = indicator.sourceUrl, let url = URL(string: urlString) {
                        Link(source, destination: url).font(.system(size: 8)).foregroundStyle(V5P.cyan).position(x: 44, y: 366)
                    } else {
                        Text(source).font(.system(size: 8)).foregroundStyle(V5P.cyan).position(x: 44, y: 366)
                    }
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

    @ViewBuilder private func smallPill(_ t: String) -> some View {
        Text(t).font(.system(size: 7, weight: .semibold)).foregroundStyle(.white).padding(.horizontal, 7).padding(.vertical, 5).background(V5P.panel2, in: Capsule())
    }
}
