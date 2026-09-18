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

            // Positions measured directly off the Reference with a
            // gridline overlay, not eyeballed: logo top ~13%, tagline
            // bottom ~49%, loading bar ~89.5% of screen height. A
            // GeometryReader lets this match those proportions on any
            // device instead of a symmetric Spacer/Spacer layout
            // centering everything.
            GeometryReader { geometry in
                ZStack(alignment: .top) {
                    VStack(spacing: DesignTokens.Spacing.md) {
                        BrandMark(glow: true)
                        VStack(spacing: 2) {
                            (
                                Text("FX")
                                    .foregroundStyle(DesignTokens.Colors.accentCyan)
                                    + Text(" Event Analyzer")
                                    .foregroundStyle(DesignTokens.Colors.textPrimary)
                            )
                            .font(DesignTokens.Typography.title)

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
                    }
                    .padding(.horizontal, DesignTokens.Spacing.lg)
                    .frame(maxWidth: 480) // keeps brand elements from stretching oversized on iPad
                    .frame(width: geometry.size.width)
                    .padding(.top, geometry.size.height * 0.13)

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
