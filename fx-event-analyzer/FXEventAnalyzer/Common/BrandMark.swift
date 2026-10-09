import SwiftUI

/// Splash's (SCR-000) brand mark — HQ's "Reference画像の完全再現" instruction
/// (2026-09-18, App Icon + Splash round) is explicit: reproduce
/// `docs/projects/fx-event-analyzer/mockups/{app-icon,splash-screen}-reference-v1.png`
/// as given, not a self-designed stand-in. This used to be a programmatic
/// SF Symbol placeholder on a gradient square — HQ rejected that approach
/// outright ("自分で作成するのではなく画像を真似ろ"). `BrandMarkGraphic` is
/// the zigzag-chart/uptrend-arrow mark cropped directly out of the
/// Reference App Icon image (both Reference images use the same mark), so
/// this renders the actual Reference artwork rather than an interpretation
/// of it.
struct BrandMark: View {
    var width: CGFloat = 132
    /// Splash's and Login's own References both show a soft glow behind
    /// the mark; other, smaller inline usages don't — scoped per call
    /// site rather than changing this shared component's look everywhere.
    var glow: Bool = false

    var body: some View {
        Image("BrandMarkGraphic")
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: width)
            .shadow(color: glow ? DesignTokens.Colors.accentCyan.opacity(0.55) : .clear, radius: glow ? width * 0.15 : 0)
            .accessibilityLabel("FX Event Analyzer")
    }
}

/// The "FX Event Analyzer" wordmark that sits below `BrandMark` on every
/// screen that shows the full brand lockup (Splash, Login, SignUp,
/// PasswordReset) — same accent-colored "F"/"X" + primary-colored
/// " Event Analyzer" treatment everywhere, factored out of `LoginView`
/// (HQ指示 2026-10-09、SignUp/PasswordReset画面のReference再現) so the
/// three screens share one definition instead of three copies.
struct BrandTitleText: View {
    var body: some View {
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
}
