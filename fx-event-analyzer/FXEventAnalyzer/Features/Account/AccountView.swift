import SwiftUI

/// SCR-011 Account, reached from Settings.
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5AccountView` (`HQV5TopBar`, profile icon,
/// grouped `HQV5NeonCard` rows, a separate ログアウト row), reproduced as
/// given. Adaptations, all wiring, not redesign, carried over unchanged
/// from the prior integration's own reasoning:
/// - HQ's "user@example.com" → `AccountResponse` carries no email field
///   (api-design.md §24; `UserSession`/`AuthServicing` don't either), and
///   adding one is out of scope here, so a real, non-fabricated identifier
///   (a shortened `userID`) is shown instead of a fabricated address.
/// - "通知設定" and "サブスクリプション" have no real settings/management
///   API behind them (only a read-only `GET /subscription`) — the existing
///   "準備中" alert treatment, not invented behavior.
/// - "プラン" is real (`subscription.plan`), not the demo's static "Free".
/// - `tabSelection`: a real `Binding<Int>` threaded from `MainTabView`, so
///   this pushed screen's own `HQV5BottomBar` switches tabs for real.
struct AccountView: View {
    @StateObject private var viewModel: AccountViewModel
    @State private var pendingFeatureMessage: String?
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, authService: AuthServicing? = nil, onSignOut: @escaping () -> Void = {}, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: AccountViewModel(apiClient: apiClient, authService: authService, onSignOut: onSignOut))
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
            HQV5Screen {
                HQV5TopBar(title: "アカウント", onBack: { dismiss() })

                Image(systemName: "person.circle.fill").font(.system(size: 58)).foregroundStyle(.white).frame(maxWidth: .infinity)
                Text("ユーザー \(account.userID.uuidString.prefix(8))").font(.system(size: 12, weight: .bold)).foregroundStyle(.white).frame(maxWidth: .infinity)

                row(icon: "person", title: "プラン", trailingText: subscription.plan)
                row(icon: "bell", title: "通知設定") {
                    pendingFeatureMessage = "通知設定は準備中です。もうしばらくお待ちください。"
                }
                row(icon: "person", title: "アカウント情報") {
                    pendingFeatureMessage = "登録日: \(ValueFormat.dateTime(account.createdAt))"
                }
                row(icon: "checkmark.seal", title: "サブスクリプション") {
                    pendingFeatureMessage = "サブスクリプション管理は準備中です。もうしばらくお待ちください。"
                }

                if case .error(let message) = viewModel.signOutState {
                    Text(message).font(.system(size: 10)).foregroundStyle(HQV5.red).multilineTextAlignment(.leading)
                }

                signOutRow
            }
        case .error(let message):
            ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() })
        }
    }

    private func row(icon: String, title: String, trailingText: String? = nil, action: (() -> Void)? = nil) -> some View {
        Button {
            action?()
        } label: {
            HQV5NeonCard {
                HStack {
                    Image(systemName: icon).foregroundStyle(.white)
                    Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    if let trailingText {
                        Text(trailingText).font(.system(size: 10)).foregroundStyle(HQV5.muted)
                    }
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(HQV5.muted)
                }
            }
        }.buttonStyle(.plain).disabled(action == nil)
    }

    private var signOutRow: some View {
        Button {
            viewModel.signOut()
        } label: {
            HQV5NeonCard {
                HStack {
                    Image(systemName: "person").foregroundStyle(.white)
                    Group {
                        if viewModel.signOutState == .signingOut {
                            ProgressView().tint(.white)
                        } else {
                            Text("ログアウト").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                        }
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(HQV5.muted)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(viewModel.signOutState == .signingOut)
    }
}
