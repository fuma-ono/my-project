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

    /// HQ instruction, second round: the coordinate analysis was directionally
    /// right but under-specified. Three corrections made here, each verified
    /// against the Reference before porting:
    ///
    /// 1. **Curve geometry, core opacity, and glow opacity are three
    ///    independent functions** (`curveY`, `curveCoreOpacity`,
    ///    `curveGlowOpacity`), not one curve driving all three. Re-sampled
    ///    the Reference at 2.5%-of-width steps (`curveControlPoints`,
    ///    doubling the earlier 5% resolution) and specifically checked
    ///    whether x=0.65 was really where the path ends — it isn't. A
    ///    continuity-constrained trace out to x=0.975 shows the path itself
    ///    stays almost flat (y≈0.80-0.81) all the way to the right edge;
    ///    only its *brightness* decays (peak B-channel ~211 around
    ///    x=0.4-0.475, down to ~47-50, indistinguishable from background,
    ///    by x≈0.9). So the path is defined all the way across, and
    ///    `curveCoreOpacity`/`curveGlowOpacity` are what fade it out — never
    ///    a truncated path.
    /// 2. **The mesh is its own shape, not a copy of the ridge curve.**
    ///    Zoomed into the Reference's crosshatch directly: it's two line
    ///    families crossing at a wide angle — gentle "weft" lines that do
    ///    drape along roughly the ridge's own curvature (using the curve's
    ///    shape here is a deliberate choice, not a shortcut), and much
    ///    steeper, close to straight "warp" diagonals (measured slope
    ///    ≈ -1.15 in normalized coordinates) that are NOT curve-following —
    ///    forcing them through `curveY` was what made the previous version's
    ///    warp lines read as an artificial extension of the ridge itself.
    ///    Row spacing (~1.25% of height), warp spacing (~1.8% of width),
    ///    and the mesh's own fade (gone by x≈0.40, well before the ridge's
    ///    own x≈0.9 fade) were each measured independently off the
    ///    Reference, not derived from the ridge's numbers.
    /// 3. **One shared normalize→pixel conversion.** Every coordinate here
    ///    is 0...1 against the Reference's actual app display bounds
    ///    (status bar to home indicator, not the phone-mockup image or its
    ///    padding) and only multiplied by `size.width`/`size.height` at the
    ///    point of drawing, so this holds its shape across device sizes.
    /// Verified against the Reference with a Python re-implementation
    /// (full_scene_v13_dense) before porting.
    private var mesh: some View {
        Canvas { context, size in
            // Pixel-traced at 2.5%-of-width steps (normalized against the
            // app's own display bounds), continuity-constrained per column
            // (each point searched within a narrow band around the previous
            // one) to reject candle/loading-bar pixels that would otherwise
            // outshine the curve's own dimmer brightness in a blind
            // brightest-pixel search.
            let curveControlPoints: [CGPoint] = [
                CGPoint(x: 0.025, y: 0.6945), CGPoint(x: 0.050, y: 0.6999),
                CGPoint(x: 0.075, y: 0.7042), CGPoint(x: 0.100, y: 0.7095),
                CGPoint(x: 0.125, y: 0.7149), CGPoint(x: 0.150, y: 0.7203),
                CGPoint(x: 0.175, y: 0.7267), CGPoint(x: 0.200, y: 0.7331),
                CGPoint(x: 0.225, y: 0.7385), CGPoint(x: 0.250, y: 0.7449),
                CGPoint(x: 0.275, y: 0.7513), CGPoint(x: 0.300, y: 0.7567),
                CGPoint(x: 0.325, y: 0.7621), CGPoint(x: 0.350, y: 0.7663),
                CGPoint(x: 0.375, y: 0.7728), CGPoint(x: 0.400, y: 0.7771),
                CGPoint(x: 0.425, y: 0.7814), CGPoint(x: 0.450, y: 0.7846),
                CGPoint(x: 0.475, y: 0.7878), CGPoint(x: 0.500, y: 0.7910),
                CGPoint(x: 0.525, y: 0.7942), CGPoint(x: 0.550, y: 0.7964),
                CGPoint(x: 0.575, y: 0.7996), CGPoint(x: 0.600, y: 0.8006),
                CGPoint(x: 0.625, y: 0.8028), CGPoint(x: 0.650, y: 0.8039),
                CGPoint(x: 0.675, y: 0.8049), CGPoint(x: 0.700, y: 0.8049),
                CGPoint(x: 0.725, y: 0.8060), CGPoint(x: 0.750, y: 0.8060),
                CGPoint(x: 0.775, y: 0.8060), CGPoint(x: 0.800, y: 0.8060),
                CGPoint(x: 0.825, y: 0.8039), CGPoint(x: 0.850, y: 0.8081),
                CGPoint(x: 0.875, y: 0.8039), CGPoint(x: 0.900, y: 0.7996),
                CGPoint(x: 0.925, y: 0.7942), CGPoint(x: 0.950, y: 0.8028),
                CGPoint(x: 0.975, y: 0.8092),
            ]

            // Catmull-Rom spline through curveControlPoints (passes exactly
            // through every measured point), linearly extrapolated using
            // the end segments' own slope before x=0.025 and held at the
            // last point's y after x=0.975 — the path is defined across the
            // full width; only its opacity (below) tapers it.
            func curveY(at x: Double) -> Double {
                let pts = curveControlPoints
                if x < pts[0].x {
                    let slope = (pts[1].y - pts[0].y) / (pts[1].x - pts[0].x)
                    return pts[0].y - slope * (pts[0].x - x)
                }
                if x > pts[pts.count - 1].x { return pts[pts.count - 1].y }
                var i = 0
                while i < pts.count - 2, pts[i + 1].x < x { i += 1 }
                let p0 = pts[max(i - 1, 0)]
                let p1 = pts[i]
                let p2 = pts[min(i + 1, pts.count - 1)]
                let p3 = pts[min(i + 2, pts.count - 1)]
                let segWidth = p2.x - p1.x
                guard segWidth > 0 else { return p1.y }
                let u = (x - p1.x) / segWidth
                let u2 = u * u, u3 = u2 * u
                return 0.5 * (
                    (2 * p1.y)
                    + (-p0.y + p2.y) * u
                    + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2
                    + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3
                )
            }

            func smoothstep(_ edge0: Double, _ edge1: Double, _ x: Double) -> Double {
                let t = min(max((x - edge0) / (edge1 - edge0), 0), 1)
                return t * t * (3 - 2 * t)
            }
            // Independent envelope #1: the bright core line. Rises fast,
            // sustains through the brightest measured region, fades out
            // over x=0.45-0.95 — matched to the B-channel brightness curve
            // sampled alongside the position trace, not assumed symmetric.
            func curveCoreOpacity(at t: Double) -> Double {
                smoothstep(0.0, 0.35, t) * (1 - smoothstep(0.45, 0.95, t))
            }
            // Independent envelope #2: the soft glow — deliberately a
            // *different* function from the core (starts slightly earlier,
            // extends slightly further right, capped a bit lower) rather
            // than a scaled copy, since a glow's own falloff is visibly
            // softer/wider than its core in the Reference.
            func curveGlowOpacity(at t: Double) -> Double {
                smoothstep(0.0, 0.25, t) * (1 - smoothstep(0.50, 0.98, t)) * 0.95
            }
            // Independent envelope #3: the mesh crosshatch, which fades out
            // by x≈0.40 — well before the ridge's own x≈0.95, measured
            // separately by directly finding where the crosshatch pattern
            // itself (not the ridge) stops being visible.
            func meshOpacity(at t: Double) -> Double {
                smoothstep(0.0, 0.04, t) * (1 - smoothstep(0.22, 0.42, t))
            }

            // Weft: drapes along the ridge's own measured curvature
            // (a deliberate choice — the Reference's gentler crosshatch
            // lines visibly bend the same direction as the ridge, just
            // offset below it) but with its OWN row spacing, opacity, and
            // horizontal extent — not the ridge's curveCoreOpacity/
            // curveGlowOpacity.
            let rows = 22
            let rowSpacing = 0.0125
            let meshMaxT = 0.55
            func weftY(_ r: Int, at t: Double) -> Double {
                (curveY(at: t) + Double(r) * rowSpacing) * size.height
            }
            let weftCols = 60
            for r in 0...rows {
                let rowFade = max(0, 1 - Double(r) / Double(rows) * 1.1)
                var previous = CGPoint(x: 0, y: weftY(r, at: 0))
                for c in 1...weftCols {
                    let t = Double(c) / Double(weftCols) * meshMaxT
                    let point = CGPoint(x: t * size.width, y: weftY(r, at: t))
                    let midT = (Double(c) - 0.5) / Double(weftCols) * meshMaxT
                    let opacity = meshOpacity(at: midT) * 0.45 * rowFade
                    if opacity > 0.004 {
                        var segment = Path()
                        segment.move(to: previous)
                        segment.addLine(to: point)
                        context.stroke(segment, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(opacity)), lineWidth: 0.8)
                    }
                    previous = point
                }
            }

            // Warp: measured directly off the Reference as close-to-straight
            // diagonals (slope ≈ -1.15 in normalized x/y) crossing the weft
            // at a wide angle — NOT routed through curveY, since forcing
            // them onto the ridge's own curvature was what made the
            // previous version's warp lines read as just another copy of
            // the ridge rather than a genuinely different line family.
            let warpSlope = -1.15
            let meshTopY = curveY(at: 0) - 0.07
            let meshBottomY = curveY(at: 0) + Double(rows) * rowSpacing + 0.03
            let warpSpacing = 0.018
            let warpRun = (meshBottomY - meshTopY) / -warpSlope
            let lineCount = Int(1.4 / warpSpacing)
            for k in -8..<lineCount {
                let xBottom = Double(k) * warpSpacing
                let xTop = xBottom + warpRun
                let bottomPoint = CGPoint(x: xBottom * size.width, y: meshBottomY * size.height)
                let topPoint = CGPoint(x: xTop * size.width, y: meshTopY * size.height)
                let opacity = meshOpacity(at: (xBottom + xTop) / 2) * 0.35
                guard opacity > 0.004 else { continue }
                var path = Path()
                path.move(to: topPoint)
                path.addLine(to: bottomPoint)
                context.stroke(path, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(opacity)), lineWidth: 0.6)
            }

            // The ridge curve, in three explicitly separate layers (base /
            // soft glow / bright core), each reading its own independent
            // opacity function — sampled across the FULL width (0...1), not
            // truncated, since curveY is now defined everywhere and the
            // opacity functions alone taper it to invisible.
            //
            // Color: measured directly at the curve's brightest pixels
            // (x=0.35-0.50, the peak-brightness region) — RGB averaging
            // ~(75, 150, 211), a blue-dominant azure. `accentCyan`
            // (RGB 52, 209, 224 — G nearly equal to B) is a visibly
            // different, more green-leaning hue; using it here was the
            // confirmed, measured cause of the curve reading as "too
            // cyan" against the Reference. `curveColor` below is this
            // measured value, used only for this curve's core/glow — the
            // shared `accentCyan` token (used elsewhere, e.g. the "FX"
            // title accent) is untouched.
            let curveColor = Color(red: 0.29, green: 0.58, blue: 0.83)

            let curveSamples = stride(from: 0.0, through: 1.0, by: 1.0 / 320.0).map { t in
                (t: t, point: CGPoint(x: t * size.width, y: curveY(at: t) * size.height))
            }

            // 1. Base: a wider, dim stroke underneath the glow.
            var previousBase = curveSamples[0].point
            for sample in curveSamples.dropFirst() {
                let opacity = curveCoreOpacity(at: sample.t) * 0.30
                if opacity > 0.004 {
                    var segment = Path()
                    segment.move(to: previousBase)
                    segment.addLine(to: sample.point)
                    context.stroke(segment, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(opacity)), lineWidth: 6)
                }
                previousBase = sample.point
            }

            // 2. Soft glow: a real Gaussian blur layer, using its own
            // curveGlowOpacity envelope. Widened (blur radius and stroke
            // width both increased) and the core's own opacity/width eased
            // back (below) — a direct side-by-side against the Reference
            // showed this file's glow reading as a sharp, narrow cyan line
            // with a thin halo, where the Reference's is a visibly wider,
            // softer diffusion around a less dominant core.
            context.drawLayer { layer in
                layer.addFilter(.blur(radius: size.width * 0.02))
                var previousGlow = curveSamples[0].point
                for sample in curveSamples.dropFirst() {
                    let opacity = curveGlowOpacity(at: sample.t)
                    if opacity > 0.02 {
                        var segment = Path()
                        segment.move(to: previousGlow)
                        segment.addLine(to: sample.point)
                        layer.stroke(segment, with: .color(curveColor.opacity(opacity)), lineWidth: 5)
                    }
                    previousGlow = sample.point
                }
            }

            // 3. Bright core line on top, using curveCoreOpacity — thinner
            // and less saturated than before so the glow (above) reads as
            // the dominant effect, matching the Reference.
            var previousCore = curveSamples[0].point
            for sample in curveSamples.dropFirst() {
                let opacity = curveCoreOpacity(at: sample.t)
                if opacity > 0.02 {
                    var segment = Path()
                    segment.move(to: previousCore)
                    segment.addLine(to: sample.point)
                    context.stroke(segment, with: .color(curveColor.opacity(min(1.0, opacity * 0.85))), lineWidth: 1.0)
                }
                previousCore = sample.point
            }
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
