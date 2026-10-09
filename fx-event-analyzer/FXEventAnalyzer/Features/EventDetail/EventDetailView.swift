import SwiftUI

/// SCR-007 イベント詳細 — "予想と結果、その結果に
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
    @ObservedObject private var favorites = FavoritesStore.shared
    private let eventId: String

    private let apiClient: APIClient
    @ObservedObject private var plan = PlanStore.shared
    @State private var planPrompt: String?

    init(apiClient: APIClient, eventId: String, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: EventDetailViewModel(apiClient: apiClient, eventId: eventId))
        _tabSelection = tabSelection
        self.eventId = eventId
    }

    var body: some View {
        content
            .toolbar(.hidden, for: .navigationBar)
            .task { viewModel.load() }
            .planLimitPrompt($planPrompt, apiClient: apiClient, tabSelection: $tabSelection)
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
                V5Header(
                    title: "イベント詳細", back: true,
                    isFavorite: favorites.isFavorite(.event, id: eventId),
                    onBack: { dismiss() },
                    onToggleFavorite: {
                        // 無料プランはお気に入り件まで(HQ指示 2026-10-08)。
                        guard favorites.canToggle(.event, id: eventId, max: plan.limits.favoritesMax) else {
                            planPrompt = "無料プランのお気に入りは\(plan.limits.favoritesMax ?? 0)件までです。プレミアムプランなら件数の制限なく登録できます。"
                            return
                        }
                        favorites.toggle(.event, id: eventId)
                    }
                )

                // HQ指示(2026-10-09)の参考画像で作り直した本体(EventDetailCards)。
                ScrollView(showsIndicators: false) {
                    EventDetailCards(response: response)
                        .padding(.vertical, 6)
                        .frame(width: V5P.W)
                }
                .frame(width: V5P.W, height: 398)
                .position(x: V5P.W / 2, y: 54 + 398 / 2)

                V5BottomBar(selected: $tabSelection)
            }
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    /// HQ指示(2026-10-05、22回目)「背景画像とヘッダーとタブを全画面に反映して」:
    /// 読み込み中・エラー・未設定状態が単色背景のみで`V5Viewport`(背景画像)・
    /// ヘッダー・タブバーを経由していなかったため、`.loaded`状態と同じ外枠に揃えた。
    @ViewBuilder private func loadingScaffold(@ViewBuilder content: @escaping () -> some View) -> some View {
        V5Viewport {
            V5Header(title: "イベント詳細", back: true, onBack: { dismiss() })
            content()
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            V5BottomBar(selected: $tabSelection)
        }
    }


}
