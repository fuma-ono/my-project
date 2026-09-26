import SwiftUI

/// SCR-000 Splash's lower-background decoration. Candle bodies are
/// pixel-sampled directly from the (earlier, phone-mockup) Reference:
/// RGB(30,70,135) against a RGB(5,15,30)-ish background — dim, desaturated
/// steel-blue, close to this app's own `accentDeepBlue` token. The
/// curve/mesh below the candles is a different story: after several
/// procedural (Bezier/Catmull-Rom, sigmoid, sine) reconstructions each
/// kept drifting from the real shape/color/glow, HQ supplied the curve's
/// own Reference image directly and asked for it used as an asset instead
/// of redrawn — see `mesh`'s doc comment. Like Home's `HeroMapTexture`,
/// this app has no real chart-data source to draw from at Splash time
/// (nothing is fetched yet), so the candles remain a deliberate
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

    /// HQ instruction, this round: stop reconstructing the curve/mesh
    /// procedurally and evaluate using the Reference image itself as a
    /// background asset first. `SplashCurveMesh` is that Reference
    /// (1794x877, unmodified — it contains no logo/text/UI to accidentally
    /// bake in, only the glowing curve+mesh art over a near-black
    /// background) added directly to the asset catalog. This replaces the
    /// repeated procedural attempts (Bezier/Catmull-Rom control points,
    /// sigmoid/sine formulas) that kept drifting from the actual shape,
    /// color, and glow no matter how many times they were re-measured —
    /// using the real pixels sidesteps that class of error entirely.
    ///
    /// `.blendMode(.screen)` makes the image's own near-black background
    /// composite as effectively transparent against `SplashView`'s own
    /// background color underneath (the two are close but not identical —
    /// screen blending removes any risk of a visible seam at the image's
    /// edges rather than relying on the colors matching exactly), while
    /// the glowing curve/mesh content composites normally on top.
    ///
    /// Sized and positioned via `aspectRatio(contentMode: .fit)` at the
    /// screen's own width (never stretched, so the Reference's true
    /// proportions are preserved at any device size) and anchored so the
    /// curve's start point (≈27% down the source image) lands just below
    /// the candles.
    private var mesh: some View {
        GeometryReader { geometry in
            let imageWidth = geometry.size.width
            let imageHeight = imageWidth * (877.0 / 1794.0)
            let topAnchorFraction = 0.565
            let curveStartFraction = 0.27 // where the main curve enters the source image, top-to-bottom
            let topOffset = topAnchorFraction * geometry.size.height - curveStartFraction * imageHeight

            Image("SplashCurveMesh")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: imageWidth, height: imageHeight)
                .blendMode(.screen)
                .offset(y: topOffset)
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
