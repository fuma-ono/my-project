import SwiftUI

/// SCR-000 Splash / Launch Screen.
///
/// Rebuilt under HQ's "Reference画像の完全再現" instruction (2026-09-18,
/// App Icon + Splash round): a literal reproduction of
/// `docs/projects/fx-event-analyzer/mockups/splash-screen-reference-v1.png`,
/// not a from-scratch design. Absolute rule enforced here by omission:
/// this view has no dependency on any economic/FX data type. It shows
/// brand + initialization status only.
struct SplashView: View {
    @StateObject private var viewModel: SplashViewModel

    init(viewModel: @autoclosure @escaping () -> SplashViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.backgroundPrimary
                .ignoresSafeArea()

            SplashMarketTexture()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .ignoresSafeArea()

            // Every position and gap here was measured pixel-by-pixel off
            // the Reference (bounding-box detection on the mark, per-row
            // brightness scans for the title/tagline text bands), not
            // eyeballed: mark top 14.8%/bottom 27.4% (width ~24% of
            // screen width), title text band 32.4–36.8%, tagline lines at
            // 42.1–44.0% and 46.2–48.1%, loading bar ~89.5%. The mark-to-
            // title gap (~4.3% ≈ 43pt) and title-to-tagline gap
            // (~4.5% ≈ 45pt) are both far larger than a tight stacked
            // VStack would produce, which is why this isn't nested
            // VStacks with small spacing.
            GeometryReader { geometry in
                ZStack(alignment: .top) {
                    VStack(spacing: DesignTokens.Spacing.xl) {
                        BrandMark(width: 94, glow: true)
                        (
                            Text("FX")
                                .foregroundStyle(DesignTokens.Colors.accentCyan)
                                + Text(" Event Analyzer")
                                .foregroundStyle(DesignTokens.Colors.textPrimary)
                        )
                        .font(DesignTokens.Typography.splashTitle)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)

                        // Not the Reference's earlier "Turn Economic
                        // Events into Trading Opportunities" wording —
                        // that phrasing was deliberately changed in
                        // Phase 5 (commit 6578d6a) because it implied
                        // trading signals/advice, out of this app's
                        // scope (features.md excludes 投資助言). This
                        // latest Reference image itself now shows
                        // "Understand Economic Events & FX Reactions",
                        // which matches.
                        Text("Understand Economic Events &\nFX Reactions")
                            .font(DesignTokens.Typography.tagline)
                            .foregroundStyle(DesignTokens.Colors.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, DesignTokens.Spacing.lg)
                    .frame(maxWidth: 480) // keeps brand elements from stretching oversized on iPad
                    .frame(width: geometry.size.width)
                    .padding(.top, geometry.size.height * 0.148)

                    bottomContent
                        .padding(.horizontal, DesignTokens.Spacing.lg)
                        .frame(width: geometry.size.width)
                        .padding(.top, geometry.size.height * 0.895)
                }
            }
        }
        .task { viewModel.start() }
    }

    @ViewBuilder
    private var bottomContent: some View {
        switch viewModel.state {
        case .initializing:
            SplashLoadingBar()
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
