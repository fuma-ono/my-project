import SwiftUI

/// SCR-010 Login (ui-screens.md).
struct LoginView: View {
    @StateObject private var viewModel: LoginViewModel
    let sessionExpired: Bool
    /// Phase 4.5 UX audit: these buttons previously did nothing at all on
    /// tap. Password Reset / Sign Up have no screen spec yet
    /// (ui-screens.md), and HQ's Phase 5 instruction is explicit not to
    /// expand Auth scope to build them now — so tapping surfaces an honest
    /// "準備中" message instead of silence (HQ: "何も起きない状態は禁止").
    @State private var pendingFeatureMessage: String?

    init(viewModel: @autoclosure @escaping () -> LoginViewModel, sessionExpired: Bool = false) {
        _viewModel = StateObject(wrappedValue: viewModel())
        self.sessionExpired = sessionExpired
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()

            ScrollView {
                VStack(spacing: DesignTokens.Spacing.lg) {
                    BrandMark(width: 64)
                        .padding(.top, DesignTokens.Spacing.xl)

                    if sessionExpired {
                        sessionExpiredBanner
                    }

                    VStack(spacing: DesignTokens.Spacing.md) {
                        TextField("メールアドレス", text: $viewModel.email)
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(DesignTokens.Spacing.md)
                            .background(DesignTokens.Colors.backgroundSurface)
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control))

                        SecureField("パスワード", text: $viewModel.password)
                            .textContentType(.password)
                            .padding(DesignTokens.Spacing.md)
                            .background(DesignTokens.Colors.backgroundSurface)
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control))

                        if case .error(let message) = viewModel.state {
                            Text(message)
                                .font(DesignTokens.Typography.caption)
                                .foregroundStyle(DesignTokens.Colors.statusError)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        Button {
                            viewModel.submit()
                        } label: {
                            if viewModel.state == .submitting {
                                ProgressView().tint(.white)
                            } else {
                                Text("ログイン")
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(DesignTokens.Spacing.md)
                        .background(DesignTokens.Colors.accentPrimary)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control))
                        .disabled(!viewModel.canSubmit)
                        .opacity(viewModel.canSubmit ? 1 : 0.5)
                    }
                    .padding(DesignTokens.Spacing.lg)
                    .background(DesignTokens.Colors.backgroundSurface.opacity(0.4))
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.card))

                    VStack(spacing: DesignTokens.Spacing.sm) {
                        Button("パスワードをお忘れですか？") {
                            pendingFeatureMessage = "パスワードリセットは準備中です。もうしばらくお待ちください。"
                        }
                        .font(DesignTokens.Typography.caption)
                        Button("新規登録") {
                            pendingFeatureMessage = "新規登録は準備中です。もうしばらくお待ちください。"
                        }
                        .font(DesignTokens.Typography.caption)
                    }
                    .tint(DesignTokens.Colors.accentSecondary)
                }
                .padding(.horizontal, DesignTokens.Spacing.lg)
                .frame(maxWidth: 480)
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

    private var sessionExpiredBanner: some View {
        VStack(spacing: DesignTokens.Spacing.xs) {
            Text("セッションの有効期限が切れています")
                .font(DesignTokens.Typography.body)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Text("再度ログインしてください")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
        }
        .padding(DesignTokens.Spacing.md)
        .frame(maxWidth: .infinity)
        .background(DesignTokens.Colors.statusError.opacity(0.15))
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control))
    }
}
