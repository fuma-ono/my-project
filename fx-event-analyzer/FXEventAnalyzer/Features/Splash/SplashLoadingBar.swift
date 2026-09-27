import SwiftUI

/// SCR-000 Splash's loading indicator — the Reference shows a thin rounded
/// progress track with a blue→cyan fill, not a spinner (`LoadingView`'s
/// `ProgressView()`, used everywhere else in the app, is a distinct,
/// intentionally different treatment for Splash specifically).
///
/// HQ correction: this previously animated an indeterminate sliding
/// segment that bounced back and forth for as long as Splash stayed on
/// screen, reasoned from `SplashViewModel` having no real fractional-
/// progress value to report. That read as "always there", not "a loading
/// feature" — HQ's intent is a one-shot fill that starts empty, climbs to
/// full once, and Splash is gone (`AppState` swaps it out on
/// `SplashViewModel.onFinished`, ui-screens.md SCR-000) at or soon after
/// it completes, not a loop that runs indefinitely. There is still no
/// real progress fraction to drive it from, so the fill's own duration is
/// a fixed, tuned estimate of a typical init sequence rather than a
/// measured value — but it now plays once forward, never reverses, and
/// never repeats.
struct SplashLoadingBar: View {
    @State private var fillFraction: CGFloat = 0

    private let trackHeight: CGFloat = 4

    var body: some View {
        GeometryReader { geometry in
            Capsule()
                .fill(DesignTokens.Colors.textSecondary.opacity(0.2))
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(DesignTokens.Colors.accentGradient)
                        .frame(width: geometry.size.width * fillFraction)
                        .shadow(color: DesignTokens.Colors.accentCyan.opacity(0.7), radius: 4)
                }
        }
        .frame(width: 220, height: trackHeight)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.6)) {
                fillFraction = 1
            }
        }
    }
}
