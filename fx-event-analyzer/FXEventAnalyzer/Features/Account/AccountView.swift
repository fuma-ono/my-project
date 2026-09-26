import SwiftUI

/// SCR-011 Account, reached from Settings.
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
                V5TopStatus()
                V5Header(title: "アカウント", back: true, star: false, onBack: { dismiss() })

                Image(systemName: "person.circle.fill").font(.system(size: 52)).foregroundStyle(.white).position(x: 117, y: 105)
                Text("ユーザー \(account.userID.uuidString.prefix(8))").font(.system(size: 9, weight: .bold)).foregroundStyle(.white).position(x: 117, y: 145)

                accountRow("person", "プラン", subscription.plan, 170, action: nil)
                accountRow("bell", "通知設定", "", 205) {
                    pendingFeatureMessage = "通知設定は準備中です。もうしばらくお待ちください。"
                }
                accountRow("person", "アカウント情報", "", 240) {
                    pendingFeatureMessage = "登録日: \(ValueFormat.dateTime(account.createdAt))"
                }
                accountRow("creditcard", "サブスクリプション", "", 275) {
                    pendingFeatureMessage = "サブスクリプション管理は準備中です。もうしばらくお待ちください。"
                }
                Button {
                    viewModel.signOut()
                } label: {
                    HStack {
                        Image(systemName: "arrow.right.square").font(.system(size: 9))
                        if viewModel.signOutState == .signingOut {
                            ProgressView().tint(.white)
                        } else {
                            Text("ログアウト").font(.system(size: 8))
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 7))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 9).frame(width: 204, height: 30)
                    .background(V5P.panel, in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(V5P.line.opacity(0.5), lineWidth: 0.5))
                }
                .buttonStyle(.plain)
                .disabled(viewModel.signOutState == .signingOut)
                .overlay(alignment: .bottom) {
                    if case .error(let message) = viewModel.signOutState {
                        Text(message).font(.system(size: 6)).foregroundStyle(V5P.red)
                            .multilineTextAlignment(.center).frame(width: 204).offset(y: 14)
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
            LinearGradient(colors: [V5P.bg0, V5P.bg1, V5P.bg0], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            content()
        }
    }

    @ViewBuilder private func accountRow(_ icon: String, _ title: String, _ trailing: String, _ y: CGFloat, action: (() -> Void)?) -> some View {
        Button {
            action?()
        } label: {
            HStack {
                Image(systemName: icon).font(.system(size: 9))
                Text(title).font(.system(size: 8))
                Spacer()
                if !trailing.isEmpty { Text(trailing).font(.system(size: 8)) }
                Image(systemName: "chevron.right").font(.system(size: 7))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 9).frame(width: 204, height: 30)
            .background(V5P.panel, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(V5P.line.opacity(0.5), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .disabled(action == nil)
        .position(x: 117, y: y)
    }
}
