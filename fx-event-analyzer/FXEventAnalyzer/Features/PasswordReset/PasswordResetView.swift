import SwiftUI

/// SCR-003 パスワード再設定(HQ指示 2026-10-09「新規会員登録画面とパスワード
/// 再設定画面を作成して、機能も作成して」)。`LoginView`と同じ
/// `NavigationStack`にpushされる — `SignUpView`と同じ理由でui-screens.mdに
/// この画面専用の参考画像は無いため、`LoginView`で確定済みの見た目
/// (`DesignTokens`の配色・フィールド/ボタンのスタイル、同じ
/// `brandBackgroundGradient`)をそのまま踏襲した。
struct PasswordResetView: View {
    @StateObject private var viewModel: PasswordResetViewModel
    @FocusState private var emailFieldFocused: Bool

    init(viewModel: @autoclosure @escaping () -> PasswordResetViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.brandBackgroundGradient.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                if viewModel.state == .sent {
                    sentPanel
                        .padding(.horizontal, DesignTokens.Spacing.lg)
                        .padding(.top, DesignTokens.Spacing.xl)
                } else {
                    formPanel
                        .padding(.horizontal, DesignTokens.Spacing.lg)
                        .padding(.top, DesignTokens.Spacing.lg)
                        .padding(.bottom, DesignTokens.Spacing.lg)
                }
            }
        }
        .navigationTitle("パスワード再設定")
        .navigationBarTitleDisplayMode(.inline)
        .preferredColorScheme(.dark)
    }

    private var formPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("登録済みのメールアドレスを入力してください。パスワード再設定用のリンクを送信します。")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            Text("メールアドレス")
                .font(DesignTokens.Typography.loginCaption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
                .padding(.top, 16)

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
                        Text("再設定メールを送信")
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
        }
        .frame(maxWidth: .infinity)
    }

    /// Shown instead of `formPanel` once Supabase has accepted the reset
    /// request — there's nothing left to submit on this screen (the actual
    /// password change happens on the link inside the email, outside this
    /// app), so the form disappears rather than staying visible behind a
    /// success message.
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
        }
        .frame(maxWidth: .infinity)
        .padding(DesignTokens.Spacing.lg)
        .background(DesignTokens.Colors.backgroundElevated, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
    }

    private var fieldHeight: CGFloat { 52 }
}
