import SwiftUI

/// SCR-011 Account, reached from Settings. Before this integration there
/// was no Account screen or route at all.
///
/// HQ Frontend integration (2026-09-21): visual content — page header, info
/// card — is HQ's `FXEventAnalyzer_HQFrontend/AccountView.swift`, driven by
/// the new `AccountViewModel` (`GET /account` + `GET /subscription`, via
/// the existing but previously-unused `AccountService`/`SubscriptionService`)
/// instead of a hardcoded `email = "user@example.com"`. One deliberate
/// deviation from HQ's mockup, not a redesign: `AccountResponse` (the real
/// `GET /account` shape, api-design.md §24) has no email field —
/// `UserSession`/`AuthServicing` don't carry one either, and extending Auth
/// to add one is out of this round's scope (rule: ViewModelは変更しない /
/// 既存の認証処理を維持する) — so the "Email" tile is replaced with the
/// fields the real response actually has (ユーザーID, 登録日) rather than
/// showing a fabricated address.
struct AccountView: View {
    @StateObject private var viewModel: AccountViewModel

    init(apiClient: APIClient) {
        _viewModel = StateObject(wrappedValue: AccountViewModel(apiClient: apiClient))
    }

    var body: some View {
        ZStack {
            FXAppBackground()
            content
        }
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            LoadingView(caption: "読み込み中...")
        case .backendNotConfigured:
            FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "アカウント情報はまだ利用できません。")
        case .loaded(let account, let subscription):
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("ACCOUNT").font(.system(size: 11, weight: .bold)).tracking(2).foregroundStyle(FXColor.cyan)
                        Text("アカウント").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    }.frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 14) {
                        FXMetricTile(label: "ユーザーID", value: account.userID.uuidString)
                        FXMetricTile(label: "登録日", value: ValueFormat.dateTime(account.createdAt))
                        FXMetricTile(label: "プラン", value: subscription.plan, tint: FXColor.cyan)
                    }.fxCard()

                    Text("メールアドレス・パスワード変更はSupabase Auth連携に接続します。").font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
                }.padding(20).frame(maxWidth: 700)
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }
}
