import SwiftUI

/// SCR-004 Event Detail (ui-screens.md §5, H-1) — "予想と結果、その結果に
/// よる相場の反応を一画面で理解する".
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5EventDetail` (fixed 234×491 canvas, header
/// card, 発表日時 + metrics + サプライズ card, 市場への影響 rows, CTA
/// button, 詳細情報), reproduced as given. Adaptations, all wiring, not
/// redesign:
/// - HQ's hardcoded CPI header/metrics/reaction rows/explanation → the
///   real `EventDetailViewModel` state, each section shown only `if let`/
///   `!isEmpty`.
/// - HQ's 3 hardcoded 市場への影響 rows → a real `ForEach` over
///   `relatedFxPairs`, `.prefix(3)`-ed to the 3 fixed slots HQ's
///   coordinates provision (y = 266 + i×23); each row and the CTA button
///   push to the real Movement Detail route (unchanged since before this
///   integration).
/// - This design has no `ScrollView` and no "過去イベントと比較" CTA at
///   all, unlike the prior (scrolling) HQ UI Master v5 integration — kept
///   out rather than appended past HQ's fixed canvas, per this round's
///   "don't break the coordinate system" instruction.
struct EventDetailView: View {
    @StateObject private var viewModel: EventDetailViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, eventId: String, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: EventDetailViewModel(apiClient: apiClient, eventId: eventId))
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
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "イベント情報はまだ利用できません。") }
        case .notFound:
            loadingScaffold { FXEmptyState(icon: "questionmark.circle", title: "イベントが見つかりません", message: "指定されたイベントは存在しません。") }
        case .notEntitled:
            loadingScaffold { FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランではこのイベント情報を閲覧できません。") }
        case .loaded(let response):
            V5Viewport {
                V5TopStatus()
                V5Header(title: "イベント詳細", back: true, star: true, onBack: { dismiss() })

                V5Card(CGRect(x: 10, y: 57, width: 214, height: 55)) {
                    HStack {
                        Text(CountryFlag.emoji(for: response.event.countryCode)).font(.system(size: 22))
                        VStack(alignment: .leading) {
                            Text("\(CountryFlag.kanjiAbbreviation(for: response.event.countryCode))) \(response.event.indicatorName)").font(.system(size: 9, weight: .bold))
                            Text(response.event.currencyCode).font(.system(size: 7)).foregroundStyle(V5P.muted)
                        }
                        Spacer()
                        V5Badge(text: response.event.importance.rawValue.capitalized, color: response.event.importance.v5Color)
                    }.foregroundStyle(.white)
                }

                HStack {
                    Text("発表日時").font(.system(size: 7)).foregroundStyle(.white)
                    Spacer()
                    Text(ValueFormat.dateTime(response.event.releaseDatetime)).font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
                }.frame(width: 204).position(x: 117, y: 126)

                V5Card(CGRect(x: 10, y: 136, width: 214, height: 95)) {
                    switch response.event.dataStatus {
                    case .dataPending, .dataUnavailable:
                        Text(response.event.dataStatus.label).font(.system(size: 9)).foregroundStyle(V5P.muted)
                    default:
                        VStack(spacing: 6) {
                            HStack {
                                metric("予想", ValueFormat.number(response.snapshot?.forecast))
                                metric("結果", response.event.status == .released ? ValueFormat.number(response.snapshot?.actual) : "-")
                                metric("前回", ValueFormat.number(response.snapshot?.previous))
                            }
                            if response.event.status == .released, response.event.dataStatus == .ready {
                                Divider().overlay(V5P.line)
                                HStack {
                                    Text("サプライズ\n(予想比)").font(.system(size: 8)).foregroundStyle(.white)
                                    Spacer()
                                    if let surprise = response.analysis.surprise {
                                        Text(ValueFormat.percent(surprise, signed: true)).font(.system(size: 13, weight: .bold)).foregroundStyle(V5P.red)
                                        Text("›").foregroundStyle(V5P.red)
                                    } else {
                                        Text("分析対象外").font(.system(size: 8)).foregroundStyle(V5P.muted)
                                    }
                                }
                            }
                        }
                    }
                }

                if !response.relatedFxPairs.isEmpty {
                    Text("市場への影響（想定）").font(.system(size: 9, weight: .bold)).foregroundStyle(.white).position(x: 53, y: 244)
                    ForEach(Array(response.relatedFxPairs.prefix(3).enumerated()), id: \.element.id) { i, pair in
                        NavigationLink(value: AppRoute.movementDetail(
                            eventId: response.event.id,
                            indicatorId: response.event.indicatorId,
                            fxPairId: pair.fxPairId,
                            symbol: pair.symbol,
                            indicatorName: response.event.indicatorName,
                            releaseDatetime: response.event.releaseDatetime
                        )) {
                            HStack {
                                Image(systemName: "bubble.left").font(.system(size: 8))
                                Text(pair.symbol).font(.system(size: 8))
                                Spacer()
                                reactionValue(pair)
                            }
                            .foregroundStyle(.white)
                            .frame(width: 204, height: 22).padding(.horizontal, 7)
                            .background(V5P.panel, in: RoundedRectangle(cornerRadius: 5))
                        }
                        .buttonStyle(.plain)
                        .position(x: 117, y: 266 + CGFloat(i) * 23)
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
                            V5Button(title: "関連する通貨ペアを見る")
                        }
                        .buttonStyle(.plain)
                        .frame(width: 204).position(x: 117, y: 337)
                    }
                }

                if let explanation = response.explanation {
                    Text("詳細情報").font(.system(size: 9, weight: .bold)).foregroundStyle(.white).position(x: 32, y: 360)
                    Text(explanation.summary ?? "公式発表の内容はデータソース連携後に表示されます。推測による説明は表示しません。")
                        .font(.system(size: 7)).foregroundStyle(V5P.muted).frame(width: 204, alignment: .leading).position(x: 117, y: 386)
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

    @ViewBuilder private func reactionValue(_ pair: EventRelatedFxPair) -> some View {
        switch pair.reaction.analysisStatus {
        case .ready:
            Text(ValueFormat.percent(pair.reaction.changePercent, signed: true))
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle((pair.reaction.changePercent ?? 0) >= 0 ? V5P.green : V5P.red)
        default:
            Text(pair.reaction.analysisStatus.label).font(.system(size: 7)).foregroundStyle(V5P.muted)
        }
    }
}
