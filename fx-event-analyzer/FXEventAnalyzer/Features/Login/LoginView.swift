import SwiftUI

/// SCR-010 Login (ui-screens.md).
///
/// Direction change (2026-09-28): rebuilt against a dedicated reference
/// image (`docs/projects/fx-event-analyzer/mockups/login-screen-reference-v1.jpg`)
/// the same way `SplashView` already was — literal reproduction, measured
/// pixel-by-pixel off the Reference and expressed as fractions of screen
/// width/height, not the fixed-canvas `V5Viewport`/`V5P` system the rest of
/// the app (Home/Indicators/etc.) still uses. That system renders this
/// screen's fields/button at a tiny virtual size (204×139pt canvas, 7–9pt
/// fonts) and scales the whole thing up, which is also known to break
/// XCUITest focus synthesis on `TextField`/`SecureField` — the
/// `@FocusState` + `.onTapGesture` workaround below predates this rewrite
/// and is kept for the same reason.
///
/// Reference measurements (of the 883×1579 reference image, as fractions):
/// brand mark top 0.165 / width 0.238 (centered); title top 0.291; email
/// field top 0.410 / height 0.069; password field top 0.527 (same height);
/// button top 0.626 (same height); "パスワードをお忘れの方" ~0.741; divider
/// ~0.776; "アカウントをお持ちでない方" ~0.823; "新規登録" ~0.868. Side
/// margin measured at ~8.4% of width, close enough to `DesignTokens.
/// Spacing.lg` (24pt) to reuse that shared token rather than a one-off
/// value. Colors were sampled directly off the Reference and matched
/// against existing `DesignTokens` colorsets rather than hardcoded
/// literals where the match was close (accentCyan for the "FX"/link cyan,
/// accentPrimary for the button's blue, backgroundElevated for the field
/// fill) — the Reference's own glowing-text bloom reads brighter than the
/// flat token, but that's the JPEG's bloom/blur, not a distinct color.
///
/// The Reference draws a small icon (reads as a stylized camera) inside
/// the password field with no visible function of its own in the mockup —
/// reproduced as `camera.viewfinder` (closest SF Symbol match) wired to
/// the same "準備中" placeholder alert as "パスワードをお忘れの方"/
/// "新規登録" below, since no such feature exists yet either.
struct LoginView: View {
    @StateObject private var viewModel: LoginViewModel
    let sessionExpired: Bool
    @State private var pendingFeatureMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field {
        case email, password
    }

    init(viewModel: @autoclosure @escaping () -> LoginViewModel, sessionExpired: Bool = false) {
        _viewModel = StateObject(wrappedValue: viewModel())
        self.sessionExpired = sessionExpired
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()

                VStack(spacing: 0) {
                    BrandMark(width: geometry.size.width * 0.238, glow: true)
                        .padding(.top, geometry.size.height * 0.165)

                    titleText
                        .padding(.top, geometry.size.height * 0.028)

                    if sessionExpired {
                        sessionExpiredBanner
                            .padding(.top, geometry.size.height * 0.02)
                            .padding(.horizontal, DesignTokens.Spacing.lg)
                    }

                    formPanel(controlHeight: geometry.size.height * 0.07)
                        .padding(.top, geometry.size.height * 0.041)
                        .padding(.horizontal, DesignTokens.Spacing.lg)

                    Spacer(minLength: 0)
                }
                .frame(width: geometry.size.width)
            }
        }
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

    private var titleText: some View {
        (
            Text("FX")
                .foregroundStyle(DesignTokens.Colors.accentCyan)
                + Text(" Event Analyzer")
                .foregroundStyle(DesignTokens.Colors.textPrimary)
        )
        .font(DesignTokens.Typography.splashTitle)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }

    private func formPanel(controlHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("メールアドレス")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            TextField("example@domain.com", text: $viewModel.email)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
                .padding(.horizontal, DesignTokens.Spacing.md)
                .frame(height: controlHeight)
                .background(DesignTokens.Colors.backgroundElevated, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
                .accessibilityLabel("メールアドレス")
                .focused($focusedField, equals: .email)
                .onTapGesture { focusedField = .email }
                .padding(.top, 8)

            Text("パスワード")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
                .padding(.top, 20)
            SecureField("パスワードを入力", text: $viewModel.password)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
                .padding(.horizontal, DesignTokens.Spacing.md)
                .frame(height: controlHeight)
                .background(DesignTokens.Colors.backgroundElevated, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
                .overlay(alignment: .trailing) {
                    Button {
                        pendingFeatureMessage = "この機能は準備中です。もうしばらくお待ちください。"
                    } label: {
                        Image(systemName: "camera.viewfinder")
                            .foregroundStyle(DesignTokens.Colors.textSecondary)
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, DesignTokens.Spacing.md)
                }
                .accessibilityLabel("パスワード")
                .focused($focusedField, equals: .password)
                .onTapGesture { focusedField = .password }
                .padding(.top, 8)

            Button {
                viewModel.submit()
            } label: {
                Group {
                    if viewModel.state == .submitting {
                        ProgressView().tint(.white)
                    } else {
                        Text("ログイン")
                            .font(DesignTokens.Typography.bodyEmphasized)
                            .foregroundStyle(.white)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: controlHeight)
                .background(DesignTokens.Colors.accentGradient, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.canSubmit)
            .opacity(viewModel.canSubmit ? 1 : 0.5)
            .padding(.top, 28)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .bottom) {
                if case .error(let message) = viewModel.state {
                    Text(message)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.statusError)
                        .multilineTextAlignment(.center)
                        .padding(.top, 6)
                        .offset(y: controlHeight * 0.6)
                }
            }

            Button {
                pendingFeatureMessage = "パスワードリセットは準備中です。もうしばらくお待ちください。"
            } label: {
                Text("パスワードをお忘れの方")
                    .font(DesignTokens.Typography.captionEmphasized)
                    .foregroundStyle(DesignTokens.Colors.accentCyan)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .padding(.top, 24)

            Rectangle()
                .fill(DesignTokens.Colors.borderSubtle)
                .frame(height: 1)
                .padding(.top, 20)

            Text("アカウントをお持ちでない方")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.top, 26)
            Button {
                pendingFeatureMessage = "新規登録は準備中です。もうしばらくお待ちください。"
            } label: {
                Text("新規登録")
                    .font(DesignTokens.Typography.bodyEmphasized)
                    .foregroundStyle(DesignTokens.Colors.accentCyan)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
    }

    private var sessionExpiredBanner: some View {
        VStack(spacing: 4) {
            Text("セッションの有効期限が切れています")
                .font(DesignTokens.Typography.captionEmphasized)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Text("再度ログインしてください")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(DesignTokens.Spacing.sm)
        .background(DesignTokens.Colors.statusError.opacity(0.12), in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control))
        .overlay(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control).stroke(DesignTokens.Colors.statusError.opacity(0.3), lineWidth: 1))
    }
}
