import SwiftUI

/// SCR-003 パスワード再設定。`LoginView`と同じ`NavigationStack`にpushされる。
///
/// `SignUpView`と同じ理由(HQ指示 2026-10-09、2回目、参考画像提供)で
/// 「このUIを完全再現して」の指示に基づき再構築した。構成要素は
/// `SignUpView`と共通のブランドマーク+タイトル、見出し+サブタイトル、
/// 単体のシェブロン戻るボタン(`.toolbar(.hidden, for: .navigationBar)` +
/// `@Environment(\.dismiss)`)。
struct PasswordResetView: View {
    @StateObject private var viewModel: PasswordResetViewModel
    @FocusState private var emailFieldFocused: Bool
    @Environment(\.dismiss) private var dismiss

    init(viewModel: @autoclosure @escaping () -> PasswordResetViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.brandBackgroundGradient.ignoresSafeArea()

            VStack(spacing: 0) {
                backButtonRow

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        BrandMark(width: 100, glow: true)
                        BrandTitleText()
                            .padding(.top, 10)

                        if viewModel.state == .sent {
                            sentPanel
                                .padding(.top, DesignTokens.Spacing.xl)
                                .padding(.horizontal, DesignTokens.Spacing.lg)
                        } else {
                            headingBlock
                                .padding(.top, 28)
                            formPanel
                                .padding(.top, 24)
                                .padding(.horizontal, DesignTokens.Spacing.lg)
                        }
                    }
                    .padding(.bottom, DesignTokens.Spacing.lg)
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .preferredColorScheme(.dark)
    }

    private var backButtonRow: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("戻る")
            .accessibilityIdentifier("passwordResetBackButton")
            Spacer()
        }
        .padding(.leading, DesignTokens.Spacing.lg)
        .padding(.top, DesignTokens.Spacing.sm)
    }

    private var headingBlock: some View {
        VStack(spacing: 6) {
            Text("パスワードを再設定")
                .font(DesignTokens.Typography.title)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Text("登録したメールアドレスに\nパスワード再設定用のリンクを送信します")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
                .multilineTextAlignment(.center)
        }
    }

    private var formPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("メールアドレス")
                .font(DesignTokens.Typography.loginCaption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)

            // Same ZStack-placeholder construction as `LoginView`/`SignUpView`'s
            // email field, for the same reason: a `TextField`'s own
            // `prompt:`/`.overlay` placeholder renders in the environment's
            // accent color regardless of `.foregroundStyle` on this OS
            // version, but a plain sibling `Text` doesn't.
            ZStack(alignment: .leading) {
                if viewModel.email.isEmpty {
                    Text(verbatim: "example@domain.com")
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                        .padding(.horizontal, DesignTokens.Spacing.md)
                        .allowsHitTesting(false)
                }
                TextField("", text: $viewModel.email)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
                    .padding(.horizontal, DesignTokens.Spacing.md)
                    .accessibilityLabel("メールアドレス")
                    .focused($emailFieldFocused)
            }
            .frame(height: fieldHeight)
            .background(DesignTokens.Colors.backgroundElevated, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
            .onTapGesture { emailFieldFocused = true }
            .padding(.top, 6)

            Button {
                viewModel.submit()
            } label: {
                Group {
                    if viewModel.state == .submitting {
                        ProgressView().tint(.white)
                    } else {
                        Text("パスワード再設定メールを送信")
                            .font(DesignTokens.Typography.bodyEmphasized)
                            .foregroundStyle(.white)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: fieldHeight)
                .background(DesignTokens.Colors.accentPrimary, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.canSubmit)
            .opacity(viewModel.canSubmit ? 1 : 0.5)
            .padding(.top, 20)
            .frame(maxWidth: .infinity)

            if case .error(let message) = viewModel.state {
                Text(message)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.statusError)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10)
            }

            Button {
                dismiss()
            } label: {
                Text("ログインに戻る")
                    .font(DesignTokens.Typography.loginCaptionEmphasized)
                    .foregroundStyle(DesignTokens.Colors.accentCyan)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .padding(.top, 16)
        }
        .frame(maxWidth: .infinity)
    }

    /// Shown instead of `headingBlock`/`formPanel` once Supabase has
    /// accepted the reset request — there's nothing left to submit on this
    /// screen (the actual password change happens on the link inside the
    /// email, outside this app), so the form disappears rather than staying
    /// visible behind a success message.
    private var sentPanel: some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            Image(systemName: "envelope.badge.fill")
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.Colors.accentCyan)
            Text("再設定メールを送信しました")
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Text("\(viewModel.email) 宛にパスワード再設定メールを送信しました。メール内のリンクを開いて新しいパスワードを設定してください。")
                .font(DesignTokens.Typography.body)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
                .multilineTextAlignment(.center)
            Button {
                dismiss()
            } label: {
                Text("ログインに戻る")
                    .font(DesignTokens.Typography.loginCaptionEmphasized)
                    .foregroundStyle(DesignTokens.Colors.accentCyan)
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(DesignTokens.Spacing.lg)
        .background(DesignTokens.Colors.backgroundElevated, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
    }

    private var fieldHeight: CGFloat { 52 }
}
