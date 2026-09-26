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
    @State private var animate = false

    private let trackHeight: CGFloat = 4
    private let segmentWidthFraction: CGFloat = 0.4

    var body: some View {
        GeometryReader { geometry in
            let segmentWidth = geometry.size.width * segmentWidthFraction
            Capsule()
                .fill(DesignTokens.Colors.textSecondary.opacity(0.2))
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(DesignTokens.Colors.accentGradient)
                        .frame(width: segmentWidth)
                        .shadow(color: DesignTokens.Colors.accentCyan.opacity(0.7), radius: 4)
                        .offset(x: animate ? geometry.size.width - segmentWidth : 0)
                }
        }
        .frame(width: 220, height: trackHeight)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                animate = true
            }
        }
    }
}
