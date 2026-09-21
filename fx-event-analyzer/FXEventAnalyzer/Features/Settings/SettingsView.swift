import SwiftUI

/// SCR-009 Settings (Phase 5 §2 minimum scope) — a real ログアウト導線,
/// plus (this integration) the real navigation to SCR-011 Account.
///
/// HQ Frontend integration (2026-09-21): visual content — rows, subscription
/// card, sign-out button — is HQ's
/// `FXEventAnalyzer_HQFrontend/SettingsView.swift`. Adaptation: HQ's
/// "アカウント" row pushed a parameterless `AccountView()`; the real one
/// needs `apiClient` to fetch real account data, so this view now also
/// takes `apiClient` (passed through by `MainTabView`) and routes via
/// `AppRoute.account`. The sign-out failure message
/// (`SettingsViewModel.state == .error`), not present in HQ's mockup, is
/// kept visible in HQ's own red/caption styling — an existing, working
/// error state this integration must not silently drop.
struct SettingsView: View {
    @StateObject private var viewModel: SettingsViewModel
    private let apiClient: APIClient

    init(apiClient: APIClient, authService: AuthServicing, onSignOut: @escaping () -> Void) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: SettingsViewModel(authService: authService, onSignOut: onSignOut))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                FXAppBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        FXBrandMark()
                        Text("Settings").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundStyle(.white)

                        VStack(spacing: 0) {
                            NavigationLink(value: AppRoute.account) {
                                settingRow("person.crop.circle", "アカウント", "メール・アカウント情報")
                            }
                            Divider().background(FXColor.border)
                            settingRow("bell", "通知", "イベント通知は準備中", disabled: true)
                            Divider().background(FXColor.border)
                            settingRow("moon.fill", "外観", "ダークテーマ", disabled: true)
                        }.fxCard(padding: 4)

                        VStack(alignment: .leading, spacing: 12) {
                            FXSectionHeader(title: "Subscription")
                            HStack {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text("Free").font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
                                    Text("基本イベント・履歴・市場反応").font(.system(size: 12)).foregroundStyle(FXColor.secondaryText)
                                }
                                Spacer()
                                FXBadge(text: "CURRENT", tint: FXColor.cyan)
                            }
                        }.fxCard()

                        if case .error(let message) = viewModel.state {
                            Text(message).font(.system(size: 12)).foregroundStyle(FXColor.red).multilineTextAlignment(.leading)
                        }

                        signOutButton
                    }.padding(20).frame(maxWidth: 800)
                }
            }
            .navigationTitle("Settings")
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient)
            }
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

    private func settingRow(_ icon: String, _ title: String, _ subtitle: String, disabled: Bool = false) -> some View {
        HStack(spacing: 13) {
            Image(systemName: icon).foregroundStyle(disabled ? FXColor.tertiaryText : FXColor.cyan).frame(width: 36, height: 36).background(FXColor.cyan.opacity(disabled ? 0.04 : 0.09)).clipShape(RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).foregroundStyle(disabled ? FXColor.secondaryText : .white).font(.system(size: 15, weight: .semibold))
                Text(subtitle).foregroundStyle(FXColor.tertiaryText).font(.system(size: 11))
            }
            Spacer()
            if !disabled {
                Image(systemName: "chevron.right").foregroundStyle(FXColor.tertiaryText)
            }
        }.padding(14).contentShape(Rectangle())
    }
}
