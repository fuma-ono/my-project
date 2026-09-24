import SwiftUI

/// SCR-000 Splash / Launch Screen.
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5Splash` (icon, wordmark, tagline,
/// `V5CandleChart`, loading capsule, fixed 234×491 coordinate space via
/// `V5Viewport`), reproduced as given. What changed from HQ's file is
/// wiring only: this view still owns the real `SplashViewModel` (unchanged
/// init signature — `RootView` constructs it the same way) and still
/// renders `.initializationError`/`.apiConnectionError` via the existing
/// `ErrorView` with retry — HQ's screen, a single always-showing splash
/// with no state machine, has no design for those two states, so (same
/// call as the prior integration) they fall back to a plain full-bleed
/// V5-toned background instead of the fixed-coordinate V5 layout.
struct SplashView: View {
    @StateObject private var viewModel: SplashViewModel

    init(viewModel: @autoclosure @escaping () -> SplashViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        Group {
            switch viewModel.state {
            case .initializing:
                initializingContent
            case .initializationError:
                errorBackground {
                    ErrorView(
                        title: "アプリの初期化に失敗しました",
                        message: "もう一度お試しください。",
                        onRetry: { viewModel.retry() }
                    )
                }
            case .apiConnectionError:
                errorBackground {
                    ErrorView(
                        title: "サーバーに接続できませんでした",
                        message: "ネットワーク接続を確認し、再試行してください。",
                        onRetry: { viewModel.retry() }
                    )
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { viewModel.start() }
    }

    private var initializingContent: some View {
        V5Viewport {
            V5TopStatus()
            VStack(spacing: 0) {
                Spacer().frame(height: 100)
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 50, weight: .bold))
                    .foregroundStyle(LinearGradient(colors: [V5P.blue, V5P.cyan], startPoint: .bottomLeading, endPoint: .topTrailing))
                    .shadow(color: V5P.cyan.opacity(0.6), radius: 10)
                Text("FX Event Analyzer")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.top, 8)
                Text("Turn Economic Events\ninto Trading Opportunities")
                    .multilineTextAlignment(.center)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.top, 16)
                Spacer()
                V5CandleChart().frame(width: 222, height: 150)
                Capsule().fill(V5P.cyan).frame(width: 80, height: 1.4).padding(.top, 12)
                Text("Loading...").font(.system(size: 8)).foregroundStyle(V5P.muted).padding(.top, 6)
                Spacer().frame(height: 20)
            }
            .frame(width: V5P.W, height: V5P.H)
        }
    }

    @ViewBuilder private func errorBackground(@ViewBuilder content: () -> some View) -> some View {
        ZStack {
            LinearGradient(colors: [V5P.bg0, V5P.bg1, V5P.bg0], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            content()
        }
    }
}
