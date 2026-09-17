import SwiftUI

/// SCR-000 Splash / Launch Screen (ui-screens.md 5.0節).
///
/// Absolute rule enforced here by omission: this view has no dependency on
/// any economic/FX data type. It shows brand + initialization status only.
struct SplashView: View {
    @StateObject private var viewModel: SplashViewModel

    init(viewModel: @autoclosure @escaping () -> SplashViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.backgroundPrimary
                .ignoresSafeArea()

            VStack(spacing: DesignTokens.Spacing.xl) {
                Spacer()

                VStack(spacing: DesignTokens.Spacing.md) {
                    BrandMark()
                    VStack(spacing: DesignTokens.Spacing.xs) {
                        Text("FX Event Analyzer")
                            .font(DesignTokens.Typography.title)
                            .foregroundStyle(DesignTokens.Colors.textPrimary)
                        Text("Understand Economic Events & FX Reactions")
                            .font(DesignTokens.Typography.tagline)
                            .foregroundStyle(DesignTokens.Colors.textSecondary)
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
            LoadingView(caption: "Loading...")
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
