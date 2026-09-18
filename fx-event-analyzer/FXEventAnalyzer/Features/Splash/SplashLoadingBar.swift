import SwiftUI

/// SCR-000 Splash's loading indicator — the Reference shows a thin rounded
/// progress track with a blue→cyan fill, not a spinner (`LoadingView`'s
/// `ProgressView()`, used everywhere else in the app, is a distinct,
/// intentionally different treatment for Splash specifically). Splash's
/// own init sequence (`SplashViewModel`) has no real fractional-progress
/// value to report — it is a handful of async steps, not a measurable
/// download — so this animates an indeterminate sliding segment rather
/// than fabricating a fake percentage.
struct SplashLoadingBar: View {
    var caption: String = "Loading..."

    @State private var animate = false

    private let trackHeight: CGFloat = 4
    private let segmentWidthFraction: CGFloat = 0.4

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.sm) {
            GeometryReader { geometry in
                let segmentWidth = geometry.size.width * segmentWidthFraction
                Capsule()
                    .fill(DesignTokens.Colors.textSecondary.opacity(0.2))
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(DesignTokens.Colors.accentGradient)
                            .frame(width: segmentWidth)
                            .offset(x: animate ? geometry.size.width - segmentWidth : 0)
                    }
            }
            .frame(height: trackHeight)

            Text(caption)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
        }
        .frame(width: 160)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                animate = true
            }
        }
    }
}
