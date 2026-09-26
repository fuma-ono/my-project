import SwiftUI

/// SCR-000 Splash's lower-background decoration. Pixel-sampled directly
/// from the Reference (not guessed): candle bodies read around
/// RGB(30,70,135) against a RGB(5,15,30)-ish background — dim, desaturated
/// steel-blue, close to this app's own `accentDeepBlue` token, NOT the
/// bright saturated `accentCyan` this file used earlier (confirmed wrong
/// via direct pixel sampling after user feedback that the color looked
/// "monotone" and too vivid next to the Reference's paler, background-
/// blending look). Below the candles, the Reference has a glowing curve
/// with a mesh draped along it, both built from actual (x, y) control
/// points pixel-traced off the Reference — see `mesh`'s doc comment for
/// the coordinate table and why an abstract formula (this file's earlier
/// approach) kept drifting from the real shape. Like Home's
/// `HeroMapTexture`, this app has no real chart-data source to draw from
/// at Splash time (nothing is fetched yet), so this remains a deliberate
/// best-effort decorative approximation — a deterministic pattern, not
/// real market data — disclosed as such rather than claimed pixel-exact.
struct SplashMarketTexture: View {
    var body: some View {
        ZStack {
            mesh
            candles
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// The reference for this curve/mesh changed this round: HQ supplied a
    /// new generated image (a wide hero-style graphic, not the phone-
    /// mockup Splash screenshot used before) and asked for it reproduced
    /// as traced, explicitly forbidding another redraw from Claude's own
    /// interpretation. Traced directly off that image with a 5% grid
    /// overlay, refined with tighter zooms where the shape changes fastest
    /// or fades — see the values below, not guessed:
    ///
    /// - It is NOT a single ridge line. Three distinct glowing strands are
    ///   visible: `curveA` (the main bright one — descends steadily,
    ///   flattens by x≈0.55, and stays visible much further right than the
    ///   old Reference's curve before fading, gone by x≈0.90), `curveB` (a
    ///   fainter strand crossing below curveA, visible only x≈0.10-0.65),
    ///   and `curveC` (a faint upper wisp, visible only x≈0.40-0.75).
    /// - The grid is NOT a uniform parallel weave. It straddles curveA
    ///   (rows both above and below it, not purely offset below), with
    ///   perspective-style spacing that widens toward the left and warp
    ///   diagonals that converge toward curveA's own brightest point
    ///   (≈x=0.38) rather than running at one constant shear angle.
    /// - Coordinates are normalized against the REFERENCE IMAGE's own
    ///   frame (0...1 over its full 1794x877 canvas — this image has no
    ///   phone bezel to exclude; the whole image is content) and mapped
    ///   onto the screen preserving that image's own aspect ratio
    ///   (`aspectScale`), not stretched to fill a fixed vertical band —
    ///   stretching was tried first and visibly steepened the curve beyond
    ///   what the Reference actually shows. Only `topAnchorFraction` (where
    ///   this composition starts on the Splash screen) is a placement
    ///   choice; the shape itself is untouched.
    /// Verified against the new Reference with a Python re-implementation
    /// (full_scene_newref2) before porting.
    private var mesh: some View {
        Canvas { context, size in
            // Reference-space control points (0...1 over the new
            // Reference's own 1794x877 frame), traced via a 5% grid
            // overlay.
            let curveA: [CGPoint] = [
                CGPoint(x: 0.00, y: 0.27), CGPoint(x: 0.05, y: 0.29),
                CGPoint(x: 0.10, y: 0.32), CGPoint(x: 0.15, y: 0.36),
                CGPoint(x: 0.20, y: 0.40), CGPoint(x: 0.25, y: 0.44),
                CGPoint(x: 0.30, y: 0.48), CGPoint(x: 0.35, y: 0.51),
                CGPoint(x: 0.40, y: 0.54), CGPoint(x: 0.45, y: 0.57),
                CGPoint(x: 0.50, y: 0.59), CGPoint(x: 0.55, y: 0.60),
                CGPoint(x: 0.60, y: 0.60), CGPoint(x: 0.65, y: 0.60),
                CGPoint(x: 0.70, y: 0.60), CGPoint(x: 0.75, y: 0.60),
                CGPoint(x: 0.80, y: 0.60), CGPoint(x: 0.85, y: 0.60),
                CGPoint(x: 0.90, y: 0.60), CGPoint(x: 0.95, y: 0.60),
                CGPoint(x: 1.00, y: 0.60),
            ]
            let curveB: [CGPoint] = [
                CGPoint(x: 0.15, y: 0.52), CGPoint(x: 0.20, y: 0.54),
                CGPoint(x: 0.25, y: 0.56), CGPoint(x: 0.30, y: 0.58),
                CGPoint(x: 0.35, y: 0.61), CGPoint(x: 0.40, y: 0.64),
                CGPoint(x: 0.45, y: 0.68), CGPoint(x: 0.50, y: 0.71),
                CGPoint(x: 0.55, y: 0.73), CGPoint(x: 0.60, y: 0.74),
            ]
            let curveC: [CGPoint] = [
                CGPoint(x: 0.45, y: 0.44), CGPoint(x: 0.50, y: 0.45),
                CGPoint(x: 0.55, y: 0.46), CGPoint(x: 0.60, y: 0.47),
                CGPoint(x: 0.65, y: 0.48), CGPoint(x: 0.70, y: 0.48),
            ]

            // Catmull-Rom spline through any of the point arrays above —
            // passes exactly through every measured point.
            func catmullRomY(_ pts: [CGPoint], at x: Double) -> Double {
                let clampedX = min(max(x, pts[0].x), pts[pts.count - 1].x)
                var i = 0
                while i < pts.count - 2, pts[i + 1].x < clampedX { i += 1 }
                let p0 = pts[max(i - 1, 0)]
                let p1 = pts[i]
                let p2 = pts[min(i + 1, pts.count - 1)]
                let p3 = pts[min(i + 2, pts.count - 1)]
                let segWidth = p2.x - p1.x
                guard segWidth > 0 else { return p1.y }
                let u = (clampedX - p1.x) / segWidth
                let u2 = u * u, u3 = u2 * u
                return 0.5 * (
                    (2 * p1.y)
                    + (-p0.y + p2.y) * u
                    + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2
                    + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3
                )
            }

            // Aspect-preserving mapping: scale the Reference's width to
            // fill the screen and keep that SAME scale for height, instead
            // of remapping y into an arbitrary band (which was tried first
            // and visibly distorted the curve steeper than the Reference).
            let aspectScale = size.width * (877.0 / 1794.0)
            let topAnchorFraction = 0.565
            let refYAtTop = curveA[0].y
            func mapY(_ refY: Double) -> Double {
                topAnchorFraction * size.height + (refY - refYAtTop) * aspectScale
            }

            func smoothstep(_ edge0: Double, _ edge1: Double, _ x: Double) -> Double {
                let t = min(max((x - edge0) / (edge1 - edge0), 0), 1)
                return t * t * (3 - 2 * t)
            }

            // Measured at the curve's brightest pixels in the new
            // Reference too (RGB averaging ~(75,150,211), consistent with
            // the old Reference's own measurement) — a blue-dominant
            // azure, not `accentCyan`'s more green-leaning turquoise.
            let curveColor = Color(red: 0.29, green: 0.58, blue: 0.83)
            let deepBlue = DesignTokens.Colors.accentDeepBlue

            // --- Grid: draped along curveA, straddling both above and
            // below it, spacing widening toward the left (perspective),
            // converging near curveA's own brightest point instead of a
            // uniform parallel weave. ---
            func gridRefY(_ t: Double, rowOffset: Double) -> Double {
                let base = catmullRomY(curveA, at: t)
                let spacingScale = 0.008 + 0.02 * max(0, 0.4 - t)
                return base + rowOffset * spacingScale
            }
            func meshFade(at t: Double) -> Double {
                smoothstep(0.0, 0.04, t) * (1 - smoothstep(0.30, 0.48, t))
            }

            let rowsAbove = 6
            let rowsBelow = 9
            let meshMaxT = 0.48
            let weftCols = 60
            for rowOffset in -rowsAbove...rowsBelow {
                let rowFade = max(0, 1 - abs(Double(rowOffset)) / Double(max(rowsAbove, rowsBelow)) * 0.9)
                var previous = CGPoint(x: 0, y: mapY(gridRefY(0, rowOffset: Double(rowOffset))))
                for c in 1...weftCols {
                    let t = Double(c) / Double(weftCols) * meshMaxT
                    let point = CGPoint(x: t * size.width, y: mapY(gridRefY(t, rowOffset: Double(rowOffset))))
                    let midT = t - (meshMaxT / Double(weftCols)) / 2
                    let opacity = meshFade(at: midT) * 0.40 * rowFade
                    if opacity > 0.004 {
                        var segment = Path()
                        segment.move(to: previous)
                        segment.addLine(to: point)
                        context.stroke(segment, with: .color(deepBlue.opacity(opacity)), lineWidth: 0.8)
                    }
                    previous = point
                }
            }

            // Warp: converges from the mesh's lower edge toward curveA's
            // own path near t=0.40 (the vanishing-point look visible in
            // the Reference) rather than running at one constant shear.
            let vanishT = 0.40
            for k in -4..<26 {
                let xBottomT = Double(k) * 0.02
                var previous: CGPoint?
                for s in 0...20 {
                    let frac = Double(s) / 20
                    let t = xBottomT + (vanishT - xBottomT) * frac
                    let rowOffset = Double(rowsBelow) * (1 - frac)
                    let clampedT = max(0, min(t, vanishT))
                    let point = CGPoint(x: t * size.width, y: mapY(gridRefY(clampedT, rowOffset: rowOffset)))
                    if let prev = previous {
                        let opacity = meshFade(at: t) * 0.32
                        if opacity > 0.004 {
                            var segment = Path()
                            segment.move(to: prev)
                            segment.addLine(to: point)
                            context.stroke(segment, with: .color(deepBlue.opacity(opacity)), lineWidth: 0.6)
                        }
                    }
                    previous = point
                }
            }

            // --- The three glowing strands, each its own geometry and
            // opacity envelope, each drawn as a Gaussian-blur glow layer
            // plus a bright core on top. ---
            func drawStrand(_ pts: [CGPoint], opacityAt: (Double) -> Double, coreWidth: CGFloat, glowWidth: CGFloat, blurRadius: CGFloat, coreMul: Double) {
                let tMin = pts[0].x
                let tMax = pts[pts.count - 1].x
                let sampleCount = 260
                var samples: [(t: Double, point: CGPoint)] = []
                samples.reserveCapacity(sampleCount + 1)
                for i in 0...sampleCount {
                    let t = tMin + (tMax - tMin) * Double(i) / Double(sampleCount)
                    let y = mapY(catmullRomY(pts, at: t))
                    samples.append((t, CGPoint(x: t * size.width, y: y)))
                }

                context.drawLayer { layer in
                    layer.addFilter(.blur(radius: blurRadius))
                    var previous = samples[0].point
                    for sample in samples.dropFirst() {
                        let opacity = opacityAt(sample.t)
                        if opacity > 0.02 {
                            var segment = Path()
                            segment.move(to: previous)
                            segment.addLine(to: sample.point)
                            layer.stroke(segment, with: .color(curveColor.opacity(opacity)), lineWidth: glowWidth)
                        }
                        previous = sample.point
                    }
                }

                var previous = samples[0].point
                for sample in samples.dropFirst() {
                    let opacity = opacityAt(sample.t)
                    if opacity > 0.02 {
                        var segment = Path()
                        segment.move(to: previous)
                        segment.addLine(to: sample.point)
                        context.stroke(segment, with: .color(curveColor.opacity(min(1.0, opacity * coreMul))), lineWidth: coreWidth)
                    }
                    previous = sample.point
                }
            }

            func opacityB(_ t: Double) -> Double {
                smoothstep(0.10, 0.22, t) * (1 - smoothstep(0.45, 0.65, t)) * 0.75
            }
            func opacityC(_ t: Double) -> Double {
                smoothstep(0.40, 0.48, t) * (1 - smoothstep(0.60, 0.75, t)) * 0.6
            }
            func opacityA(_ t: Double) -> Double {
                smoothstep(0.0, 0.15, t) * (1 - smoothstep(0.72, 0.90, t))
            }

            drawStrand(curveB, opacityAt: opacityB, coreWidth: 1.0, glowWidth: 4, blurRadius: size.width * 0.014, coreMul: 0.8)
            drawStrand(curveC, opacityAt: opacityC, coreWidth: 1.0, glowWidth: 3, blurRadius: size.width * 0.012, coreMul: 0.75)
            drawStrand(curveA, opacityAt: opacityA, coreWidth: 1.2, glowWidth: 6, blurRadius: size.width * 0.02, coreMul: 0.9)
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
