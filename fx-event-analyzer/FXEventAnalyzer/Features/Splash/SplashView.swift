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

            // The Reference positions the logo/title group in the upper
            // third (arrow top ~29%, tagline bottom ~50% of screen height)
            // and the loading bar around ~79%, not vertically centered —
            // measured directly off splash-screen-reference-v1.png with a
            // gridline overlay, not eyeballed. A GeometryReader lets this
            // match those proportions on any device instead of a
            // symmetric Spacer/Spacer layout centering everything.
            GeometryReader { geometry in
                ZStack(alignment: .top) {
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

                            Text("Turn Economic Events\ninto Trading Opportunities")
                                .font(DesignTokens.Typography.tagline)
                                .foregroundStyle(DesignTokens.Colors.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .padding(.horizontal, DesignTokens.Spacing.lg)
                    .frame(maxWidth: 480) // keeps brand elements from stretching oversized on iPad
                    .frame(width: geometry.size.width)
                    .padding(.top, geometry.size.height * 0.29)

                    bottomContent
                        .padding(.horizontal, DesignTokens.Spacing.lg)
                        .frame(width: geometry.size.width)
                        .padding(.top, geometry.size.height * 0.79)
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
