import SwiftUI

/// SCR-000 Splash's lower-background decoration. Pixel-sampled directly
/// from the Reference (not guessed): candle bodies read around
/// RGB(30,70,135) against a RGB(5,15,30)-ish background — dim, desaturated
/// steel-blue, close to this app's own `accentDeepBlue` token, NOT the
/// bright saturated `accentCyan` this file used earlier (confirmed wrong
/// via direct pixel sampling after user feedback that the color looked
/// "monotone" and too vivid next to the Reference's paler, background-
/// blending look). Below the candles, the Reference has a glowing
/// wireframe mesh woven diagonally over a surface that sweeps down-right
/// then flattens (pixel-traced by scanning each column for its brightest
/// point, not guessed) — not a flat horizontal grid, which is what this
/// file drew in its first mesh attempt and was directly flagged as wrong
/// ("why are the lines horizontal"). Like Home's `HeroMapTexture`, this
/// app has no real chart-data source to draw from at Splash time (nothing
/// is fetched yet), so this remains a deliberate best-effort decorative
/// approximation — a deterministic pattern, not real market data —
/// disclosed as such rather than claimed pixel-exact.
struct SplashMarketTexture: View {
    var body: some View {
        ZStack {
            mesh
            candles
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// A diagonally-woven wireframe mesh, sweeping down-right and
    /// flattening out — NOT a flat horizontal grid (the previous version's
    /// bug, flagged directly by the user: "why are the lines horizontal").
    /// The sweep shape itself is not guessed: pixel-scanned the Reference
    /// for the brightest point in each column to trace its actual ridge
    /// line, which reads as a smooth one-directional descent from ~69% to
    /// ~80% of screen height between x=0 and x≈60%, then staying flat —
    /// a sigmoid, not a symmetric hump. The "weft" lines are parallel
    /// copies of that same sigmoid at different vertical offsets; the
    /// "warp" lines are sheared (not vertical) so they cross the weft
    /// diagonally, producing the Reference's woven/draped-fabric look
    /// instead of an axis-aligned grid.
    private var mesh: some View {
        Canvas { context, size in
            let rows = 12
            let cols = 16
            let topY = size.height * 0.56
            let bottomY = size.height * 0.98
            let sweep = size.height * 0.12

            func descend(_ t: Double) -> Double {
                1 / (1 + exp(-(t - 0.25) * 4.5))
            }
            func rowY(_ r: Int, at t: Double) -> Double {
                let f = Double(r) / Double(rows)
                let base = topY + (bottomY - topY) * f
                return base + descend(t) * sweep
            }

            var points: [[CGPoint]] = []
            for r in 0...rows {
                var rowPoints: [CGPoint] = []
                for c in 0...cols {
                    let t = Double(c) / Double(cols)
                    rowPoints.append(CGPoint(x: t * size.width, y: rowY(r, at: t)))
                }
                points.append(rowPoints)
            }

            // Weft: the sweeping rows themselves.
            for r in 0...rows {
                let f = Double(r) / Double(rows)
                var path = Path()
                path.move(to: points[r][0])
                for c in 1...cols { path.addLine(to: points[r][c]) }
                context.stroke(path, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(0.06 + 0.16 * (1 - abs(f - 0.4)))), lineWidth: 0.6)
            }

            // Warp: sheared diagonals crossing the weft, not straight
            // verticals — a vertical connector here would just be another
            // horizontal-reading bar, the exact bug being fixed.
            let shearPerRow = size.width / Double(cols) * 0.7
            for j in -cols...(cols * 2) {
                var path = Path()
                var started = false
                for r in 0...rows {
                    let x = Double(j) * (size.width / Double(cols)) + Double(r) * shearPerRow
                    guard x >= -20, x <= size.width + 20 else { continue }
                    let t = x / size.width
                    let y = rowY(r, at: t)
                    if !started {
                        path.move(to: CGPoint(x: x, y: y))
                        started = true
                    } else {
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                }
                if started {
                    context.stroke(path, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(0.09)), lineWidth: 0.5)
                }
            }

            let ridgeRow = rows / 3
            var ridgePath = Path()
            ridgePath.move(to: points[ridgeRow][0])
            for c in 1...cols { ridgePath.addLine(to: points[ridgeRow][c]) }
            context.stroke(ridgePath, with: .color(DesignTokens.Colors.accentCyan.opacity(0.14)), lineWidth: 5)
            context.stroke(ridgePath, with: .color(DesignTokens.Colors.accentCyan.opacity(0.55)), lineWidth: 1.1)
        }
    }

    /// Real candlesticks float at their own open/close range — the
    /// Reference's bodies are NOT bottom-aligned to a shared floor (that
    /// was this file's original bug, confirmed by directly comparing a CI
    /// screenshot against the Reference: this file had been drawing a bar
    /// chart growing from a fixed baseline, not floating candles). Each
    /// body's vertical center now follows a noisy random walk with a
    /// gentle upward drift instead, giving the Reference's irregular
    /// rising-staircase look, with independent wicks above AND below each
    /// body. Also matches the Reference's fade: candles read fainter on
    /// the left (older) and brighter toward the right (recent), and its
    /// color is a fairly uniform muted blue rather than a bright two-tone.
    private var candles: some View {
        Canvas { context, size in
            var seed: UInt64 = 0xD1B5_4A32_9E77_1C03
            func nextUnit() -> Double {
                seed ^= seed << 13
                seed ^= seed >> 7
                seed ^= seed << 17
                return Double(seed % 1000) / 1000
            }

            struct CandleShape {
                let bodyPath: Path
                let wickPath: Path
                let fade: Double
            }

            let candleCount = 20
            let candleSlot = size.width / Double(candleCount)
            let topFraction = 0.34
            let bottomFraction = 0.86
            let glowRadius = size.width * 0.025

            var shapes: [CandleShape] = []
            var center = bottomFraction
            for index in 0..<candleCount {
                let progress = Double(index) / Double(candleCount - 1)
                let drift = (bottomFraction - topFraction) / Double(candleCount) * 0.9
                // Bidirectional, not `max(0, noise)`: a real random walk
                // needs candles that dip below their predecessor too, or
                // the result is a smooth monotonic ramp instead of the
                // Reference's noisy up-and-down staircase.
                let noise = (nextUnit() - 0.5) * 0.11
                center -= drift * (0.4 + progress * 0.85) + noise
                center = min(max(center, topFraction), bottomFraction)

                let centerY = center * size.height
                let bodyHeight = size.height * (0.016 + nextUnit() * 0.022)
                let x = candleSlot * (Double(index) + 0.5)
                let bodyWidth = candleSlot * 0.42
                let upperWick = bodyHeight * (0.4 + nextUnit() * 0.8)
                let lowerWick = bodyHeight * (0.15 + nextUnit() * 0.5)

                var wick = Path()
                wick.move(to: CGPoint(x: x, y: centerY - bodyHeight / 2 - upperWick))
                wick.addLine(to: CGPoint(x: x, y: centerY + bodyHeight / 2 + lowerWick))

                let bodyRect = CGRect(x: x - bodyWidth / 2, y: centerY - bodyHeight / 2, width: bodyWidth, height: bodyHeight)
                let bodyPath = Path(roundedRect: bodyRect, cornerRadius: 1.5)
                let fade = 0.3 + progress * 0.7
                shapes.append(CandleShape(bodyPath: bodyPath, wickPath: wick, fade: fade))
            }

            context.drawLayer { layer in
                layer.addFilter(.blur(radius: glowRadius))
                for shape in shapes {
                    layer.fill(shape.bodyPath, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(0.5 * shape.fade)))
                    layer.stroke(shape.wickPath, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(0.45 * shape.fade)), lineWidth: 2)
                }
            }

            for shape in shapes {
                context.stroke(shape.wickPath, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(0.6 * shape.fade)), lineWidth: 1)
                context.fill(shape.bodyPath, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(0.75 * shape.fade)))
            }
        }
    }
}
