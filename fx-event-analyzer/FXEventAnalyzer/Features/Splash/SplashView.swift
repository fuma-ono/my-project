import SwiftUI

/// SCR-000 Splash / Launch Screen.
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5SplashView`, reproduced as given (icon,
/// wordmark, tagline, `HQV5Chart`, loading capsule, `HQV5Background`).
/// What changed from HQ's file is wiring only: this view still owns the
/// real `SplashViewModel` (unchanged init signature — `RootView`
/// constructs it the same way as before) and still renders
/// `.initializationError`/`.apiConnectionError` via the existing
/// `ErrorView` with retry, since HQ's screen — a single always-showing
/// splash with no state machine — had no design for those two states to
/// carry over.
struct SplashView: View {
    @StateObject private var viewModel: SplashViewModel

    init(viewModel: @autoclosure @escaping () -> SplashViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        ZStack {
            HQV5Background()

            switch viewModel.state {
            case .initializing:
                initializingContent
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
        .preferredColorScheme(.dark)
        .task { viewModel.start() }
    }

    private var initializingContent: some View {
        VStack {
            Spacer()
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 56, weight: .bold))
                .foregroundStyle(LinearGradient(colors: [HQV5.blue, HQV5.cyan], startPoint: .bottomLeading, endPoint: .topTrailing))
                .shadow(color: HQV5.cyan.opacity(0.55), radius: 14)
            Text("FX Event Analyzer")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(.white)
                .padding(.top, 10)
            Text("Turn Economic Events\ninto Trading Opportunities")
                .multilineTextAlignment(.center)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.88))
                .padding(.top, 16)
            Spacer()
            HQV5Chart(rising: true).frame(height: 150)
                .padding(.horizontal, -8)
            VStack(spacing: 5) {
                Capsule().fill(HQV5.cyan).frame(width: 92, height: 1.5)
                Text("Loading...").font(.system(size: 9)).foregroundStyle(HQV5.muted)
            }
            .padding(.bottom, 26)
        }
        .padding(.horizontal, 20)
    }
}
