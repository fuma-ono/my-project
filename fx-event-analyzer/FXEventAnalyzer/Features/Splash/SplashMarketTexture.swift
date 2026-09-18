import SwiftUI

/// SCR-000 Splash's lower-background decoration — the Reference shows a
/// faint upward-trending candlestick chart silhouette over a wireframe
/// "market surface" mesh, fading in from the bottom. Like Home's
/// `HeroMapTexture`, this app has no real chart-data source to draw from
/// at Splash time (nothing is fetched yet), so this is a deliberate
/// best-effort decorative approximation — a deterministic candlestick/mesh
/// pattern, not real market data — disclosed as such rather than claimed
/// pixel-exact.
struct SplashMarketTexture: View {
    var body: some View {
        Canvas { context, size in
            var seed: UInt64 = 0xD1B5_4A32_9E77_1C03
            func nextUnit() -> Double {
                seed ^= seed << 13
                seed ^= seed >> 7
                seed ^= seed << 17
                return Double(seed % 1000) / 1000
            }

            // Wireframe mesh: a handful of horizontal wave lines, closer
            // together and dimmer toward the bottom to suggest a surface
            // receding away from the viewer.
            let meshLines = 7
            for lineIndex in 0..<meshLines {
                let t = Double(lineIndex) / Double(meshLines - 1)
                let y = size.height * (0.5 + 0.28 * t)
                let amplitude = 10.0 + 18.0 * t
                var path = Path()
                let steps = 40
                for step in 0...steps {
                    let x = size.width * Double(step) / Double(steps)
                    let phase = Double(lineIndex) * 0.6
                    let wave = sin(Double(step) / 5.0 + phase) * amplitude
                    let point = CGPoint(x: x, y: y + wave)
                    if step == 0 {
                        path.move(to: point)
                    } else {
                        path.addLine(to: point)
                    }
                }
                let opacity = 0.05 + (1 - t) * 0.07
                context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(opacity)), lineWidth: 1)
            }

            // Upward-trending candlesticks along the bottom edge.
            let candleCount = 16
            let candleSlot = size.width / Double(candleCount)
            let baseline = size.height * 0.76
            for index in 0..<candleCount {
                let progress = Double(index) / Double(candleCount - 1)
                let trendHeight = size.height * (0.06 + 0.26 * progress)
                let jitter = (nextUnit() - 0.5) * size.height * 0.08
                let bodyHeight = max(6, trendHeight + jitter)
                let x = candleSlot * (Double(index) + 0.5)
                let bodyWidth = candleSlot * 0.45
                let wickHeight = bodyHeight * (1.2 + nextUnit() * 0.3)

                var wick = Path()
                wick.move(to: CGPoint(x: x, y: baseline))
                wick.addLine(to: CGPoint(x: x, y: baseline - wickHeight))
                context.stroke(wick, with: .color(DesignTokens.Colors.accentCyan.opacity(0.18)), lineWidth: 1)

                let bodyRect = CGRect(x: x - bodyWidth / 2, y: baseline - bodyHeight, width: bodyWidth, height: bodyHeight)
                context.fill(Path(roundedRect: bodyRect, cornerRadius: 1), with: .color(DesignTokens.Colors.accentPrimary.opacity(0.22)))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
