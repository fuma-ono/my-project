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

            VStack(spacing: DesignTokens.Spacing.xl) {
                Spacer()

                VStack(spacing: DesignTokens.Spacing.md) {
                    BrandMark()
                    VStack(spacing: 2) {
                        (
                            Text("FX")
                                .foregroundStyle(DesignTokens.Colors.accentCyan)
                                + Text(" Event Analyzer")
                                .foregroundStyle(DesignTokens.Colors.textPrimary)
                        )
                        .font(DesignTokens.Typography.title)

                        // NOT the Reference's literal "Turn Economic Events
                        // into Trading Opportunities" — HQ's Phase 5
                        // instruction (commit 6578d6a) deliberately changed
                        // this wording because it "implied trading signals/
                        // advice, out of scope for this app" (features.md's
                        // explicit exclusion of 投資助言). Reference layout/
                        // two-line shape kept; wording kept compliance-safe.
                        // Flagged to HQ rather than silently reverted.
                        Text("Understand Economic Events\n& FX Reactions")
                            .font(DesignTokens.Typography.tagline)
                            .foregroundStyle(DesignTokens.Colors.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                }

                Spacer()

                bottomContent
                    .padding(.bottom, DesignTokens.Spacing.xl)
            }
            .padding(.horizontal, DesignTokens.Spacing.lg)
            .frame(maxWidth: 480) // keeps brand elements from stretching oversized on iPad
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
