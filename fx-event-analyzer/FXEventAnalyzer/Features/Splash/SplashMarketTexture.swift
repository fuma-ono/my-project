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

    /// An organically-draped mesh, NOT a rigid straight-line grid — the
    /// root cause behind a direct HQ instruction to stop treating this as a
    /// coordinate/opacity tuning problem and instead fix the underlying
    /// draw structure: both the weft (wave) rows *and* the warp (shear)
    /// diagonals previously only bent through the single sigmoid dip, so
    /// the warp lines in particular still read as straight diagonal grid
    /// strokes once actually captured on a device — the Reference's
    /// surface visibly ripples like draped cloth, not a flat plane bent
    /// once. `height(at:row:)` is now the single source of vertical
    /// deformation shared by every weft row *and* every warp diagonal: the
    /// same sigmoid descent as before, plus a small multi-cycle ripple
    /// (sine, phase-shifted per row) layered on top — so no line in the
    /// mesh is ever straight, matching the Reference's woven/folded-fabric
    /// look instead of a UV-mapped flat grid. The bright ridge line reuses
    /// this deformation too, and now glows via a real Gaussian blur layer
    /// (`context.drawLayer(...addFilter(.blur...))`) instead of a second
    /// wide low-opacity stroke standing in for one. Verified against the
    /// Reference's lower-half crop with a Python re-implementation
    /// (full_scene_v7_organic) before porting.
    private var mesh: some View {
        Canvas { context, size in
            let rows = 16
            let cols = 24
            // topY/bottomY/sweep were 0.53/0.86/0.10 — a grid-overlaid
            // crop of the Reference (10% gridlines) showed the bright
            // ridge actually descends from ~69% to ~80% of full screen
            // height, not the ~59-69% this produced; the mesh read as
            // sitting too high and overlapping the candles because of it.
            // Re-solved topY/bottomY/sweep so ridgeRow's own curve lands
            // on that measured 69%→80% span.
            let topY = size.height * 0.60
            let bottomY = size.height * 0.93
            let sweep = size.height * 0.14
            let rippleAmplitude = size.height * 0.012

            func descend(_ t: Double) -> Double {
                1 / (1 + exp(-(t - 0.25) * 4.5))
            }
            // Shared deformation for every weft row and warp diagonal: the
            // overall down-then-flatten sweep, plus a small ripple whose
            // phase shifts per row and whose amplitude fades toward the
            // right — this is what keeps every line in the mesh curved,
            // not just the row that happens to follow the base sigmoid.
            func height(at t: Double, row: Int) -> Double {
                let ripple = sin(t * 11.5 + Double(row) * 0.9) * rippleAmplitude * (0.4 + 0.6 * (1 - t))
                return descend(t) * sweep + ripple
            }
            func rowY(_ r: Int, at t: Double) -> Double {
                let f = Double(r) / Double(rows)
                let base = topY + (bottomY - topY) * f
                return base + height(at: t, row: r)
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

            let ridgeRow = rows / 5
            let ridgeF = Double(ridgeRow) / Double(rows)

            // Weft: soft wave lines clustering near the ridge row and
            // fading both away from it vertically and toward the right
            // horizontally, so the right two-thirds of the screen (behind
            // the tagline and loading bar) stays close to plain background
            // like the Reference, instead of a uniform grid everywhere.
            for r in 0...rows {
                let f = Double(r) / Double(rows)
                let closeness = max(0, 1 - abs(f - ridgeF) * 2.0)
                let baseOpacity = 0.05 + 0.28 * pow(closeness, 1.3)
                for c in 0..<cols {
                    let t = (Double(c) + 0.5) / Double(cols)
                    let fade = max(0.22, 1.0 - t * 0.5)
                    var segment = Path()
                    segment.move(to: points[r][c])
                    segment.addLine(to: points[r][c + 1])
                    context.stroke(segment, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(baseOpacity * fade)), lineWidth: 0.8)
                }
            }

            // Warp: sheared diagonals that ride the SAME height(at:row:)
            // deformation as the weft rows, so they ripple with the mesh
            // instead of cutting straight across it — a perspective floor
            // grid concentrated bottom-left and fading out by roughly the
            // midpoint of the screen, not full-strength across the whole
            // width.
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
                let concentration = max(0, 1.0 - (tSum / tCount) / 0.62)
                let opacity = 0.24 * concentration
                guard opacity > 0.006 else { continue }
                context.stroke(path, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(opacity)), lineWidth: 0.6)
            }

            var ridgePath = Path()
            ridgePath.move(to: points[ridgeRow][0])
            for c in 1...cols { ridgePath.addLine(to: points[ridgeRow][c]) }

            // Real Gaussian-blur bloom instead of a second wide/faint
            // stroke standing in for a glow — matches the Reference's
            // soft light spread around the bright core rather than a hard-
            // edged halo.
            context.drawLayer { layer in
                layer.addFilter(.blur(radius: size.width * 0.018))
                layer.stroke(ridgePath, with: .color(DesignTokens.Colors.accentCyan.opacity(0.9)), lineWidth: 3)
            }
            context.stroke(ridgePath, with: .color(DesignTokens.Colors.accentCyan.opacity(0.85)), lineWidth: 1.2)
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
