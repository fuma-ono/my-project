import SwiftUI

/// SCR-010 Login (ui-screens.md).
struct LoginView: View {
    @StateObject private var viewModel: LoginViewModel
    let sessionExpired: Bool

    init(viewModel: @autoclosure @escaping () -> LoginViewModel, sessionExpired: Bool = false) {
        _viewModel = StateObject(wrappedValue: viewModel())
        self.sessionExpired = sessionExpired
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()

            ScrollView {
                VStack(spacing: DesignTokens.Spacing.lg) {
                    BrandMark(size: 64)
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
                        // Navigation stubs only — no Password Reset / Sign Up
                        // screen spec exists yet in ui-screens.md.
                        Button("パスワードをお忘れですか？") {}
                            .font(DesignTokens.Typography.caption)
                        Button("新規登録") {}
                            .font(DesignTokens.Typography.caption)
                    }
                    .tint(DesignTokens.Colors.accentSecondary)
                }
                .padding(.horizontal, DesignTokens.Spacing.lg)
                .frame(maxWidth: 480)
            }
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
