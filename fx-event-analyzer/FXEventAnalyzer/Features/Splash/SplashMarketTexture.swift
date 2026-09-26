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

    /// HQ instruction, explicit: stop tuning an abstract sigmoid+sine
    /// formula and instead pixel-trace the Reference's actual curve into
    /// numeric (x, y) control points, normalized 0...1 against the app's
    /// own display area (not the phone-mockup image), then rebuild from
    /// those coordinates with real interpolated control points — not a
    /// guessed closed-form curve. `curveControlPoints` below is that trace
    /// (5%-of-width steps, read directly off a 5%-gridded crop of the
    /// Reference, cross-checked against pixel brightness at each point).
    ///
    /// Two things that formula-based approach got structurally wrong, only
    /// visible once actually plotted against the measured points:
    /// 1. The curve is NOT a monotonic descend-then-flatten that spans the
    ///    full width. It descends from (0, 0.695) to a shallow minimum
    ///    around (0.65, 0.80), and its *glow itself fades out* well before
    ///    the right edge — past x≈0.65 the Reference is close to plain
    ///    background, confirmed by brightness sampling (peak brightness
    ///    ~170-211 around x=0.3-0.5, down to ~50 by x=0.9, indistinguishable
    ///    from the background floor). A curve that stays bright all the way
    ///    across (this file's previous versions) is a different shape, not
    ///    just a differently-tuned one.
    /// 2. The mesh crosshatch fades out earlier still (by x≈0.35-0.45).
    /// `curveY(at:)` interpolates `curveControlPoints` with a Catmull-Rom
    /// spline (passes exactly through every measured point, unlike a
    /// hand-fit sigmoid), and both the ridge curve and every mesh row/
    /// diagonal read their vertical position through this one function —
    /// so the mesh is geometrically locked to the curve's own measured
    /// shape rather than an independent formula that happens to look
    /// similar. Verified against the Reference with a Python
    /// re-implementation (full_scene_v10_bezier2) before porting.
    private var mesh: some View {
        Canvas { context, size in
            // Pixel-traced from the Reference at 5%-of-width steps
            // (normalized x, y against the app's own display bounds, i.e.
            // status bar to home indicator — not the phone mockup image).
            // x stops at 0.65 because that's where the curve's own glow
            // has already faded into the background; extrapolated flat
            // beyond that since curveOpacity(t) suppresses it to ~0 there
            // anyway.
            let curveControlPoints: [CGPoint] = [
                CGPoint(x: 0.00, y: 0.695), CGPoint(x: 0.05, y: 0.703),
                CGPoint(x: 0.10, y: 0.715), CGPoint(x: 0.15, y: 0.725),
                CGPoint(x: 0.20, y: 0.738), CGPoint(x: 0.25, y: 0.752),
                CGPoint(x: 0.30, y: 0.763), CGPoint(x: 0.35, y: 0.772),
                CGPoint(x: 0.40, y: 0.780), CGPoint(x: 0.45, y: 0.787),
                CGPoint(x: 0.50, y: 0.792), CGPoint(x: 0.55, y: 0.796),
                CGPoint(x: 0.60, y: 0.798), CGPoint(x: 0.65, y: 0.800),
            ]

            // Catmull-Rom spline through curveControlPoints — passes
            // exactly through every measured point (unlike a fitted
            // sigmoid), with smooth (C1) tangents between them.
            func curveY(at x: Double) -> Double {
                let pts = curveControlPoints
                let clampedX = min(max(x, 0), pts[pts.count - 1].x)
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

            func smoothstep(_ edge0: Double, _ edge1: Double, _ x: Double) -> Double {
                let t = min(max((x - edge0) / (edge1 - edge0), 0), 1)
                return t * t * (3 - 2 * t)
            }
            // Brightness envelope pixel-sampled alongside the curve's
            // position: dim entering the frame, peaking x≈0.3-0.5, fading
            // to background by x≈0.9 — not a constant-opacity line.
            func curveOpacity(at t: Double) -> Double {
                smoothstep(0.0, 0.15, t) * (1 - smoothstep(0.45, 0.90, t))
            }
            // The mesh crosshatch fades out earlier than the ridge curve
            // itself (by x≈0.35-0.45 in the Reference, not 0.90).
            func meshOpacity(at t: Double) -> Double {
                smoothstep(0.0, 0.05, t) * (1 - smoothstep(0.22, 0.48, t))
            }

            let rows = 12
            let rowSpacing = 0.022 // normalized fraction of height per row, below the ridge
            func rowY(_ r: Int, at t: Double) -> Double {
                (curveY(at: t) + Double(r) * rowSpacing) * size.height
            }

            // Weft: every row reads its shape through the SAME curveY(at:)
            // used by the ridge — geometrically the same curve, not an
            // independently-tuned lookalike — offset downward per row and
            // fading both by row distance and by meshOpacity(at:).
            let cols = 40
            for r in 0...rows {
                let rowFade = max(0, 1 - Double(r) / Double(rows) * 1.1)
                var previous = CGPoint(x: 0, y: rowY(r, at: 0))
                for c in 1...cols {
                    let t = Double(c) / Double(cols)
                    let point = CGPoint(x: t * size.width, y: rowY(r, at: t))
                    let midT = (Double(c) - 0.5) / Double(cols)
                    let opacity = meshOpacity(at: midT) * 0.5 * rowFade
                    if opacity > 0.004 {
                        var segment = Path()
                        segment.move(to: previous)
                        segment.addLine(to: point)
                        context.stroke(segment, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(opacity)), lineWidth: 0.8)
                    }
                    previous = point
                }
            }

            // Warp: sheared diagonals riding the same rowY(_:at:), so they
            // curve with the mesh instead of cutting straight across it.
            let shearPerRow = size.width / Double(cols) * 0.6
            for j in -cols...(cols * 2) {
                var path = Path()
                var started = false
                var tSum = 0.0
                var tCount = 0.0
                for r in 0...rows {
                    let x = Double(j) * (size.width / Double(cols)) + Double(r) * shearPerRow
                    guard x >= -20, x <= size.width * 0.58 else { continue }
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
                let opacity = meshOpacity(at: tSum / tCount) * 0.45
                guard opacity > 0.004 else { continue }
                context.stroke(path, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(opacity)), lineWidth: 0.6)
            }

            // The ridge curve itself, split into three explicitly separate
            // layers per HQ's instruction (base curve / bright core / soft
            // glow), rather than one stroke standing in for all three:
            let curveSamples = stride(from: 0.0, through: 1.0, by: 1.0 / 260.0).map { t in
                (t: t, point: CGPoint(x: t * size.width, y: curveY(at: t) * size.height))
            }

            // 1. Base: a wider, dim stroke underneath the glow.
            var previousBase = curveSamples[0].point
            for sample in curveSamples.dropFirst() {
                let opacity = curveOpacity(at: sample.t) * 0.35
                if opacity > 0.004 {
                    var segment = Path()
                    segment.move(to: previousBase)
                    segment.addLine(to: sample.point)
                    context.stroke(segment, with: .color(DesignTokens.Colors.accentDeepBlue.opacity(opacity)), lineWidth: 6)
                }
                previousBase = sample.point
            }

            // 2. Soft glow: a real Gaussian blur layer, not a wide faint
            // stroke standing in for one.
            context.drawLayer { layer in
                layer.addFilter(.blur(radius: size.width * 0.012))
                var previousGlow = curveSamples[0].point
                for sample in curveSamples.dropFirst() {
                    let opacity = curveOpacity(at: sample.t)
                    if opacity > 0.02 {
                        var segment = Path()
                        segment.move(to: previousGlow)
                        segment.addLine(to: sample.point)
                        layer.stroke(segment, with: .color(DesignTokens.Colors.accentCyan.opacity(opacity)), lineWidth: 3)
                    }
                    previousGlow = sample.point
                }
            }

            // 3. Bright core line on top.
            var previousCore = curveSamples[0].point
            for sample in curveSamples.dropFirst() {
                let opacity = curveOpacity(at: sample.t)
                if opacity > 0.02 {
                    var segment = Path()
                    segment.move(to: previousCore)
                    segment.addLine(to: sample.point)
                    context.stroke(segment, with: .color(DesignTokens.Colors.accentCyan.opacity(min(1.0, opacity * 1.1))), lineWidth: 1.2)
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
