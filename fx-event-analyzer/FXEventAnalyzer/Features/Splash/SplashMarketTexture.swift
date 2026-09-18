import SwiftUI

/// SCR-000 Splash's lower-background decoration — the Reference shows a
/// 3D wireframe grid draped over a curved "hill" surface (lines running
/// in two directions, like a woven net, not simple stacked horizontal
/// waves), glowing brightest along its ridge, with a faint upward-
/// trending candlestick chart rising through the upper-right. Like
/// Home's `HeroMapTexture`, this app has no real chart-data source to
/// draw from at Splash time (nothing is fetched yet), so this is a
/// deliberate best-effort decorative approximation — a deterministic
/// wireframe/candlestick pattern, not real market data — disclosed as
/// such rather than claimed pixel-exact.
struct SplashMarketTexture: View {
    var body: some View {
        ZStack {
            candles
                .blur(radius: 1.5)
            grid
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// The surface's curve at a given x (0...1) and row depth t (0 = the
    /// ridge/nearest row, 1 = the furthest row either direction) — a
    /// single rise-then-fall hill, matching the Reference's one clear
    /// crossing point rather than a repeating sine wave.
    private func surfaceY(x: Double, rowT: Double, size: CGSize) -> Double {
        let ridge = size.height * 0.68
        let spread = rowT * size.height * 0.22
        // Hill shape: peaks left-of-center, falls off toward the edges —
        // an asymmetric tilt (not a symmetric dome) to match the
        // Reference's diagonally-flowing surface.
        let hill = cos((x - 0.42) * .pi) * size.height * 0.05
        let tilt = (x - 0.5) * size.height * 0.03
        return ridge + spread - hill + tilt
    }

    private var grid: some View {
        Canvas { context, size in
            let rowCount = 9
            let colCount = 22

            // Grid points[row][col].
            var points: [[CGPoint]] = []
            for row in 0..<rowCount {
                let rowT = Double(row) / Double(rowCount - 1) // 0 = ridge, 1 = far edge
                var rowPoints: [CGPoint] = []
                for col in 0...colCount {
                    let x = Double(col) / Double(colCount)
                    let y = surfaceY(x: x, rowT: rowT, size: size)
                    rowPoints.append(CGPoint(x: x * size.width, y: y))
                }
                points.append(rowPoints)
            }

            func opacity(forRowT rowT: Double) -> Double {
                0.03 + (1 - rowT) * 0.35
            }

            // Row lines (the curved "contour" lines of the hill).
            for (row, rowPoints) in points.enumerated() {
                let rowT = Double(row) / Double(rowCount - 1)
                var path = Path()
                path.addLines(rowPoints)
                let op = opacity(forRowT: rowT)
                if row == 0 {
                    // Ridge line: bright glow, wide soft stroke under a thin core.
                    context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(0.3)), lineWidth: 7)
                    context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(0.85)), lineWidth: 1.5)
                } else {
                    context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(op)), lineWidth: 1)
                }
            }

            // Column lines (crossing the rows, forming the woven-net look).
            for col in stride(from: 0, through: colCount, by: 2) {
                var path = Path()
                for (row, rowPoints) in points.enumerated() {
                    let point = rowPoints[col]
                    if row == 0 {
                        path.move(to: point)
                    } else {
                        path.addLine(to: point)
                    }
                }
                context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(0.08)), lineWidth: 1)
            }

            // Bright radial hotspot at the ridge's peak, matching the
            // Reference's glowing "light source" where the surface crests.
            let peakX = 0.42 * size.width
            let peakY = surfaceY(x: 0.42, rowT: 0, size: size)
            let peak = CGPoint(x: peakX, y: peakY)
            let glowRadius = size.width * 0.22
            context.fill(
                Path(ellipseIn: CGRect(x: peak.x - glowRadius, y: peak.y - glowRadius, width: glowRadius * 2, height: glowRadius * 2)),
                with: .radialGradient(
                    Gradient(colors: [DesignTokens.Colors.accentCyan.opacity(0.35), .clear]),
                    center: peak,
                    startRadius: 0,
                    endRadius: glowRadius
                )
            )
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
            let baseline = size.height * 0.68
            for index in 0..<candleCount {
                let progress = Double(index) / Double(candleCount - 1)
                let trendHeight = size.height * (0.03 + 0.16 * progress)
                let jitter = (nextUnit() - 0.5) * size.height * 0.035
                let bodyHeight = max(4, trendHeight + jitter)
                let x = candleSlot * (Double(index) + 0.5)
                let bodyWidth = candleSlot * 0.3
                let wickHeight = bodyHeight * (1.3 + nextUnit() * 0.4)

                var wick = Path()
                wick.move(to: CGPoint(x: x, y: baseline))
                wick.addLine(to: CGPoint(x: x, y: baseline - wickHeight))
                context.stroke(wick, with: .color(DesignTokens.Colors.accentCyan.opacity(0.35)), lineWidth: 1)

                let bodyRect = CGRect(x: x - bodyWidth / 2, y: baseline - bodyHeight, width: bodyWidth, height: bodyHeight)
                context.fill(Path(roundedRect: bodyRect, cornerRadius: 1), with: .color(DesignTokens.Colors.accentCyan.opacity(0.55)))
            }
        }
    }
}
