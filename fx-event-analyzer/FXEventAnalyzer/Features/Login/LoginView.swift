import SwiftUI

/// SCR-001 ログイン画面。
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
        // 2026-09-29 HQ承認(2-b): SCR-002/SCR-003(仮画面)への遷移を確認できる
        // ようにするため、`NavigationStack`でラップした(ナビゲーションバーは
        // 非表示のまま — 見た目は変更していない)。
        NavigationStack {
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
                        // User feedback (2026-09-28): the brand mark/title
                        // block still read as too close to the status bar —
                        // nudged its top offset down further (0.05 -> 0.08).
                        // Still too much leftover blank space below "新規
                        // 登録" per follow-up feedback — pushed once more
                        // (0.08 -> 0.11) to absorb more of it, shifting the
                        // whole content block (everything below is laid out
                        // relative to this) further down the screen. Follow-
                        // up: a small nudge back up (0.11 -> 0.09) — see
                        // formPanel's own comment below for how its position
                        // stays fixed despite this.
                        BrandMark(width: 140, glow: true)
                            .padding(.top, geometry.size.height * 0.09)

                        titleText
                            .padding(.top, geometry.size.height * 0.015)

                        if sessionExpired {
                            sessionExpiredBanner
                                .padding(.top, geometry.size.height * 0.02)
                                .padding(.horizontal, DesignTokens.Spacing.lg)
                        }

                        // User feedback: the previous 0.02 tightening left
                        // the whole form (Apple sign-in through 新規登録)
                        // crammed right under the title, with a large empty
                        // gap below it — everything fit on one screen, but
                        // read badly balanced. Real capture showed roughly
                        // a quarter of screen height sitting empty at the
                        // bottom afterward; moved about a third of that
                        // margin up here instead, pushing the whole form
                        // block down toward the middle of that leftover
                        // space rather than leaving it all beneath.
                        //
                        // User feedback (2026-09-28): the brand mark's own
                        // top offset was pushed down twice more after that
                        // (0.05 -> 0.08 -> 0.11) to close the gap to the
                        // status bar, which — since this padding stacks on
                        // top of that in the same VStack — also dragged
                        // "Appleでサインイン" and everything below it down
                        // each time. Explicit follow-up: leave that block's
                        // position alone. Cut this padding by the same 0.03
                        // the brand mark gained (0.09 -> 0.06) so the form's
                        // absolute position on screen is unchanged from
                        // before either of those two nudges.
                        //
                        // Follow-up feedback: now move "Appleでサインイン"
                        // and everything below it up further still — cut
                        // this padding again (0.06 -> 0.03).
                        //
                        // User feedback (2026-09-28): brand mark nudged
                        // back up slightly (0.11 -> 0.09, a 0.02 decrease).
                        // Compensated here (0.03 -> 0.05, a 0.02 increase)
                        // so only the brand mark/title move — "Appleで
                        // サインイン" and everything below stays exactly
                        // where it was, same compensation pattern as above.
                        //
                        // User feedback (2026-10-07): after switching the
                        // form's text to Noto Sans JP (taller line height)
                        // the block sat lower — move "Appleでサインイン" and
                        // everything below it up a little (0.05 -> 0.03).
                        formPanel(controlHeight: geometry.size.height * 0.062)
                            .padding(.top, geometry.size.height * 0.03)
                            .padding(.horizontal, DesignTokens.Spacing.lg)
                            .padding(.bottom, DesignTokens.Spacing.lg)
                    }
                    .frame(width: geometry.size.width)
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(for: AppRoute.self) { route in
            switch route {
            case .signUp:
                PlaceholderScreenView(scrNumber: "SCR-002", screenName: "新規会員登録")
                    .navigationTitle("新規会員登録")
                    .navigationBarTitleDisplayMode(.inline)
            case .passwordReset:
                PlaceholderScreenView(scrNumber: "SCR-003", screenName: "パスワード再設定")
                    .navigationTitle("パスワード再設定")
                    .navigationBarTitleDisplayMode(.inline)
            default:
                EmptyView()
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
                NotoText.text("または", size: 15)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                    .fixedSize()
                Rectangle().fill(DesignTokens.Colors.borderSubtle).frame(height: 1)
            }
            .padding(.top, 16)

            NotoText.text("メールアドレス", size: 15)
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

            NotoText.text("パスワード", size: 15)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
                .padding(.top, 14)
            ZStack(alignment: .leading) {
                if viewModel.password.isEmpty {
                    NotoText.text("パスワードを入力", size: 16)
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
                        NotoText.text("ログイン", size: 16)
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
                    NotoText.text(message, size: 13)
                        .foregroundStyle(DesignTokens.Colors.statusError)
                        .multilineTextAlignment(.center)
                        .padding(.top, 6)
                        .offset(y: controlHeight * 0.6)
                }
            }

            // 2026-09-29 HQ承認(2-b): SCR-003(仮画面)への遷移。ボタンの見た目は
            // 変更していない(アクションを"準備中"アラートから画面遷移に変更のみ)。
            NavigationLink(value: AppRoute.passwordReset) {
                NotoText.text("パスワードをお忘れの方", size: 15)
                    .foregroundStyle(DesignTokens.Colors.accentCyan)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .padding(.top, 16)

            Rectangle()
                .fill(DesignTokens.Colors.borderSubtle)
                .frame(height: 1)
                .padding(.top, 14)

            NotoText.text("アカウントをお持ちでない方", size: 15)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.top, 18)
            // 2026-09-29 HQ承認(2-b): SCR-002(仮画面)への遷移。ボタンの見た目は
            // 変更していない(アクションを"準備中"アラートから画面遷移に変更のみ)。
            NavigationLink(value: AppRoute.signUp) {
                NotoText.text("新規登録", size: 16)
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
                    NotoText.text("Appleでサインイン", size: 16)
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
                    // User-supplied reference (2026-09-28): the flat,
                    // single-color "G" text read as an approximation, not
                    // the real Google mark — replaced with the actual
                    // multi-color Google "G" logo (cropped from the
                    // reference image the user provided, transparent
                    // background) as a real image asset, the same
                    // literal-reproduction approach `BrandMark` already
                    // uses, rather than a self-drawn stand-in.
                    Image("GoogleLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 18, height: 18)
                    NotoText.text("Googleでサインイン", size: 16)
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
            NotoText.text("セッションの有効期限が切れています", size: 13)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            NotoText.text("再度ログインしてください", size: 13)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(DesignTokens.Spacing.sm)
        .background(DesignTokens.Colors.statusError.opacity(0.12), in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control))
        .overlay(RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control).stroke(DesignTokens.Colors.statusError.opacity(0.3), lineWidth: 1))
    }
}
