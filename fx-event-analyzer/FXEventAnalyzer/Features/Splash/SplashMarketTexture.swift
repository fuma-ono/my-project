import SwiftUI

/// SCR-000 Splash's lower-background decoration — the Reference shows a
/// crisp, glowing two-tone candlestick chart (bright cyan "up" candles,
/// darker blue "down" candles, bright cyan wicks — not blurred/blended)
/// rising left-to-right, crossed by 2-3 bright flowing curve lines in an
/// X pattern. Not a dense wireframe grid — a plainer, brighter
/// composition than that. Like Home's `HeroMapTexture`, this app has no
/// real chart-data source to draw from at Splash time (nothing is
/// fetched yet), so this is a deliberate best-effort decorative
/// approximation — a deterministic candlestick/curve pattern, not real
/// market data — disclosed as such rather than claimed pixel-exact.
struct SplashMarketTexture: View {
    var body: some View {
        ZStack {
            curves
            candles
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Two to three bright flowing curves crossing in an X, not a dense
    /// grid — matches the Reference's plainer, brighter composition.
    private var curves: some View {
        Canvas { context, size in
            struct Curve {
                let startY: Double
                let endY: Double
                let amplitude: Double
                let phase: Double
                let opacityCore: Double
                let opacityGlow: Double
                let width: CGFloat
            }
            let curveDefs = [
                Curve(startY: 0.62, endY: 0.50, amplitude: 0.05, phase: 0, opacityCore: 0.55, opacityGlow: 0.18, width: 1.5),
                Curve(startY: 0.82, endY: 0.55, amplitude: 0.07, phase: 1.6, opacityCore: 0.4, opacityGlow: 0.12, width: 1.2),
                Curve(startY: 0.58, endY: 0.78, amplitude: 0.04, phase: 3.0, opacityCore: 0.25, opacityGlow: 0.08, width: 1),
            ]

            for curve in curveDefs {
                var path = Path()
                let steps = 40
                for step in 0...steps {
                    let t = Double(step) / Double(steps)
                    let x = t * size.width
                    let base = curve.startY + (curve.endY - curve.startY) * t
                    let wave = sin(t * .pi * 1.3 + curve.phase) * curve.amplitude
                    let y = (base + wave) * size.height
                    if step == 0 {
                        path.move(to: CGPoint(x: x, y: y))
                    } else {
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                }
                context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(curve.opacityGlow)), lineWidth: curve.width * 5)
                context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(curve.opacityCore)), lineWidth: curve.width)
            }
        }
    }

    private var candles: some View {
        Canvas { context, size in
            var seed: UInt64 = 0xD1B5_4A32_9E77_1C03
            func nextUnit() -> Double {
                seed ^= seed << 13
                seed ^= seed >> 7
                seed ^= seed << 17
                return Double(seed % 1000) / 1000
            }

            let candleCount = 16
            let candleSlot = size.width / Double(candleCount)
            let baseline = size.height * 0.87
            for index in 0..<candleCount {
                let progress = Double(index) / Double(candleCount - 1)
                let trendHeight = size.height * (0.03 + 0.2 * progress)
                let jitter = (nextUnit() - 0.5) * size.height * 0.04
                let bodyHeight = max(6, trendHeight + jitter)
                let x = candleSlot * (Double(index) + 0.5)
                let bodyWidth = candleSlot * 0.4
                let wickHeight = bodyHeight * (1.3 + nextUnit() * 0.4)
                // Two-tone: mostly bright "up" candles on this rising
                // trend, with some darker ones mixed in, per the
                // Reference — decided per-candle, not fabricated data.
                let isBright = nextUnit() > 0.35

                var wick = Path()
                wick.move(to: CGPoint(x: x, y: baseline))
                wick.addLine(to: CGPoint(x: x, y: baseline - wickHeight))
                context.stroke(wick, with: .color(DesignTokens.Colors.accentCyan.opacity(0.55)), lineWidth: 1)

                let bodyRect = CGRect(x: x - bodyWidth / 2, y: baseline - bodyHeight, width: bodyWidth, height: bodyHeight)
                let bodyPath = Path(roundedRect: bodyRect, cornerRadius: 1.5)
                if isBright {
                    context.stroke(bodyPath, with: .color(DesignTokens.Colors.accentCyan.opacity(0.4)), lineWidth: 4)
                    context.fill(bodyPath, with: .color(DesignTokens.Colors.accentCyan.opacity(0.85)))
                } else {
                    context.fill(bodyPath, with: .color(DesignTokens.Colors.accentPrimary.opacity(0.6)))
                }
            }
        }
    }
}
