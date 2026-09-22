import SwiftUI

/// SCR-009 Settings (Phase 5 §2 minimum scope) — a real ログアウト導線,
/// plus (this integration) the real navigation to SCR-011 Account.
///
/// HQ UI Master v5 integration (2026-09-22): reproduces
/// `Assets/Reference/SCR-009.png` — "設定" title (no brand mark), two
/// grouped row cards (通知設定/表示設定/データ取得設定/アカウント設定, then
/// ヘルプ・サポート/利用規約/プライバシーポリシー), then a standalone
/// red-bordered "ログアウト" card. Only "アカウント設定" has a real
/// destination (`AppRoute.account`, routed to the real `AccountView` via
/// the override below); the rest have no backing ViewModel/API (no
/// notification/display/data-fetch settings service, no help/terms/privacy
/// content endpoint exists), so they use the "準備中" alert Login already
/// established for its own non-functional rows, rather than inventing
/// screens or content for them.
struct SettingsView: View {
    @StateObject private var viewModel: SettingsViewModel
    private let apiClient: APIClient
    private let authService: AuthServicing
    private let onSignOut: () -> Void
    @State private var pendingFeatureMessage: String?

    init(apiClient: APIClient, authService: AuthServicing, onSignOut: @escaping () -> Void) {
        self.apiClient = apiClient
        self.authService = authService
        self.onSignOut = onSignOut
        _viewModel = StateObject(wrappedValue: SettingsViewModel(authService: authService, onSignOut: onSignOut))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                FXAppBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        Text("設定").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)

                        VStack(spacing: 0) {
                            settingRow("bell", "通知設定") {
                                pendingFeatureMessage = "通知設定は準備中です。もうしばらくお待ちください。"
                            }
                            Divider().background(FXColor.border)
                            settingRow("gearshape", "表示設定") {
                                pendingFeatureMessage = "表示設定は準備中です。もうしばらくお待ちください。"
                            }
                            Divider().background(FXColor.border)
                            settingRow("calendar", "データ取得設定") {
                                pendingFeatureMessage = "データ取得設定は準備中です。もうしばらくお待ちください。"
                            }
                            Divider().background(FXColor.border)
                            NavigationLink(value: AppRoute.account) {
                                settingRowLabel("person", "アカウント設定")
                            }
                        }.fxCard(padding: 4)

                        VStack(spacing: 0) {
                            settingRow("questionmark.circle", "ヘルプ・サポート") {
                                pendingFeatureMessage = "ヘルプ・サポートは準備中です。もうしばらくお待ちください。"
                            }
                            Divider().background(FXColor.border)
                            settingRow("calendar", "利用規約") {
                                pendingFeatureMessage = "利用規約は準備中です。もうしばらくお待ちください。"
                            }
                            Divider().background(FXColor.border)
                            settingRow("checkmark.shield", "プライバシーポリシー") {
                                pendingFeatureMessage = "プライバシーポリシーは準備中です。もうしばらくお待ちください。"
                            }
                        }.fxCard(padding: 4)

                        if case .error(let message) = viewModel.state {
                            Text(message).font(.system(size: 12)).foregroundStyle(FXColor.red).multilineTextAlignment(.leading)
                        }

                        signOutButton
                    }.padding(20).frame(maxWidth: 800)
                }
            }
            .navigationTitle("設定")
            .navigationDestination(for: AppRoute.self) { route in
                if route == .account {
                    AccountView(apiClient: apiClient, authService: authService, onSignOut: onSignOut)
                } else {
                    AppRouteDestinationView(route: route, apiClient: apiClient)
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

    private var signOutButton: some View {
        Button {
            viewModel.signOut()
        } label: {
            Group {
                if viewModel.state == .signingOut {
                    ProgressView().tint(.white)
                } else {
                    Text("ログアウト")
                }
            }.frame(maxWidth: .infinity).frame(height: 52)
        }
        .background(FXColor.red.opacity(0.08))
        .foregroundStyle(FXColor.red)
        .font(.system(size: 15, weight: .bold))
        .clipShape(RoundedRectangle(cornerRadius: 15))
        .overlay(RoundedRectangle(cornerRadius: 15).stroke(FXColor.red.opacity(0.2)))
        .buttonStyle(.plain)
        .disabled(viewModel.state == .signingOut)
    }

    private func settingRow(_ icon: String, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            settingRowLabel(icon, title)
        }.buttonStyle(.plain)
    }

    private func settingRowLabel(_ icon: String, _ title: String) -> some View {
        HStack(spacing: 13) {
            Image(systemName: icon).foregroundStyle(.white).frame(width: 24)
            Text(title).foregroundStyle(.white).font(.system(size: 15))
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(FXColor.tertiaryText)
        }.padding(14).contentShape(Rectangle())
    }
}
