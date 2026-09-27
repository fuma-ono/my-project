import SwiftUI

/// SCR-000 Splash / Launch Screen.
///
/// Direction change (2026-09-25): HQ now supplies reference images
/// directly rather than a SwiftUI source package, one screen at a time —
/// this restores the literal-reproduction approach from the original
/// "Reference画像の完全再現" instruction (2026-09-18), which this exact
/// screen was already built and iteratively measured against before the
/// later HQ SwiftUI-package rounds (HQ Frontend / HQ UI Master v5 / V5
/// Pixel Frontend) temporarily replaced it. `BrandMark` (the literal
/// cropped mark image — HQ rejected a self-drawn/SF Symbol stand-in for
/// this exact reason back then: "自分で作成するのではなく画像を真似ろ"),
/// `SplashMarketTexture` (glowing two-tone candlesticks + crossing
/// curves), `SplashLoadingBar`, and `DesignTokens` were never touched by
/// those later rounds and are restored here unchanged. The one real
/// difference from that prior version: the tagline. The current reference
/// image reads "Turn Economic Events / into Trading Opportunities" — the
/// literal wording from before Phase 5 (commit 6578d6a) intentionally
/// changed it to "Understand Economic Events / & FX Reactions" to avoid
/// implying investment advice (features.md excludes 投資助言). The user's
/// explicit instruction this round is exact image reproduction, so the
/// image's current wording is used as given; flagged here rather than
/// silently overriding that earlier scope concern.
struct SplashView: View {
    @StateObject private var viewModel: SplashViewModel

