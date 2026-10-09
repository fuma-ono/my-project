import SwiftUI

/// SCR-002 新規会員登録。`LoginView`と同じ`NavigationStack`にpushされる。
///
/// HQ指示(2026-10-09、2回目)でこの画面専用の参考画像が提供され、
/// 「このUIを完全再現して」と再構築を指示された。見た目は参考画像の測定
/// (1023×1020の合成画像から左側の画面を抽出・2倍拡大して測定): ブランド
/// マーク幅は画面幅の約0.26(`BrandMark(width: 100)`)、戻るボタンは
/// システムのナビゲーションバーではなく単体のシェブロンアイコン(他の
/// プッシュ画面と同じ`.toolbar(.hidden, for: .navigationBar)` +
/// `@Environment(\.dismiss)`パターン — `IndicatorDetailView`等参照)。
/// Apple/Google登録ボタンはLoginの塗りつぶしスタイルと違い、枠線のみの
/// アウトラインボタン(参考画像通り)。パスワード欄の目アイコンは実際に
/// 表示・非表示を切り替える(参考画像のアイコンが示唆する通りの実機能)。
struct SignUpView: View {
    @StateObject private var viewModel: SignUpViewModel
    @FocusState private var focusedField: Field?
    @Environment(\.dismiss) private var dismiss
    @State private var pendingFeatureMessage: String?
    @State private var isPasswordVisible = false
    @State private var isConfirmPasswordVisible = false

    private enum Field {
        case email, password, confirmPassword
    }

    init(viewModel: @autoclosure @escaping () -> SignUpViewModel) {
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

                        if viewModel.state == .confirmationRequired {
                            confirmationRequiredPanel
                                .padding(.top, DesignTokens.Spacing.xl)
                                .padding(.horizontal, DesignTokens.Spacing.lg)
                        } else {
                            headingBlock
                                .padding(.top, 20)
                            formPanel
                                .padding(.top, 18)
                                .padding(.horizontal, DesignTokens.Spacing.lg)
                        }
                    }
                    .padding(.bottom, DesignTokens.Spacing.sm)
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .preferredColorScheme(.dark)
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
            .accessibilityIdentifier("signUpBackButton")
            Spacer()
        }
        .padding(.leading, DesignTokens.Spacing.lg)
        .padding(.top, DesignTokens.Spacing.sm)
    }

    private var headingBlock: some View {
        VStack(spacing: 6) {
            Text("新規会員登録")
                .font(DesignTokens.Typography.title)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Text("アカウントを作成して、\nすべての機能を利用しましょう")
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
            passwordField(
                text: $viewModel.password,
                placeholder: "パスワードを入力",
                accessibilityLabel: "パスワード",
                isVisible: $isPasswordVisible,
                field: .password
            )
            .padding(.top, 6)

            Text("パスワード(確認用)")
                .font(DesignTokens.Typography.loginCaption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
                .padding(.top, 14)
            passwordField(
                text: $viewModel.confirmPassword,
                placeholder: "パスワードを再入力",
                accessibilityLabel: "パスワード(確認用)",
                isVisible: $isConfirmPasswordVisible,
                field: .confirmPassword
            )
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
                        Text("新規登録")
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

            HStack(spacing: 12) {
                Rectangle().fill(DesignTokens.Colors.borderSubtle).frame(height: 1)
                Text("または")
                    .font(DesignTokens.Typography.loginCaption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                    .fixedSize()
                Rectangle().fill(DesignTokens.Colors.borderSubtle).frame(height: 1)
            }
            .padding(.top, 20)

            socialSignUpSection
                .padding(.top, 16)

            VStack(spacing: 4) {
                Text("すでにアカウントをお持ちの方は")
                    .font(DesignTokens.Typography.loginCaption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                Button {
                    dismiss()
                } label: {
                    Text("ログイン")
                        .font(DesignTokens.Typography.loginCaptionEmphasized)
                        .foregroundStyle(DesignTokens.Colors.accentCyan)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 22)
        }
        .frame(maxWidth: .infinity)
    }

    /// `SecureField`/`TextField` pair toggled by `isVisible`, matching the
    /// Reference's "eye" icon — unlike the decorative camera icon on
    /// `LoginView`'s password field (no backing feature exists there
    /// either), this one actually switches visibility since that's the
    /// icon's only plausible meaning here.
    private func passwordField(
        text: Binding<String>,
        placeholder: String,
        accessibilityLabel: String,
        isVisible: Binding<Bool>,
        field: Field
    ) -> some View {
        ZStack(alignment: .leading) {
            if text.wrappedValue.isEmpty {
                Text(placeholder)
                    .font(DesignTokens.Typography.body)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                    .padding(.horizontal, DesignTokens.Spacing.md)
                    .allowsHitTesting(false)
            }
            Group {
                if isVisible.wrappedValue {
                    TextField("", text: text)
                        .textInputAutocapitalization(.never)
                } else {
                    SecureField("", text: text)
                }
            }
            .font(DesignTokens.Typography.body)
            .foregroundStyle(DesignTokens.Colors.textPrimary)
            .padding(.leading, DesignTokens.Spacing.md)
            .padding(.trailing, 44)
            .accessibilityLabel(accessibilityLabel)
            .focused($focusedField, equals: field)
        }
        .frame(height: fieldHeight)
        .background(DesignTokens.Colors.backgroundElevated, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
        .overlay(alignment: .trailing) {
            Button {
                isVisible.wrappedValue.toggle()
            } label: {
                Image(systemName: isVisible.wrappedValue ? "eye.slash" : "eye")
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isVisible.wrappedValue ? "\(accessibilityLabel)を非表示" : "\(accessibilityLabel)を表示")
            .padding(.trailing, DesignTokens.Spacing.md)
        }
        .onTapGesture { focusedField = field }
    }

    /// Not in the Reference's own screenshot for this screen in detail, but
    /// matches the outlined (not filled) style the Reference shows for
    /// these two buttons here — distinct from `LoginView`'s solid-white
    /// Apple button. `AuthServicing` has no social-auth method yet
    /// (ui-screens.md: "認証方式は別途詳細設計で確定する"), so both are
    /// wired to the same "準備中" alert every other not-yet-implemented
    /// action in this app already uses.
    private var socialSignUpSection: some View {
        VStack(spacing: 12) {
            Button {
                pendingFeatureMessage = "Appleで登録は準備中です。もうしばらくお待ちください。"
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "apple.logo")
                        .font(.system(size: 17, weight: .medium))
                    Text("Appleで登録")
                        .font(DesignTokens.Typography.bodyEmphasized)
                }
                .foregroundStyle(DesignTokens.Colors.textPrimary)
                .frame(maxWidth: .infinity)
                .frame(height: fieldHeight)
                .overlay(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero).stroke(DesignTokens.Colors.borderSubtle, lineWidth: 1))
            }
            .buttonStyle(.plain)

            Button {
                pendingFeatureMessage = "Googleで登録は準備中です。もうしばらくお待ちください。"
            } label: {
                HStack(spacing: 8) {
                    Image("GoogleLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 18, height: 18)
                    Text("Googleで登録")
                        .font(DesignTokens.Typography.bodyEmphasized)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                }
                .frame(maxWidth: .infinity)
                .frame(height: fieldHeight)
                .overlay(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero).stroke(DesignTokens.Colors.borderSubtle, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    /// Shown instead of `headingBlock`/`formPanel` once Supabase accepts the
    /// sign-up but email confirmation is still pending — there's nothing
    /// left to submit on this screen, so the form disappears rather than
    /// staying visible (and submittable again) behind a success message.
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
