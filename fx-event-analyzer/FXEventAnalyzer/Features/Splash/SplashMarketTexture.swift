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
    /// This Reference's own background (~RGB 0,10,22) is close to
    /// `SplashView`'s `backgroundPrimary` (~RGB 10,14,26), but not
    /// identical — relying on `.blendMode(.screen)` alone to hide that gap
    /// (the original approach here) was confirmed via a real device
    /// screenshot to leave a faint but visible seam at the image's top
    /// edge, most noticeable crossing the tagline text right above it
    /// (measured (10,14,26) just outside the image's bounds against
    /// (11,23,47) just inside). Same fix as `candles` below: this
    /// Reference's own alpha channel is authored here from its brightness
    /// (background pixels near-transparent, the glowing curve/mesh
    /// near-opaque, the source's own falloff kept as a smooth ramp) so the
    /// background composites as genuinely transparent rather than merely
    /// dark, and the seam no longer depends on the two colors matching.
    /// `.blendMode(.screen)` is kept on top of that real transparency so
    /// the glow still reads as light adding onto `SplashView`'s background.
    ///
    /// Sized and positioned via `aspectRatio(contentMode: .fit)` at the
    /// screen's own width (never stretched, so the Reference's true
    /// proportions are preserved at any device size). `topAnchorFraction`
    /// was 0.565 — user feedback that the curve/mesh sat too high was
    /// confirmed by directly re-measuring where the mesh grid becomes
    /// visible in `docs/projects/fx-event-analyzer/mockups/
    /// splash-screen-reference-v1.png` (still this screen's layout
    /// Reference even though the curve/mesh *art* itself now comes from
    /// `SplashCurveMesh`): ~68% down the screen, well below 0.565. Raised
    /// to 0.66 — not the full measured value, to keep some headroom above
    /// the loading bar rather than chase the Reference's own crop exactly.
    private var mesh: some View {
        GeometryReader { geometry in
            let imageWidth = geometry.size.width
            let imageHeight = imageWidth * (877.0 / 1794.0)
            let topAnchorFraction = 0.66
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
    /// Same background-seam issue as `mesh` (see its doc comment), worse
    /// here since this Reference's own background (~RGB 1,10,37) reads
    /// measurably bluer than `SplashView`'s `backgroundPrimary`
    /// (~RGB 10,14,26) — confirmed via a real CI capture as a clearly
    /// visible rectangular seam (measured (10,14,26) just outside the
    /// image's bounds against (11,27,64) just inside). Same fix: this
    /// Reference's own alpha channel is authored here from its brightness
    /// (background pixels near-transparent, the glowing candles/curve
    /// near-opaque, the source's own falloff kept as a smooth ramp)
    /// instead of relying on background color matching the destination.
    /// `.blendMode(.screen)` is kept on top of that real transparency so
    /// the glow still reads as light adding onto `mesh` beneath it.
    ///
    /// Sized and positioned via `aspectRatio(contentMode: .fit)` at the
    /// screen's own width (never stretched, so the Reference's true
    /// proportions are preserved at any device size). `topAnchorFraction`
    /// was 0.53, reused from the previous procedural candles without
    /// re-checking it against this new Reference — user feedback that the
    /// candles sat too high was confirmed by re-measuring the tallest
    /// candle's own top edge in `docs/projects/fx-event-analyzer/mockups/
    /// splash-screen-reference-v1.png` (still this screen's layout
    /// Reference; see `mesh`'s doc comment): ~57% down the screen. Raised
    /// to 0.57 to match.
    private var candles: some View {
        GeometryReader { geometry in
            let imageWidth = geometry.size.width
            let imageHeight = imageWidth * (1536.0 / 1024.0)
            let topAnchorFraction = 0.57
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
