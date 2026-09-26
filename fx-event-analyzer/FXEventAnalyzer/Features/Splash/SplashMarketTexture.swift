import SwiftUI

/// SCR-000 Splash's lower-background decoration. Both layers here are
/// Reference art used as real image assets rather than redrawn — the same
/// lesson learned twice over: procedural reconstruction (Bezier/
/// Catmull-Rom, sigmoid, sine curves for the mesh; a tuned random walk for
/// the candles) kept drifting from each Reference's actual shape, color,
/// and glow no matter how many times it was re-measured, while the real
/// pixels sidestep that class of error entirely. See `mesh`'s and
/// `candles`'s doc comments for each asset's own Reference. Like Home's
/// `HeroMapTexture`, this app has no real chart-data source to draw from
/// at Splash time (nothing is fetched yet), so this whole background is a
/// deliberate decorative illustration, not real market data — true of the
/// Reference art itself, not something this file needs to disclaim on top
/// of it.
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

    /// HQ instruction, this round: the same treatment as `mesh` — stop
    /// re-tuning the procedural candle drawing (a random walk with drift,
    /// noise, and a hand-picked glow) and use the Reference image itself.
    /// The previous procedural version's irregular rising-staircase shape
    /// was already a tuned approximation of an *earlier* Reference; this
    /// round supplied a new, higher-fidelity Reference of the actual
    /// candlesticks (1024x1536, unmodified — no logo/text/UI, only the
    /// glowing candles and a faint crossing curve over a near-black
    /// background) added directly to the asset catalog as `SplashCandles`.
    /// An organic, irregularly-spaced climb like this is exactly the kind
    /// of shape that kept drifting from its Reference under procedural
    /// tuning no matter how it was re-measured (the same lesson `mesh`
    /// already learned) — using the real pixels sidesteps that class of
    /// error entirely.
    ///
    /// Unlike `mesh`'s Reference, this one's own background (~RGB 1,10,37)
    /// reads measurably bluer than `SplashView`'s `backgroundPrimary`
    /// (~RGB 10,14,26) — close enough for `mesh` that `.blendMode(.screen)`
    /// alone hid the seam, but confirmed via a real CI capture to leave a
    /// visible rectangular seam here (measured (10,14,26) just outside the
    /// image's bounds against (11,27,64) just inside). So this Reference's
    /// own alpha channel is authored here from its brightness (background
    /// pixels near-transparent, the glowing candles/curve near-opaque,
    /// with the source's own natural glow falloff preserved as a smooth
    /// ramp rather than a hard cutoff) instead of relying on background
    /// color matching the destination. `.blendMode(.screen)` is kept on
    /// top of that real transparency so the glow still reads as light
    /// adding onto `mesh` beneath it, without the opaque background that
    /// caused the seam.
    ///
    /// Sized and positioned via `aspectRatio(contentMode: .fit)` at the
    /// screen's own width (never stretched, so the Reference's true
    /// proportions are preserved at any device size) and anchored so the
    /// candles' own highest point (≈45% down the source image) lands at
    /// the same screen fraction the previous procedural candles' tallest
    /// candle used, keeping this round scoped to the candles themselves
    /// rather than also re-deciding their on-screen placement.
    private var candles: some View {
        GeometryReader { geometry in
            let imageWidth = geometry.size.width
            let imageHeight = imageWidth * (1536.0 / 1024.0)
            let topAnchorFraction = 0.53
            let contentTopFraction = 0.454 // where the candles' own highest point enters the source image, top-to-bottom
            let topOffset = topAnchorFraction * geometry.size.height - contentTopFraction * imageHeight

            Image("SplashCandles")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: imageWidth, height: imageHeight)
                .blendMode(.screen)
                .offset(y: topOffset)
        }
    }
}
