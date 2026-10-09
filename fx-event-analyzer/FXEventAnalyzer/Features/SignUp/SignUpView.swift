import SwiftUI

/// SCR-002 新規会員登録(HQ指示 2026-10-09「新規会員登録画面とパスワード
/// 再設定画面を作成して、機能も作成して」)。`LoginView`と同じ
/// `NavigationStack`にpushされる — ui-screens.mdにこの画面専用の参考画像は
/// 無いため、`LoginView`で確定済みの見た目(`DesignTokens`の配色・
/// フィールド/ボタンのスタイル、同じ`brandBackgroundGradient`)をそのまま
/// 踏襲し、通常のナビゲーションバー(戻るボタン・タイトル)の下に積む構成に
/// した。
struct SignUpView: View {
    @StateObject private var viewModel: SignUpViewModel
    @FocusState private var focusedField: Field?

    private enum Field {
        case email, password, confirmPassword
    }

    init(viewModel: @autoclosure @escaping () -> SignUpViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.brandBackgroundGradient.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                if viewModel.state == .confirmationRequired {
                    confirmationRequiredPanel
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
        .navigationTitle("新規会員登録")
        .navigationBarTitleDisplayMode(.inline)
        .preferredColorScheme(.dark)
    }

    private var formPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("メールアドレス")
                .font(DesignTokens.Typography.loginCaption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)

            // Same ZStack-placeholder construction as `LoginView`'s email
            // field, for the same reason (see its own doc comment): a
            // `TextField`'s `prompt:`/`.overlay` placeholder renders in the
            // environment's accent color regardless of `.foregroundStyle`
            // on this OS version, but a plain sibling `Text` doesn't.
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
                    .focused($focusedField, equals: .email)
            }
            .frame(height: fieldHeight)
            .background(DesignTokens.Colors.backgroundElevated, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
            .onTapGesture { focusedField = .email }
            .padding(.top, 6)

            Text("パスワード")
                .font(DesignTokens.Typography.loginCaption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
                .padding(.top, 14)
            ZStack(alignment: .leading) {
                if viewModel.password.isEmpty {
                    Text("8文字以上")
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                        .padding(.horizontal, DesignTokens.Spacing.md)
                        .allowsHitTesting(false)
                }
                SecureField("", text: $viewModel.password)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
                    .padding(.horizontal, DesignTokens.Spacing.md)
                    .accessibilityLabel("パスワード")
                    .focused($focusedField, equals: .password)
            }
            .frame(height: fieldHeight)
            .background(DesignTokens.Colors.backgroundElevated, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
            .onTapGesture { focusedField = .password }
            .padding(.top, 6)

            Text("パスワード(確認)")
                .font(DesignTokens.Typography.loginCaption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
                .padding(.top, 14)
            ZStack(alignment: .leading) {
                if viewModel.confirmPassword.isEmpty {
                    Text("もう一度入力")
                        .font(DesignTokens.Typography.body)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                        .padding(.horizontal, DesignTokens.Spacing.md)
                        .allowsHitTesting(false)
                }
                SecureField("", text: $viewModel.confirmPassword)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
                    .padding(.horizontal, DesignTokens.Spacing.md)
                    .accessibilityLabel("パスワード(確認)")
                    .focused($focusedField, equals: .confirmPassword)
            }
            .frame(height: fieldHeight)
            .background(DesignTokens.Colors.backgroundElevated, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
            .onTapGesture { focusedField = .confirmPassword }
            .padding(.top, 6)

            if viewModel.passwordsMismatch {
                Text("パスワードが一致しません。")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.statusError)
                    .padding(.top, 6)
            }

            Button {
                viewModel.submit()
            } label: {
                Group {
                    if viewModel.state == .submitting {
                        ProgressView().tint(.white)
                    } else {
                        Text("登録する")
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

    /// Shown instead of `formPanel` once Supabase accepts the sign-up but
    /// email confirmation is still pending — there's nothing left to submit
    /// on this screen, so the form disappears rather than staying visible
    /// (and submittable again) behind a success message.
    private var confirmationRequiredPanel: some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            Image(systemName: "envelope.badge.fill")
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.Colors.accentCyan)
            Text("確認メールを送信しました")
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Text("\(viewModel.email) 宛に確認メールを送信しました。メール内のリンクを開いて登録を完了してください。")
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
