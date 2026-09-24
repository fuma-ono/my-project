import SwiftUI

/// SCR-009 Settings (Phase 5 §2 minimum scope) — a real ログアウト導線,
/// plus the real navigation to SCR-011 Account.
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5SettingsView` (grouped `HQV5NeonCard` rows,
/// a red-bordered "ログアウト" row, `HQV5BottomBar`), reproduced as given.
/// Only "アカウント設定" has a real destination (`AppRoute.account`); the
/// rest have no backing ViewModel/API (no notification/display/data-fetch
/// settings service, no help/terms/privacy content endpoint), so they use
/// the "準備中" alert Login already established for its own non-functional
/// rows, rather than inventing screens or content. `tabSelection` is a real
/// `Binding<Int>` threaded from `MainTabView`, and — same as before this
/// round — this tab's own `.navigationDestination` intercepts
/// `AppRoute.account` to supply `authService`/`onSignOut`, since the shared
/// `AppRouteDestinationView` only carries `apiClient`.
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
            ZStack(alignment: .bottom) {
                HQV5Background()
                content
                    .safeAreaInset(edge: .bottom) {
                        HQV5BottomBar(selected: $tabSelection).padding(.horizontal, 10).padding(.bottom, 5)
                    }
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

    @ViewBuilder
    private var content: some View {
        HQV5Screen(title: "設定") {
            settingRow("bell", "通知設定") {
                pendingFeatureMessage = "通知設定は準備中です。もうしばらくお待ちください。"
            }
            settingRow("gearshape", "表示設定") {
                pendingFeatureMessage = "表示設定は準備中です。もうしばらくお待ちください。"
            }
            settingRow("calendar", "データ取得設定") {
                pendingFeatureMessage = "データ取得設定は準備中です。もうしばらくお待ちください。"
            }
            NavigationLink(value: AppRoute.account) {
                settingRowLabel("person", "アカウント設定")
            }.buttonStyle(.plain)

            settingRow("questionmark.circle", "ヘルプ・サポート") {
                pendingFeatureMessage = "ヘルプ・サポートは準備中です。もうしばらくお待ちください。"
            }
            settingRow("doc.text", "利用規約") {
                pendingFeatureMessage = "利用規約は準備中です。もうしばらくお待ちください。"
            }
            settingRow("checkmark.shield", "プライバシーポリシー") {
                pendingFeatureMessage = "プライバシーポリシーは準備中です。もうしばらくお待ちください。"
            }

            if case .error(let message) = viewModel.state {
                Text(message).font(.system(size: 10)).foregroundStyle(HQV5.red).multilineTextAlignment(.leading)
            }

            signOutButton
        }
    }

    private var signOutButton: some View {
        Button {
            viewModel.signOut()
        } label: {
            HStack {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                Group {
                    if viewModel.state == .signingOut {
                        ProgressView().tint(HQV5.red)
                    } else {
                        Text("ログアウト").font(.system(size: 11, weight: .bold))
                    }
                }
                Spacer()
            }
            .foregroundStyle(HQV5.red)
            .padding(12)
            .background(HQV5.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(HQV5.red, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(viewModel.state == .signingOut)
    }

    private func settingRow(_ icon: String, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            settingRowLabel(icon, title)
        }.buttonStyle(.plain)
    }

    private func settingRowLabel(_ icon: String, _ title: String) -> some View {
        HQV5NeonCard {
            HStack {
                Image(systemName: icon).foregroundStyle(.white)
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(HQV5.muted)
            }
        }
    }
}
