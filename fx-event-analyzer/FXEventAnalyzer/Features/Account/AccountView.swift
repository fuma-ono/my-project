import SwiftUI

/// SCR-011 Account, reached from Settings. Before this integration there
/// was no Account screen or route at all.
///
/// HQ Frontend integration (2026-09-21): visual content — page header, info
/// card — is HQ's `FXEventAnalyzer_HQFrontend/AccountView.swift`, driven by
/// the new `AccountViewModel` (`GET /account` + `GET /subscription`, via
/// the existing but previously-unused `AccountService`/`SubscriptionService`)
/// instead of a hardcoded `email = "user@example.com"`.
///
/// HQ UI Master v5 integration (2026-09-22): reproduces
/// `Assets/Reference/SCR-011.png` — back chevron + "アカウント" title,
/// profile icon, a grouped row list (ブラン/通知設定/アカウント情報/
/// サブスクリプション), then a separate ログアウト row. Two deliberate
/// deviations from the reference, not redesigns: (1) the reference shows
/// "user@example.com" under the icon — `AccountResponse` (api-design.md
/// §24) and `UserSession`/`AuthServicing` carry no email field, and adding
/// one is out of this round's scope, so a real, non-fabricated identifier
/// (a shortened `userID`) is shown instead. (2) "通知設定" and
/// "サブスクリプション" have no real settings/management API behind them
/// (only a read-only `GET /subscription`), so they use the same "準備中"
/// alert treatment Login already established for its own non-functional
/// rows, rather than inventing behavior.
struct AccountView: View {
    @StateObject private var viewModel: AccountViewModel
    @State private var pendingFeatureMessage: String?

    init(apiClient: APIClient, authService: AuthServicing? = nil, onSignOut: @escaping () -> Void = {}) {
        _viewModel = StateObject(wrappedValue: AccountViewModel(apiClient: apiClient, authService: authService, onSignOut: onSignOut))
    }

    var body: some View {
        ZStack {
            FXAppBackground()
            content
        }
        .navigationTitle("アカウント")
        .navigationBarTitleDisplayMode(.inline)
        .task { viewModel.load() }
        .alert(
            "準備中の機能です",
            isPresented: Binding(
                get: { pendingFeatureMessage != nil },
                set: { isPresented in if !isPresented { pendingFeatureMessage = nil } }
            ),
            presenting: pendingFeatureMessage
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { message in
            Text(message)
        }
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
                VStack(spacing: 22) {
                    profileHeader(account)
                    infoRows(account, subscription)

                    if case .error(let message) = viewModel.signOutState {
                        Text(message).font(.system(size: 12)).foregroundStyle(FXColor.red).multilineTextAlignment(.leading)
                    }

                    signOutRow
                }.padding(20).frame(maxWidth: 700)
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private func profileHeader(_ account: AccountResponse) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "person.crop.circle.fill")
                .font(.system(size: 72))
                .foregroundStyle(FXColor.secondaryText)
            Text("ユーザー \(account.userID.uuidString.prefix(8))")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
        }
    }

    private func infoRows(_ account: AccountResponse, _ subscription: SubscriptionResponse) -> some View {
        VStack(spacing: 0) {
            row(icon: "person", title: "ブラン", trailingText: subscription.plan)
            Divider().background(FXColor.border)
            row(icon: "bell", title: "通知設定") {
                pendingFeatureMessage = "通知設定は準備中です。もうしばらくお待ちください。"
            }
            Divider().background(FXColor.border)
            row(icon: "person", title: "アカウント情報") {
                pendingFeatureMessage = "登録日: \(ValueFormat.dateTime(account.createdAt))"
            }
            Divider().background(FXColor.border)
            row(icon: "checkmark.seal", title: "サブスクリプション") {
                pendingFeatureMessage = "サブスクリプション管理は準備中です。もうしばらくお待ちください。"
            }
        }.fxCard(padding: 4)
    }

    private func row(icon: String, title: String, trailingText: String? = nil, action: (() -> Void)? = nil) -> some View {
        Button {
            action?()
        } label: {
            HStack(spacing: 13) {
                Image(systemName: icon).foregroundStyle(FXColor.secondaryText).frame(width: 24)
                Text(title).font(.system(size: 15)).foregroundStyle(.white)
                Spacer()
                if let trailingText {
                    Text(trailingText).font(.system(size: 14)).foregroundStyle(FXColor.secondaryText)
                }
                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(FXColor.tertiaryText)
            }.padding(14).contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(action == nil)
    }

    private var signOutRow: some View {
        Button {
            viewModel.signOut()
        } label: {
            HStack(spacing: 13) {
                Image(systemName: "power").foregroundStyle(FXColor.secondaryText).frame(width: 24)
                Group {
                    if viewModel.signOutState == .signingOut {
                        ProgressView().tint(.white)
                    } else {
                        Text("ログアウト").font(.system(size: 15)).foregroundStyle(.white)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(FXColor.tertiaryText)
            }.padding(14).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(viewModel.signOutState == .signingOut)
        .fxCard(padding: 4)
    }
}
