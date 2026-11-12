import SwiftUI

/// SCR-013 要人発言詳細。SCR-007 イベント詳細(`EventDetailView`)と同じ
/// 外枠・状態分岐(読み込み中/Backend未設定/見つからない/未加入/エラー)
/// にする(HQ指示: 「イベント詳細画面とデザインは統一して」)。本体は
/// `SpeechDetailCards`(カード構成の違いはそちらのドキュメント参照)。
struct SpeechDetailView: View {
    @StateObject private var viewModel: SpeechDetailViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    private let apiClient: APIClient
    @State private var planPrompt: String?

    init(apiClient: APIClient, speechId: String, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: SpeechDetailViewModel(apiClient: apiClient, speechId: speechId))
        _tabSelection = tabSelection
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
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "要人発言情報はまだ利用できません。") }
        case .notFound:
            loadingScaffold { FXEmptyState(icon: "questionmark.circle", title: "発言が見つかりません", message: "指定された要人発言は存在しません。") }
        case .notEntitled:
            loadingScaffold { FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランではこの要人発言情報を閲覧できません。") }
        case .loaded(let response):
            V5Viewport {
                V5Header(title: "要人発言詳細", back: true, onBack: { dismiss() })

                ScrollView(showsIndicators: false) {
                    SpeechDetailCards(response: response)
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

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: @escaping () -> some View) -> some View {
        V5Viewport {
            V5Header(title: "要人発言詳細", back: true, onBack: { dismiss() })
            content()
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            V5BottomBar(selected: $tabSelection)
        }
    }
}
