import SwiftUI

/// SCR-009 Settings (Phase 5 §2 minimum scope) — a real ログアウト導線,
/// plus the real navigation to SCR-011 Account.
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5Settings` (fixed 234×491 canvas, two
/// grouped row lists, a red ログアウト row), reproduced as given. Only
/// "アカウント設定" has a real destination (`AppRoute.account`); the rest
/// have no backing ViewModel/API (no notification/display/data-fetch
/// settings service, no help/terms/privacy content endpoint), so they use
/// the existing "準備中" alert. A sign-out failure (a real state HQ's
/// static canvas has no slot for) is anchored just below the ログアウト
/// row via `.overlay(alignment: .bottom)`, the same off-frame technique
/// used for Login's error message, rather than resizing or relabeling
/// anything. `tabSelection` is a real `Binding<Int>` threaded from
/// `MainTabView`, and — same as before this round — this tab's own
/// `.navigationDestination` intercepts `AppRoute.account` to supply
/// `authService`/`onSignOut`, since the shared `AppRouteDestinationView`
/// only carries `apiClient`.
struct SettingsView: View {
    @StateObject private var viewModel: SettingsViewModel
    private let apiClient: APIClient
    private let authService: AuthServicing
    private let onSignOut: () -> Void
    @State private var pendingFeatureMessage: String?
    @Binding var tabSelection: Int

    init(apiClient: APIClient, authService: AuthServicing, onSignOut: @escaping () -> Void, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        self.authService = authService
        self.onSignOut = onSignOut
        _viewModel = StateObject(wrappedValue: SettingsViewModel(authService: authService, onSignOut: onSignOut))
        _tabSelection = tabSelection
    }

    var body: some View {
        NavigationStack {
            V5Viewport {
                V5TopStatus()
                V5Header(title: "設定", back: false, star: false)

                settingRow("通知設定", y: 70) {
                    pendingFeatureMessage = "通知設定は準備中です。もうしばらくお待ちください。"
                }
                settingRow("表示設定", y: 104) {
                    pendingFeatureMessage = "表示設定は準備中です。もうしばらくお待ちください。"
                }
                settingRow("データ取得設定", y: 138) {
                    pendingFeatureMessage = "データ取得設定は準備中です。もうしばらくお待ちください。"
                }
                NavigationLink(value: AppRoute.account) {
                    settingRowLabel("アカウント設定")
                }.buttonStyle(.plain).position(x: 117, y: 172)

                settingRow("ヘルプ・サポート", y: 225) {
                    pendingFeatureMessage = "ヘルプ・サポートは準備中です。もうしばらくお待ちください。"
                }
                settingRow("利用規約", y: 259) {
                    pendingFeatureMessage = "利用規約は準備中です。もうしばらくお待ちください。"
                }
                settingRow("プライバシーポリシー", y: 293) {
                    pendingFeatureMessage = "プライバシーポリシーは準備中です。もうしばらくお待ちください。"
                }

                Button {
                    viewModel.signOut()
                } label: {
                    HStack {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                        if viewModel.state == .signingOut {
                            ProgressView().tint(V5P.red)
                        } else {
                            Text("ログアウト").font(.system(size: 9, weight: .bold))
                        }
                        Spacer()
                    }
                    .foregroundStyle(V5P.red)
                    .padding(.horizontal, 10).frame(width: 204, height: 32)
                    .background(V5P.red.opacity(0.07), in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(V5P.red, lineWidth: 0.8))
                }
                .buttonStyle(.plain)
                .disabled(viewModel.state == .signingOut)
                .overlay(alignment: .bottom) {
                    if case .error(let message) = viewModel.state {
                        Text(message).font(.system(size: 6)).foregroundStyle(V5P.red)
                            .multilineTextAlignment(.center).frame(width: 204).offset(y: 14)
                    }
                }
                .position(x: 117, y: 343)

                V5BottomBar(selected: $tabSelection)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: AppRoute.self) { route in
                if route == .account {
                    AccountView(apiClient: apiClient, authService: authService, onSignOut: onSignOut, tabSelection: $tabSelection)
                } else {
                    AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
                }
            }
        }
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

    @ViewBuilder private func settingRow(_ title: String, y: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) { settingRowLabel(title) }.buttonStyle(.plain).position(x: 117, y: y)
    }

    private func settingRowLabel(_ title: String) -> some View {
        HStack {
            Image(systemName: "gearshape").font(.system(size: 10))
            Text(title).font(.system(size: 8))
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 7))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 9).frame(width: 204, height: 29)
        .background(V5P.panel, in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(V5P.line.opacity(0.5), lineWidth: 0.5))
    }
}
