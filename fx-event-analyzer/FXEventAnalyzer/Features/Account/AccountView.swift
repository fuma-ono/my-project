import SwiftUI

/// SCR-015 アカウント情報、Settingsから遷移。
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5Account` (fixed 234×491 canvas, profile
/// icon, grouped rows, a ログアウト row), reproduced as given. Adaptations,
/// all wiring, not redesign, carried over unchanged from both prior
/// integrations' own reasoning:
/// - HQ's "user@example.com" → `AccountResponse` carries no email field
///   (api-design.md §24; `UserSession`/`AuthServicing` don't either), so a
///   real, non-fabricated identifier (a shortened `userID`) is shown
///   instead of a fabricated address.
/// - "通知設定" and "サブスクリプション" have no real settings/management
///   API behind them (only a read-only `GET /subscription`) — the
///   existing "準備中" alert treatment.
/// - "プラン" trailing text is real (`subscription.plan`), not "Free".
/// - `tabSelection`: a real `Binding<Int>` threaded from `MainTabView`.
struct AccountView: View {
    @StateObject private var viewModel: AccountViewModel
    @State private var pendingFeatureMessage: String?
    /// 2026-09-29 HQ承認(2-b): SCR-025 ログアウト確認ダイアログ。
    @State private var showLogoutConfirmation = false
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, authService: AuthServicing? = nil, onSignOut: @escaping () -> Void = {}, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: AccountViewModel(apiClient: apiClient, authService: authService, onSignOut: onSignOut))
        _tabSelection = tabSelection
    }

    var body: some View {
        content
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
            // 2026-09-29 HQ承認(2-b): SCR-025 ログアウト確認ダイアログ。
            .confirmationDialog(
                "ログアウトしますか？",
                isPresented: $showLogoutConfirmation,
                titleVisibility: .visible
            ) {
                Button("ログアウト", role: .destructive) { viewModel.signOut() }
                Button("キャンセル", role: .cancel) {}
            }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "アカウント情報はまだ利用できません。") }
        case .loaded(let account, let subscription):
            V5Viewport {
                V5Header(title: "アカウント", back: true, onBack: { dismiss() })

                Image(systemName: "person.circle.fill").font(.system(size: 52)).foregroundStyle(.white).position(x: 117, y: 105)
                V5JPFont.text("ユーザー \(account.userID.uuidString.prefix(8))", size: 9, weight: .bold).foregroundStyle(.white).position(x: 117, y: 145)

                accountRow("person", "プラン", subscription.plan, 170, action: nil)
                // 2026-09-29 HQ承認(2-b): 既存の行をそのままNavigationLinkに
                // 差し替え、対応するSCR-01x(仮画面)への遷移を確認できるように
                // した。行の見た目は変更していない。
                accountNavRow("bell", "通知設定", 205, route: .notificationSettings)
                accountRow("person", "アカウント情報", "", 240) {
                    pendingFeatureMessage = "登録日: \(ValueFormat.dateTime(account.createdAt))"
                }
                accountNavRow("creditcard", "サブスクリプション", 275, route: .subscriptionManagement)
                Button {
                    showLogoutConfirmation = true
                } label: {
                    HStack {
                        Image(systemName: "arrow.right.square").font(.system(size: 9))
                        if viewModel.signOutState == .signingOut {
                            ProgressView().tint(.white)
                        } else {
                            V5JPFont.text("ログアウト", size: 8, weight: .regular)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 7))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 9).frame(width: 214, height: 30)
                    .background(V5P.panel, in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(V5P.line.opacity(0.5), lineWidth: 0.5))
                }
                .buttonStyle(.plain)
                .disabled(viewModel.signOutState == .signingOut)
                .overlay(alignment: .bottom) {
                    if case .error(let message) = viewModel.signOutState {
                        V5JPFont.text(message, size: 6, weight: .regular).foregroundStyle(V5P.red)
                            .multilineTextAlignment(.center).frame(width: 214).offset(y: 14)
                    }
                }
                .position(x: 117, y: 320)

                V5BottomBar(selected: $tabSelection)
            }
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: () -> some View) -> some View {
        ZStack {
            // HQ指示(2026-10-02): 中身の背景をSplash/Loginのグラデーションから切り離し、
            // 単色(backgroundPrimary)に変更(詳細はV5Backgroundのドキュメントコメント参照)。
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
            content()
        }
    }

    @ViewBuilder private func accountRow(_ icon: String, _ title: String, _ trailing: String, _ y: CGFloat, action: (() -> Void)?) -> some View {
        Button {
            action?()
        } label: {
            accountRowLabel(icon, title, trailing)
        }
        .buttonStyle(.plain)
        .disabled(action == nil)
        .position(x: 117, y: y)
    }

    /// `accountRow`と同じ見た目で、`SettingsSubRoute`(仮画面)へのNavigationLink
    /// になっているもの(2026-09-29 HQ承認、2-b)。
    @ViewBuilder private func accountNavRow(_ icon: String, _ title: String, _ y: CGFloat, route: SettingsSubRoute) -> some View {
        NavigationLink(value: route) {
            accountRowLabel(icon, title, "")
        }
        .buttonStyle(.plain)
        .position(x: 117, y: y)
    }

    private func accountRowLabel(_ icon: String, _ title: String, _ trailing: String) -> some View {
        HStack {
            Image(systemName: icon).font(.system(size: 9))
            V5JPFont.text(title, size: 8, weight: .regular)
            Spacer()
            if !trailing.isEmpty { V5JPFont.text(trailing, size: 8, weight: .regular) }
            Image(systemName: "chevron.right").font(.system(size: 7))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 9).frame(width: 214, height: 30)
        .background(V5P.panel, in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(V5P.line.opacity(0.5), lineWidth: 0.5))
    }
}
