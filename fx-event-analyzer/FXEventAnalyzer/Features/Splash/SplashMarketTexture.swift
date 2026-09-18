import SwiftUI

/// SCR-000 Splash's lower-background decoration — the Reference shows an
/// upward-trending candlestick chart, blurred/glowing enough that at
/// normal viewing scale it reads as a soft trending silhouette rather
/// than crisp individual bars, over a bright glowing wireframe "market
/// surface" wave in the foreground. Like Home's `HeroMapTexture`, this
/// app has no real chart-data source to draw from at Splash time
/// (nothing is fetched yet), so this is a deliberate best-effort
/// decorative approximation — a deterministic candlestick/mesh pattern,
/// not real market data — disclosed as such rather than claimed
/// pixel-exact.
struct SplashMarketTexture: View {
    var body: some View {
        ZStack {
            // Candles first, blurred so they blend into a soft rising
            // shape instead of reading as distinct blocky bars.
            candles
                .blur(radius: 5)

            // Mesh drawn sharp on top, with the frontmost wave boosted to
            // a bright glow to match the Reference's neon-like foreground
            // curve.
            mesh
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var mesh: some View {
        Canvas { context, size in
            let meshLines = 7
            for lineIndex in 0..<meshLines {
                let t = Double(lineIndex) / Double(meshLines - 1)
                // t=0 is the frontmost (bottom, nearest) line.
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
                if lineIndex == 0 {
                    // Frontmost wave: bright glow (wide soft stroke underneath
                    // a thin bright core), matching the Reference's
                    // neon-like foreground curve.
                    context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(0.25)), lineWidth: 8)
                    context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(0.9)), lineWidth: 1.5)
                } else {
                    let opacity = 0.04 + (1 - t) * 0.05
                    context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(opacity)), lineWidth: 1)
                }
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
            let baseline = size.height * 0.76
            for index in 0..<candleCount {
                let progress = Double(index) / Double(candleCount - 1)
                let trendHeight = size.height * (0.04 + 0.15 * progress)
                let jitter = (nextUnit() - 0.5) * size.height * 0.04
                let bodyHeight = max(6, trendHeight + jitter)
                let x = candleSlot * (Double(index) + 0.5)
                let bodyWidth = candleSlot * 0.45
                let wickHeight = bodyHeight * (1.2 + nextUnit() * 0.3)

                var wick = Path()
                wick.move(to: CGPoint(x: x, y: baseline))
                wick.addLine(to: CGPoint(x: x, y: baseline - wickHeight))
                context.stroke(wick, with: .color(DesignTokens.Colors.accentCyan.opacity(0.14)), lineWidth: 1)

                let bodyRect = CGRect(x: x - bodyWidth / 2, y: baseline - bodyHeight, width: bodyWidth, height: bodyHeight)
                context.fill(Path(roundedRect: bodyRect, cornerRadius: 1), with: .color(DesignTokens.Colors.accentPrimary.opacity(0.28)))
            }
        }
    }
}
