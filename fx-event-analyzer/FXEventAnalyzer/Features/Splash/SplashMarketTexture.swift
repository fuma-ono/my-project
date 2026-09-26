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

    /// A perspective floor-grid plus layered flowing wave lines — NOT a
    /// uniform full-screen diagonal weave (that was this file's previous
    /// version, flagged directly via a real-device side-by-side comparison:
    /// the grid there was legible and equally strong across the *entire*
    /// screen, including right through the tagline text and the loading
    /// bar, where the Reference is nearly plain background). Zoomed into
    /// the Reference directly: the fine crosshatch only reads clearly in
    /// the lower-left, like a floor grid in perspective, and fades out
    /// well before the right edge; a handful of soft wave lines cluster
    /// near the one bright ridge curve and fade elsewhere, rather than all
    /// rows being equally visible. This rewrite fades both the weft
    /// (wave) rows and the warp (grid) diagonals by distance from the
    /// ridge / from the left edge respectively, verified against the
    /// Reference's actual lower-half crop before porting from a Python
    /// re-implementation.
    private var mesh: some View {
        Canvas { context, size in
            let rows = 14
            let cols = 20
            let topY = size.height * 0.53
            let bottomY = size.height * 0.86
            let sweep = size.height * 0.10

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

            let ridgeRow = rows / 4
            let ridgeF = Double(ridgeRow) / Double(rows)

            // Weft: soft wave lines clustering near the ridge row and
            // fading both away from it vertically and toward the right
            // horizontally, so the right two-thirds of the screen (behind
            // the tagline and loading bar) stays close to plain background
            // like the Reference, instead of a uniform grid everywhere.
            for r in 0...rows {
                let f = Double(r) / Double(rows)
                let closeness = max(0, 1 - abs(f - ridgeF) * 2.0)
                let baseOpacity = 0.05 + 0.30 * pow(closeness, 1.3)
                for c in 0..<cols {
                    let t = (Double(c) + 0.5) / Double(cols)
                    let fade = max(0.25, 1.0 - t * 0.45)
                    var segment = Path()
                    segment.move(to: points[r][c])
                    segment.addLine(to: points[r][c + 1])
                    context.stroke(segment, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(baseOpacity * fade)), lineWidth: 0.8)
                }
            }

            // Warp: fine sheared diagonals forming a perspective floor
            // grid, concentrated bottom-left and fading out by roughly the
            // midpoint of the screen — not straight verticals (a vertical
            // connector here would just be another horizontal-reading
            // bar), and not full-strength across the whole width.
            let shearPerRow = size.width / Double(cols) * 0.65
            for j in -cols...(cols * 2) {
                var path = Path()
                var started = false
                var tSum = 0.0
                var tCount = 0.0
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
                    tSum += t
                    tCount += 1
                }
                guard started, tCount > 0 else { continue }
                let concentration = max(0, 1.0 - (tSum / tCount) / 0.65)
                let opacity = 0.26 * concentration
                guard opacity > 0.006 else { continue }
                context.stroke(path, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(opacity)), lineWidth: 0.6)
            }

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
            let topFraction = 0.53
            let bottomFraction = 0.86
            let glowRadius = size.width * 0.025

            var shapes: [CandleShape] = []
            var center = bottomFraction
            // A second side-by-side comparison against the Reference showed
            // the previous noise-dominant walk had no real trend: its
            // "climax" candle landed a third of the way across instead of
            // at the right edge. The Reference is an unmistakable rising
            // staircase (echoing the logo mark's own upward arrow) with
            // noise only as texture on top of that climb, not the primary
            // driver — so drift now leads (scaled to the full topFraction/
            // bottomFraction span, verified via a Python re-implementation
            // to land the tallest candles at the far right) and noise is
            // sized relative to a single drift step rather than as an
            // independent fixed amplitude.
            let totalRange = bottomFraction - topFraction
            let driftBase = totalRange / Double(candleCount) * 1.15
            for index in 0..<candleCount {
                let progress = Double(index) / Double(candleCount - 1)
                let drift = driftBase * (0.5 + progress * 1.0)
                let noise = (nextUnit() - 0.5) * driftBase * 3.2
                center -= drift + noise
                center = min(max(center, topFraction), bottomFraction)

                let centerY = center * size.height
                let bodyHeight = size.height * (0.012 + nextUnit() * 0.035)
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
