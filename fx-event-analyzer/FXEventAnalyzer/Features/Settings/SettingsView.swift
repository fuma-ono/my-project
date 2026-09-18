import SwiftUI

/// SCR-009 Settings (Phase 5 §2 minimum scope) — a real ログアウト導線.
/// Full account/app settings remain a later phase; this screen exists so a
/// signed-in user is never trapped in the app with no way out (also an App
/// Store account-management expectation, per Phase 4.5's audit finding).
struct SettingsView: View {
    @StateObject private var viewModel: SettingsViewModel

    init(authService: AuthServicing, onSignOut: @escaping () -> Void) {
        _viewModel = StateObject(wrappedValue: SettingsViewModel(authService: authService, onSignOut: onSignOut))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
                VStack(spacing: DesignTokens.Spacing.lg) {
                    EmptyStateView(
                        title: "Settingsは準備中です",
                        message: "アプリ設定・アカウント管理は今後追加予定です。",
                        systemImage: "gearshape"
                    )

                    if case .error(let message) = viewModel.state {
                        Text(message)
                            .font(DesignTokens.Typography.caption)
                            .foregroundStyle(DesignTokens.Colors.statusError)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, DesignTokens.Spacing.lg)
                    }

                    signOutButton
                        .padding(.horizontal, DesignTokens.Spacing.lg)
                }
            }
            .navigationTitle("Settings")
            .toolbarBackground(DesignTokens.Colors.backgroundPrimary, for: .navigationBar)
        }
    }

    private var signOutButton: some View {
        Button {
            viewModel.signOut()
        } label: {
            if viewModel.state == .signingOut {
                ProgressView().tint(.white)
            } else {
                Text("ログアウト")
            }
        }
        .frame(maxWidth: .infinity)
        .padding(DesignTokens.Spacing.md)
        .background(DesignTokens.Colors.statusError)
        .foregroundStyle(.white)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control))
        .disabled(viewModel.state == .signingOut)
    }
}
