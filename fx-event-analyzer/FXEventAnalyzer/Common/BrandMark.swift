import SwiftUI

/// Programmatic placeholder brand mark for Splash (SCR-000).
///
/// This is deliberately NOT the final App Icon/logo — HQ's instruction was
/// explicit: reproduce the *direction* of
/// `docs/projects/fx-event-analyzer/mockups/splash-screen-reference-v1.png`
/// (layout, background, brand mark, typography, loading, spacing) in
/// SwiftUI rather than embedding the reference image as a screen
/// background, and the "フルロゴ版" vs "シンボル版" App Icon choice is
/// still undecided (ui-screens.md 9.3節). An SF Symbol standing in for an
/// FX/market-chart uptrend glyph, on the same blue→cyan gradient used for
/// `AppIcon`'s color direction, satisfies both constraints without
/// prejudging the final design.
struct BrandMark: View {
    var size: CGFloat = 96

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
            .fill(DesignTokens.Colors.accentGradient)
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: size * 0.44, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .accessibilityLabel("FX Event Analyzer")
    }
}
