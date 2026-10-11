import SwiftUI

/// SCR-006 指標詳細 — "指標そのものを理解する"。
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
/// - HQ指示(2026-10-02): お気に入り星は`FavoritesStore`(端末ローカル、
///   `UserDefaults`永続化)と連動する実際のトグルになった。バックエンドの
///   お気に入りAPIは引き続き存在しない。
/// - This design has no `ScrollView` (a fixed, non-scrolling 234×491
///   composition) and no "最近の発表結果"/"過去イベントを比較" section at
///   all, unlike the prior (scrolling) HQ UI Master v5 integration — kept
///   out entirely rather than appended past HQ's fixed canvas, per this
///   round's explicit "don't break the coordinate system" instruction.
///   HQ指示(2026-10-03、画面構成全面更新)のSCR-006仕様は「過去/次回の
///   発表日一覧(各行SCR-007イベント詳細へ遷移)」を必須コンテンツとして
///   求めているが、今回は番号・名称・遷移の整理のみがスコープのため、この
///   一覧UI自体の追加は次回(005〜013のUI実装)に持ち越している。
struct IndicatorDetailView: View {
    @StateObject private var viewModel: IndicatorDetailViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var favorites = FavoritesStore.shared
    private let indicatorId: String

    private let apiClient: APIClient
    @ObservedObject private var plan = PlanStore.shared
    @State private var planPrompt: String?

    init(apiClient: APIClient, indicatorId: String, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: IndicatorDetailViewModel(apiClient: apiClient, indicatorId: indicatorId))
        _tabSelection = tabSelection
        self.indicatorId = indicatorId
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
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "指標情報はまだ利用できません。") }
        case .loaded(let indicator, let relatedFxPairs, _, let nextScheduledEvent):
            V5Viewport {
                // HQ指示(2026-10-09)「星マークはヘッダーではなく、指標枠の右上に」。
                V5Header(title: "指標詳細", back: true, onBack: { dismiss() })

                // HQ指示(2026-10-09)の参考画像: 1枚のカードに、名前(日本語・英語)と
                // 国・通貨・重要度、概要、注目される理由、項目の表、過去の発表日を並べる。
                ScrollView(showsIndicators: false) {
                    IndicatorDetailCard(
                        indicator: indicator,
                        nextScheduledEvent: nextScheduledEvent,
                        comparisonPair: relatedFxPairs.first,
                        isFavorite: favorites.isFavorite(.indicator, id: indicatorId),
                        onToggleFavorite: {
                            // 無料プランはお気に入りの件数に上限がある(HQ指示 2026-10-08)。
                            guard favorites.canToggle(.indicator, id: indicatorId, max: plan.limits.favoritesMax) else {
                                planPrompt = "無料プランのお気に入りは\(plan.limits.favoritesMax ?? 0)件までです。プレミアムプランなら件数の制限なく登録できます。"
                                return
                            }
                            favorites.toggle(.indicator, id: indicatorId)
                        }
                    )
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
            V5Header(title: "指標詳細", back: true, onBack: { dismiss() })
            content()
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            V5BottomBar(selected: $tabSelection)
        }
    }

}
