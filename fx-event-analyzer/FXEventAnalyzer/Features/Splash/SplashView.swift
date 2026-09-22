import SwiftUI

/// SCR-000 Splash / Launch Screen.
///
/// HQ Frontend integration (2026-09-21): visual content is HQ's
/// `FXEventAnalyzer_HQFrontend/SplashView.swift`, reproduced as given (icon
/// glow, wordmark, tagline, decorative candle/curve background, progress
/// capsule). What changed from HQ's standalone mockup is wiring only: this
/// view still owns the real `SplashViewModel` (unchanged init signature —
/// `RootView` constructs it the same way as before) and still renders
/// `.initializationError`/`.apiConnectionError` via the existing `ErrorView`
/// with retry, since HQ's mockup — a single always-`.initializing` state —
/// had no design for those two states to carry over.
struct SplashView: View {
    @StateObject private var viewModel: SplashViewModel

    init(viewModel: @autoclosure @escaping () -> SplashViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        ZStack {
            FXAppBackground()

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
        VStack(spacing: 0) {
            Spacer(minLength: 70)
            VStack(spacing: 18) {
                ZStack {
                    Circle().fill(FXColor.cyan.opacity(0.08)).frame(width: 180, height: 180).blur(radius: 28)
                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .font(.system(size: 70, weight: .bold))
                        .foregroundStyle(FXGradient.brand)
                        .shadow(color: FXColor.cyan.opacity(0.6), radius: 22)
                }
                VStack(spacing: 8) {
                    Text("FX Event Analyzer").font(.system(size: 31, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    Text("Turn Economic Events\ninto Trading Opportunities")
                        .font(.system(size: 14, weight: .medium, design: .rounded)).tracking(1.2).foregroundStyle(FXColor.secondaryText).multilineTextAlignment(.center)
                }
            }
            Spacer()
            GeometryReader { geo in
                ZStack(alignment: .bottomLeading) {
                    Path { path in
                        path.move(to: CGPoint(x: -20, y: geo.size.height * 0.72))
                        path.addCurve(to: CGPoint(x: geo.size.width + 20, y: geo.size.height * 0.18), control1: CGPoint(x: geo.size.width * 0.35, y: geo.size.height), control2: CGPoint(x: geo.size.width * 0.62, y: 0))
                    }.stroke(FXColor.blue.opacity(0.45), lineWidth: 1.5)
                    Path { path in
                        path.move(to: CGPoint(x: -20, y: geo.size.height * 0.86))
                        path.addCurve(to: CGPoint(x: geo.size.width + 20, y: geo.size.height * 0.34), control1: CGPoint(x: geo.size.width * 0.40, y: geo.size.height * 0.45), control2: CGPoint(x: geo.size.width * 0.65, y: geo.size.height * 0.20))
                    }.stroke(FXColor.cyan.opacity(0.35), lineWidth: 1)
                    HStack(alignment: .bottom, spacing: 8) {
                        ForEach(0..<20, id: \.self) { i in
                            let h = CGFloat(14 + (i * 17) % 80)
                            VStack(spacing: 0) {
                                Rectangle().fill(FXColor.cyan.opacity(0.65)).frame(width: 7, height: 5)
                                Rectangle().fill(FXGradient.brand).frame(width: 9, height: h)
                                Rectangle().fill(FXColor.blue.opacity(0.8)).frame(width: 1, height: 10)
                            }.shadow(color: FXColor.cyan.opacity(0.18), radius: 8)
                        }
                    }.frame(maxWidth: .infinity, alignment: .center).padding(.horizontal, 8)
                }
            }.frame(height: 220)
            VStack(spacing: 12) {
                Capsule().fill(FXColor.cardStrong).frame(width: 190, height: 5).overlay(alignment: .leading) { Capsule().fill(FXGradient.brand).frame(width: 190 * 0.55, height: 5) }
                Text("Loading...").font(.system(size: 11, weight: .medium)).foregroundStyle(FXColor.tertiaryText)
            }.padding(.bottom, 18)
        }.padding(.horizontal, 24)
    }
}
