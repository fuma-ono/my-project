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
        // candles drawn before mesh — user feedback confirmed the two
        // Reference images visibly cross where they overlap, and the
        // mesh/curve should read as sitting in front of the candles, not
        // behind them.
        ZStack {
            candles
            mesh
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
    /// proportions are preserved at any device size), scaled up by
    /// `scaleFactor` per user feedback wanting the curve/mesh bigger.
    ///
    /// Bug found after two rounds of "still too small" / "it keeps going
    /// backwards" feedback: the mesh *grid* pattern (the actual thing being
    /// asked for) lives in the source image's own left portion, with the
    /// bright curve sweeping across further right. Re-centering the
    /// enlarged image horizontally (the previous approach) crops that same
    /// fraction off the LEFT edge as it grows the image — so a bigger
    /// `scaleFactor` was cropping progressively more of the mesh grid off
    /// the left side of the screen, net-net making the visible grid
    /// *smaller*, exactly backwards from the request. Left-anchored now
    /// (no horizontal offset) instead of centered: enlarging keeps the
    /// grid's own region fully on screen and reads as zooming in on it,
    /// with the overflow instead falling off the right edge, where the
    /// source has little but the fainter curve continuing off-canvas.
    ///
    /// `topAnchorFraction` was 0.565 — user feedback that the curve/mesh
    /// sat too high was confirmed by directly re-measuring where the mesh
    /// grid becomes visible in `docs/projects/fx-event-analyzer/mockups/
    /// splash-screen-reference-v1.png` (still this screen's layout
    /// Reference even though the curve/mesh *art* itself now comes from
    /// `SplashCurveMesh`): ~68% down the screen, well below 0.565. Raised
    /// to 0.66 — not the full measured value, to keep some headroom above
    /// the loading bar rather than chase the Reference's own crop exactly.
    ///
    /// User feedback (2026-09-29): move the curve/mesh up slightly.
    /// 0.66 → 0.63. `candles`'s fade-out window (screen-space, tuned to
    /// stop the candle glow right where mesh begins) is shifted up by the
    /// same 0.03 alongside this so the two keep the same clearance instead
    /// of the candle glow now crossing into mesh's new, higher position.
    private var mesh: some View {
        GeometryReader { geometry in
            let scaleFactor = 1.45
            let imageWidth = geometry.size.width * scaleFactor
            let imageHeight = imageWidth * (877.0 / 1794.0)
            let topAnchorFraction = 0.63
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
    /// went 0.53 → 0.57 last round (re-measured off the layout Reference's
    /// tallest-candle position). User feedback on the resulting capture:
    /// the curve/mesh position now reads correctly, but the candles
    /// themselves should sit slightly higher — nudged back up to 0.54, a
    /// smaller fraction (higher on screen) than 0.57 but still above the
    /// original, too-high 0.53.
    ///
    /// User feedback (2026-09-29), round 2: swapped again for another new
    /// Reference image, still 1813×868 (content spans the full source
    /// width just like the previous one, x≈0.0 to 0.998), but a cleaner
    /// candlestick-only illustration — no embedded wave/curve underneath
    /// this time, just the glowing candles on a plain dark background.
    /// Same brightness-derived alpha treatment as every other Reference
    /// asset here (this PNG also ships without a usable content-mask
    /// alpha channel). One calibration difference from the previous
    /// asset: a first pass reused that asset's brightness floor/ceiling
    /// (25/110) and rendered the candles as one continuous smeared blob —
    /// this source's inter-candle glow sits in a higher brightness band,
    /// so that ceiling was blowing it out to full opacity along with the
    /// candle bodies themselves. Raised to 35/190 (floor/ceiling), checked
    /// against a cropped close-up of the raw source to confirm individual
    /// candles read as distinct bars again, matching the source itself.
    ///
    /// Measured directly off the new source: still full-width
    /// (`scaleFactor` 1.0, no horizontal crop/offset), tallest candle
    /// (top-right) enters at source y≈108/868 ≈ 0.124 from the top —
    /// higher up than the previous asset's 0.199, so at the same
    /// `topAnchorFraction` (0.47, reused unchanged) the whole image sits
    /// slightly lower on screen and its bottom edge reaches a bit further
    /// into `mesh`'s territory than before.
    ///
    /// Same explicit ask as last round: delete the candlestick portion
    /// that overlaps `mesh`. Widened the fade's end fraction (0.65 → 0.67)
    /// to reach this version's slightly-lower bottom edge.
    ///
    /// User feedback (2026-09-29), round 3: candles too small, wants them
    /// bigger. `scaleFactor` 1.0 → 1.35 — same "just scale it up" lever
    /// `mesh` already uses. Unlike `mesh`, this source's content already
    /// spans the full image width (x≈0.0→0.998), so growing it needs a
    /// horizontal anchor decision: left-anchoring (mesh's default, and what
    /// no `offset(x:)` would do here) would push the climb's right-side
    /// peak — the most prominent part of the shape — off the right edge as
    /// it grows. Right-anchored instead via `offsetX`, pinning the image
    /// frame's right edge to the screen's right edge at any scale, so
    /// enlarging reads as zooming in on the peak while the flatter/smaller
    /// left-side start of the climb is what runs off-canvas.
    /// `topAnchorFraction`/`contentTopFraction` need no change: the
    /// `topOffset` formula already keeps the tallest candle pinned to the
    /// same screen fraction regardless of `imageHeight`, and the fade
    /// fractions are screen-space (not image-space), so the mesh-overlap
    /// cutoff still lands at the same screen position after the resize.
    ///
    /// Round 4: still too small — bumped again, 1.35 → 1.6. Same right-
    /// anchor/top-anchor invariants apply at any `scaleFactor`, confirmed
    /// via the round-3 capture already showing headroom between the peak
    /// and the tagline above it, so this is a safe further increase along
    /// the same lever rather than a new mechanism.
    ///
    /// User feedback (2026-09-29), round 5: move the candles down
    /// slightly, alongside the same request for `SplashView`'s brand
    /// mark/title/tagline block. `topAnchorFraction` 0.47 → 0.49 — the
    /// `mesh` layer isn't part of this request and keeps its own
    /// `topAnchorFraction` (0.66) unchanged; the fade fractions below are
    /// screen-space already (not relative to `topAnchorFraction`), so the
    /// mesh-overlap cutoff still lands at the same screen position with no
    /// further change needed.
    ///
    /// Round 6: this time `mesh` alone moves up (0.66 → 0.63; candles'
    /// own `topAnchorFraction` here is untouched). The fade window is
    /// shifted up by that same 0.03 (0.58→0.55, 0.67→0.64) so it still
    /// stops the candle glow right at mesh's new, higher starting point
    /// instead of now overlapping it.
    ///
    /// User feedback (2026-09-29), round 7: the candles looked hazy even
    /// well above where they actually reach `mesh` — because at
    /// `topAnchorFraction` 0.49, `fadeStartScreenFraction` 0.55 only left
    /// ~0.06 of screen height fully opaque before the gradient began, so
    /// most of the visible climb (not just the small tail actually
    /// touching `mesh`) sat inside the fade and read as washed-out rather
    /// than crisp. Narrowed the fade window itself — `fadeStartScreenFraction`
    /// 0.55 → 0.61 (`fadeEndScreenFraction` unchanged at 0.64, already
    /// confirmed via a real capture to cut cleanly right at mesh's bright
    /// curve line) — so only the short stretch actually nearing mesh
    /// fades, and everything above stays at full opacity.
    ///
    /// User feedback (2026-09-29), round 8: candles were disappearing —
    /// on the sharpened capture, the earlier/lower-value candles on the
    /// left side of the source image were plainly missing, not just
    /// faded. Root cause: `scaleFactor` 1.6 combined with the right-anchor
    /// `offsetX` (introduced in round 3 so enlarging zooms toward the
    /// peak) pushes the source image's own left ~38% off the left edge of
    /// the screen entirely — real content, not the vertical mesh-overlap
    /// fade, was responsible for that empty gap. Per this feedback, only
    /// the actual mesh-overlap portion should ever be removed. Reverted
    /// `scaleFactor` 1.6 → 1.0 (`offsetX` becomes a no-op at this scale,
    /// content fills exactly the screen width with nothing cropped on
    /// either edge) so the whole climb is visible again; the vertical
    /// fade fractions below are screen-space and need no change — they
    /// still cut only the portion nearing `mesh`, regardless of scale.
    ///
    /// User feedback (2026-09-29), round 9: pasted a specific earlier
    /// capture (matching commit f8dbef7 — `scaleFactor` 1.6,
    /// `topAnchorFraction` 0.47, fade 0.58→0.67) and asked for the candles
    /// to look like that again. Confirmed with them directly that this
    /// capture is the same right-anchor-crops-the-left state round 8 just
    /// reverted — they chose size/brightness over full-width visibility,
    /// so `scaleFactor` is back to 1.6 and `topAnchorFraction` back to
    /// 0.47 to match. Left the fade window at 0.55/0.64 rather than
    /// copying 0.58/0.67 verbatim: those exact numbers were tuned for
    /// `mesh` at its old `topAnchorFraction` (0.66), which has since
    /// moved up to 0.63 (round 6, a separate request this round doesn't
    /// touch) — reusing them as-is would let the candle glow extend past
    /// mesh's new, higher starting point. 0.55/0.64 is the same fade
    /// width shifted to match mesh's current position instead.
    ///
    /// User feedback (2026-09-29), round 10: the candles read hazy from
    /// the left edge to roughly the middle. First attempt diagnosed this
    /// as a brightness problem (the raw source's own left-third vs
    /// right-third pixel brightness genuinely differs) and re-authored
    /// alpha with a spatially adaptive ceiling — but verifying that
    /// attempt against a capture built with an *accurate on-screen
    /// simulation* (replicating this view's exact resize/right-anchor-crop
    /// math in Python, not just compositing the full source) showed almost
    /// no visible change: the region that brightness fix most helped
    /// (source x≈300-450) is the deep trough of the climb, which sits
    /// entirely off-canvas at this `scaleFactor`/right-anchor — the
    /// on-screen range is only source x∈[≈680,1813].
    ///
    /// Re-diagnosed by zooming into the raw source at matching pixel
    /// scale, left cluster vs right/peak cluster: the real cause is
    /// candle *size*, not brightness — the early candles are drawn
    /// genuinely tiny (a handful of source pixels tall/wide) while the
    /// peak candles are large and chunky, but the artwork's glow/blur
    /// radius is the same fixed number of pixels everywhere. For a small
    /// candle that fixed blur is a large fraction of its whole extent, so
    /// it reads as a soft blob; for a large candle the same blur is a
    /// thin rim around a solid core, so it reads crisp. This is a
    /// resolution/sharpness problem, not an opacity one, and no amount of
    /// floor/ceiling tuning fixes it.
    ///
    /// Fix: an unsharp mask (`ImageFilter.UnsharpMask`, radius 8, percent
    /// 180, threshold 2) applied to the RGB source before deriving alpha
    /// from brightness (floor/ceiling back to the original global 35/190
    /// — no longer needed once the real cause is addressed). Verified via
    /// the same accurate on-screen simulation: candle body edges read
    /// visibly more defined throughout the visible range, including the
    /// small early candles, with no ringing/halo artifacts introduced
    /// around the already-large peak candles. No SwiftUI code changed —
    /// only `SplashCandles.png` itself.
    private var candles: some View {
        GeometryReader { geometry in
            let scaleFactor = 1.6
            let imageWidth = geometry.size.width * scaleFactor
            let imageHeight = imageWidth * (868.0 / 1813.0)
            let topAnchorFraction = 0.47
            let contentTopFraction = 108.0 / 868.0 // where the candles' own highest point enters the source image, top-to-bottom
            let topOffset = topAnchorFraction * geometry.size.height - contentTopFraction * imageHeight
            let offsetX = geometry.size.width - imageWidth // pins the image's right edge to the screen's right edge

            let fadeStartScreenFraction = 0.55
            let fadeEndScreenFraction = 0.64
            let fadeStartLocal = min(1, max(0, (fadeStartScreenFraction * geometry.size.height - topOffset) / imageHeight))
            let fadeEndLocal = min(1, max(fadeStartLocal, (fadeEndScreenFraction * geometry.size.height - topOffset) / imageHeight))

            Image("SplashCandles")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: imageWidth, height: imageHeight)
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .white, location: fadeStartLocal),
                            .init(color: .clear, location: fadeEndLocal)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(width: imageWidth, height: imageHeight)
                )
                .blendMode(.screen)
                .offset(x: offsetX, y: topOffset)
        }
    }
}
