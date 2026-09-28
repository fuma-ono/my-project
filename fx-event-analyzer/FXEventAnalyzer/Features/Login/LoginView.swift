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
///
/// User feedback round (2026-09-28), after the pixel-match above was
/// confirmed: (1) background/brand-mark size/"FX" colors should match
/// `SplashView` exactly, not just approximate it — moved the underlying
/// values to shared `DesignTokens.Colors` tokens (`brandBackgroundGradient`,
/// `brandTitleAccentF`/`X`) that both screens now reference, and the brand
/// mark now uses Splash's fixed `140` width instead of a screen-fraction
/// size. (2) The login button's `accentGradient` fill read too cyan next
/// to the Reference's fairly uniform blue (measured (63,142,245)→
/// (52,120,244), no real cyan pull) — switched to a flat `accentPrimary`
/// fill. (3) Apple/Google sign-in, which the Reference doesn't show at
/// all — added, wired to the same "準備中" alert as every other
/// not-yet-implemented action here, since `AuthServicing` has no
/// social-auth method yet either (ui-screens.md: "認証方式は別途詳細設計で
/// 確定する"). First placed below the email/password form; follow-up
/// feedback moved it above instead — social sign-in first, an "または"
/// divider, then the traditional email/password form below it.
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
                DesignTokens.Colors.brandBackgroundGradient.ignoresSafeArea()

                // Adding Apple/Google sign-in meaningfully grew this
                // screen's content height past what a fixed, non-scrolling
                // VStack safely fits on shorter devices (iPhone SE-class) —
                // wrapped in a ScrollView so everything stays reachable
                // there instead of risking the bottom rows clipping off.
                //
                // User feedback (2026-09-28): the top gap above the brand
                // mark (0.165 — the Reference's own measurement, tuned back
                // when this screen was just brand mark + form) read as too
                // much empty space once Apple/Google sign-in made the form
                // itself much taller, and pushed "新規登録" below the fold
                // where it read as missing rather than just scrolled past.
                // Cut every vertical gap on this screen (top offset, inter-
                // element padding, control height) so the whole thing —
                // brand mark through "新規登録" — fits in view without
                // scrolling on ordinary devices; the ScrollView stays as a
                // safety net for shorter ones instead of the primary way
                // to reach the bottom.
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        BrandMark(width: 140, glow: true)
                            .padding(.top, geometry.size.height * 0.05)

                        titleText
                            .padding(.top, geometry.size.height * 0.015)

                        if sessionExpired {
                            sessionExpiredBanner
                                .padding(.top, geometry.size.height * 0.02)
                                .padding(.horizontal, DesignTokens.Spacing.lg)
                        }

                        formPanel(controlHeight: geometry.size.height * 0.062)
                            .padding(.top, geometry.size.height * 0.02)
                            .padding(.horizontal, DesignTokens.Spacing.lg)
                            .padding(.bottom, DesignTokens.Spacing.lg)
                    }
                    .frame(width: geometry.size.width)
                }
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
            Text("F")
                .foregroundStyle(DesignTokens.Colors.brandTitleAccentF)
                + Text("X")
                .foregroundStyle(DesignTokens.Colors.brandTitleAccentX)
                + Text(" Event Analyzer")
                .foregroundStyle(DesignTokens.Colors.textPrimary)
        )
        .font(DesignTokens.Typography.splashTitle)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }

    private func formPanel(controlHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // User feedback (2026-09-28): social sign-in read oddly stuck
            // at the bottom of the screen below everything else — moved to
            // the top of the form, above the email/password fields, the
            // more common placement for "or sign in with a provider"
            // (decide fast with one tap, or fall through to the
            // traditional form below).
            socialSignInSection(controlHeight: controlHeight)

            HStack(spacing: 12) {
                Rectangle().fill(DesignTokens.Colors.borderSubtle).frame(height: 1)
                Text("または")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                    .fixedSize()
                Rectangle().fill(DesignTokens.Colors.borderSubtle).frame(height: 1)
            }
            .padding(.top, 16)

            Text("メールアドレス")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
                .padding(.top, 16)
            // `TextField`'s own `prompt:` parameter, and later a manual
            // placeholder attached via `.overlay` directly on the field,
            // were both confirmed via real CI captures to render in the
            // environment's accent color regardless of explicit
            // `.foregroundStyle` — content layered directly onto this
            // control's own modifier chain inherits its tint on this OS
            // version no matter how it's styled. Placing the placeholder
            // `Text` as a plain ZStack *sibling* of the TextField, instead
            // of attached to it via `.overlay`, avoids that inheritance
            // entirely: it renders in its own explicit style like any
            // other Text. `TextField`'s own titleKey is "" rather than a
            // real label — that string doubles as its built-in
            // placeholder, which would otherwise render (in the same
            // accent color) underneath this one — the accessibility label
            // below supplies the real label instead.
            ZStack(alignment: .leading) {
                if viewModel.email.isEmpty {
                    // `Text(verbatim:)`, not the default `Text(_:)` — a
                    // real CI capture showed only this placeholder (of the
                    // two on this screen) still rendering in the
                    // environment's accent color even after the ZStack
                    // restructuring, while "パスワードを入力" right below
                    // it, built exactly the same way, rendered correctly.
                    // The one difference: this string is shaped like an
                    // email address. `Text(_:)` parses a string literal as
                    // `LocalizedStringKey`, which on this OS version
                    // evidently auto-detects and links email-shaped
                    // substrings the same way system text views do —
                    // `Text(verbatim:)` skips that parsing entirely and
                    // renders the literal string with no such detection.
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
                    // Kept directly on the TextField (not the ZStack
                    // wrapper) so it stays an XCUITest `textFields[...]`
                    // element rather than becoming an opaque `.other`.
                    .accessibilityLabel("メールアドレス")
                    .focused($focusedField, equals: .email)
            }
            .frame(height: controlHeight)
            .background(DesignTokens.Colors.backgroundElevated, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
            .onTapGesture { focusedField = .email }
            .padding(.top, 6)

            Text("パスワード")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
                .padding(.top, 14)
            ZStack(alignment: .leading) {
                if viewModel.password.isEmpty {
                    Text("パスワードを入力")
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
            .onTapGesture { focusedField = .password }
            .padding(.top, 6)

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
                // Was `accentGradient` — a real capture showed it pulling
                // visibly toward cyan next to the Reference's own button,
                // which is a fairly uniform blue (measured (63,142,245) on
                // the left down to (52,120,244) on the right, no real cyan
                // shift). A flat `accentPrimary` fill matches that.
                .background(DesignTokens.Colors.accentPrimary, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.canSubmit)
            .opacity(viewModel.canSubmit ? 1 : 0.5)
            .padding(.top, 20)
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
            .padding(.top, 16)

            Rectangle()
                .fill(DesignTokens.Colors.borderSubtle)
                .frame(height: 1)
                .padding(.top, 14)

            Text("アカウントをお持ちでない方")
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.top, 18)
            Button {
                pendingFeatureMessage = "新規登録は準備中です。もうしばらくお待ちください。"
            } label: {
                Text("新規登録")
                    .font(DesignTokens.Typography.bodyEmphasized)
                    .foregroundStyle(DesignTokens.Colors.accentCyan)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
    }

    /// Not in the Reference at all — added per explicit user request.
    /// `AuthServicing` has no social-auth method yet (ui-screens.md: "認証
    /// 方式は別途詳細設計で確定する"), so both buttons are wired to the
    /// same "準備中" alert every other not-yet-implemented action on this
    /// screen already uses, rather than silently doing nothing.
    private func socialSignInSection(controlHeight: CGFloat) -> some View {
        VStack(spacing: 12) {
            Button {
                pendingFeatureMessage = "Appleでサインインは準備中です。もうしばらくお待ちください。"
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "apple.logo")
                        .font(.system(size: 17, weight: .medium))
                    Text("Appleでサインイン")
                        .font(DesignTokens.Typography.bodyEmphasized)
                }
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .frame(height: controlHeight)
                .background(Color.white, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
            }
            .buttonStyle(.plain)

            Button {
                pendingFeatureMessage = "Googleでサインインは準備中です。もうしばらくお待ちください。"
            } label: {
                HStack(spacing: 8) {
                    Text("G")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(DesignTokens.Colors.accentPrimary)
                    Text("Googleでサインイン")
                        .font(DesignTokens.Typography.bodyEmphasized)
                        .foregroundStyle(DesignTokens.Colors.textPrimary)
                }
                .frame(maxWidth: .infinity)
                .frame(height: controlHeight)
                .background(DesignTokens.Colors.backgroundElevated, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero))
                .overlay(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.hero).stroke(DesignTokens.Colors.borderSubtle, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
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