    init(viewModel: @autoclosure @escaping () -> SplashViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    /// The previous version of this gradient (a flat +6/+16 delta
    /// top-to-bottom) was confirmed via a real capture to be too subtle to
    /// read as a gradient at all — user feedback wanted the effect
    /// concentrated where it actually matters: a visible glow bleeding
    /// upward from `SplashMarketTexture`'s own glowing curve/mesh/candles,
    /// not a uniform wash. `backgroundGlow` below does that (a radial
    /// bloom anchored near the imagery), so this vertical gradient now
    /// only needs to keep the overall tone from reading as perfectly flat
    /// above the glow — bumped from a barely-perceptible delta to a
    /// clearly visible one.
    private var backgroundGradient: LinearGradient {
        LinearGradient(
            colors: [
                DesignTokens.Colors.backgroundPrimary,
                Color(red: 14.0 / 255, green: 34.0 / 255, blue: 66.0 / 255)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// The "発光している感じ" (glowing feel) user feedback asked for near
    /// the curve/mesh/candles: a soft radial bloom of the same blue family
    /// as their own glow, anchored close to where `SplashMarketTexture`'s
    /// `mesh` and `candles` sit (topAnchorFractions 0.66 / 0.54) and fading
    /// out well before it reaches the title block above. Sits between the
    /// flat gradient and the imagery in the ZStack so it reads as ambient
    /// light the glowing art is casting, not a separate decoration.
    ///
    /// First attempt used `endRadius: height * 0.5` at 0.55/0.25 opacity —
    /// confirmed via a real capture to wash the *entire* screen blue,
    /// visibly tinting even the title block instead of staying localized.
    /// Radius cut to 0.22 of height and both opacities roughly halved so
    /// the bloom stays contained to the imagery's own neighborhood.
    private var backgroundGlow: some View {
        GeometryReader { geometry in
            RadialGradient(
                colors: [
                    Color(red: 28.0 / 255, green: 110.0 / 255, blue: 210.0 / 255).opacity(0.28),
                    Color(red: 20.0 / 255, green: 80.0 / 255, blue: 170.0 / 255).opacity(0.12),
                    Color.clear
                ],
                center: UnitPoint(x: 0.4, y: 0.72),
                startRadius: 0,
                endRadius: geometry.size.height * 0.22
            )
        }
    }

    /// "FX"'s own two-tone treatment, sampled directly off the App Icon
    /// Reference (docs/projects/fx-event-analyzer/mockups/
    /// app-icon-reference-v1.png) rather than this screen's own — user
    /// feedback confirmed "F" and "X" are deliberately different colors
    /// there (matching the brand mark graphic's own light-cyan-to-blue
    /// gradient), not a single flat accent: F ~RGB(5,250,255), a near-pure
    /// cyan; X ~RGB(5,170,255), a more saturated blue. Scoped locally
    /// rather than changing any shared token.
    private var splashTitleAccentF: Color {
        Color(red: 5.0 / 255, green: 250.0 / 255, blue: 255.0 / 255)
    }

    private var splashTitleAccentX: Color {
        Color(red: 5.0 / 255, green: 170.0 / 255, blue: 255.0 / 255)
    }

    var body: some View {
        ZStack {
            backgroundGradient
                .ignoresSafeArea()

            backgroundGlow
                .ignoresSafeArea()
                .allowsHitTesting(false)

            SplashMarketTexture()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .ignoresSafeArea()

            // Every position and gap here was measured pixel-by-pixel off
            // the Reference (a real iPhone-aspect-ratio screenshot with
            // status bar, so its fractions translate directly): mark top
            // ~24% of full screen height, title-to-tagline gap ~3%.
            // bottomContent is anchored from the bottom edge via Spacer
            // rather than a computed top-offset — confirmed via a real CI
            // screenshot that the earlier top-padding-percentage approach
            // silently failed to render this block at all.
            GeometryReader { geometry in
                VStack(spacing: 0) {
                    VStack(spacing: DesignTokens.Spacing.xl) {
                        // 106 (itself raised from 97 to correct for
                        // `BrandMarkGraphic`'s own internal padding) still
                        // read as too small per user feedback comparing
                        // against a real capture — raised further to 140,
                        // a clearly-visible increase rather than another
                        // exact-measurement-driven micro-adjustment.
                        BrandMark(width: 140, glow: true)
                        (
                            Text("F")
                                .foregroundStyle(splashTitleAccentF)
                                + Text("X")
                                .foregroundStyle(splashTitleAccentX)
                                + Text(" Event Analyzer")
                                .foregroundStyle(DesignTokens.Colors.textPrimary)
                        )
                        .font(DesignTokens.Typography.splashTitle)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)

                        Text("Turn Economic Events\ninto Trading Opportunities")
                            .font(DesignTokens.Typography.tagline)
                            .foregroundStyle(DesignTokens.Colors.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, DesignTokens.Spacing.lg)
                    .frame(maxWidth: 480) // keeps brand elements from stretching oversized on iPad
                    .frame(width: geometry.size.width)
                    .padding(.top, geometry.size.height * 0.24)

                    Spacer(minLength: 0)

                    bottomContent
                        .padding(.horizontal, DesignTokens.Spacing.lg)
                        .frame(width: geometry.size.width)
                        // Was 0.16 — that earlier fix itself was measured
                        // wrong: it mistook the mesh curve's own brightness
                        // peak (at the time, sitting around 78% of screen
                        // height) for the loading bar. Re-measured directly
                        // off the Reference's brightest-row peak: the real
                        // bar sits at 86.6% of screen height, not 78%. A
                        // fresh CI capture at 0.16 put the bar at 78.3% —
                        // almost exactly where the mesh curve used to be,
                        // which is what caused the two to visibly overlap
                        // once the mesh was separately corrected. 0.077
                        // targets the real, re-verified 86.6%.
                        .padding(.bottom, geometry.size.height * 0.077)
                }
            }
        }
        .task { viewModel.start() }
    }

    @ViewBuilder
    private var bottomContent: some View {
        switch viewModel.state {
        case .initializing:
            // Was .sm (8pt) — the same measurement showed a visibly larger
            // gap between the bar and "Loading..." in the Reference than
            // this rendered.
            VStack(spacing: DesignTokens.Spacing.md) {
                SplashLoadingBar()
                Text("Loading...")
                    .font(DesignTokens.Typography.footnote)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
        case .initializationError:
            ErrorView(
                title: "アプリの初期化に失敗しました",
                message: "もう一度お試しください。",
                onRetry: { viewModel.retry() }
            )
        case .apiConnectionError:
            ErrorView(
                title: "サーバーに接続できませんでした",
                message: "ネットワーク接続を確認し、再試行してください。",
                onRetry: { viewModel.retry() }
            )
        }
    }
}
