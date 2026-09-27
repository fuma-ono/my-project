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

    /// The Reference's own screen background is not perfectly flat — sampled
    /// away from all content, it reads ~RGB(0,6,17) near the top and
    /// ~RGB(0,12,33) near the bottom, a gentle vertical richening. Rendering
    /// `backgroundPrimary` as a flat fill was fine while `mesh`/`candles`
    /// composited seamlessly, but once those were fixed to key out their
    /// own backgrounds via real transparency (see `SplashMarketTexture`),
    /// a real device capture showed the flat fill next to their own subtly
    /// graduated near-transparent edges read as a seam of its own — flat
    /// meeting textured, not a color mismatch this time. Applying the same
    /// delta the Reference shows (+6 green, +16 blue) on top of
    /// `backgroundPrimary` gives this gradient's bottom stop, so the base
    /// itself now carries a continuous tone for the imagery to blend into.
    private var backgroundGradient: LinearGradient {
        LinearGradient(
            colors: [
                DesignTokens.Colors.backgroundPrimary,
                Color(red: 10.0 / 255, green: 20.0 / 255, blue: 42.0 / 255)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// "FX"'s own accent color, sampled directly off the Reference's
    /// brightest letter pixels (~RGB 30,210,255) — a blue-dominant azure,
    /// clearly more blue than `DesignTokens.Colors.accentCyan`
    /// (RGB 52,209,224, where green and blue are nearly equal). Scoped
    /// locally rather than changing the shared `accentCyan` token, which
    /// other screens (e.g. Home's own accent) still rely on looking as it
    /// currently does.
    private var splashTitleAccent: Color {
        Color(red: 30.0 / 255, green: 210.0 / 255, blue: 255.0 / 255)
    }

    var body: some View {
        ZStack {
            backgroundGradient
                .ignoresSafeArea()

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
                        // Was 97 — that earlier measurement compared the
                        // BrandMark frame's own width directly against the
                        // Reference, but `BrandMarkGraphic` has ~14% of
                        // transparent padding baked into its own canvas
                        // (measured via its alpha channel), so the actual
                        // *visible* glyph rendered smaller than the
                        // Reference's own mark. Re-measuring the
                        // Reference's visible glyph width directly (not the
                        // frame) puts it at ~22.6% of screen width; 106
                        // closes that gap once the asset's own padding is
                        // accounted for.
                        BrandMark(width: 106, glow: true)
                        (
                            Text("FX")
                                .foregroundStyle(splashTitleAccent)
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
