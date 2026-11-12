import SwiftUI

/// SCR-000 Splash's loading indicator — the Reference shows a thin rounded
/// progress track with a blue→cyan fill, not a spinner (`LoadingView`'s
/// `ProgressView()`, used everywhere else in the app, is a distinct,
/// intentionally different treatment for Splash specifically).
///
/// HQ correction: this previously animated an indeterminate sliding
/// segment that bounced back and forth for as long as Splash stayed on
/// screen, reasoned from `SplashViewModel` having no real fractional-
/// progress value to report. That read as "always there", not "a loading
/// feature" — HQ's intent is a one-shot fill that starts empty, climbs to
/// full once, and Splash is gone (`AppState` swaps it out on
/// `SplashViewModel.onFinished`, ui-screens.md SCR-000) at or soon after
/// it completes, not a loop that runs indefinitely. There is still no
/// real progress fraction to drive it from, so the fill's own duration is
/// a fixed, tuned estimate of a typical init sequence rather than a
/// measured value — but it now plays once forward, never reverses, and
/// never repeats.
///
/// HQ指摘(2026-11-09「Build 25実機確認後の修正」フォローアップ)「スプラッシュの際のloadingバーは
/// 右端に達しているのに次に遷移されない」: 上の一発アニメーションは常に`minimumDisplayDuration`
/// (1.6秒)で満タンになっていたが、HQ指示(2026-11-05「Splash先行通信」)で`SplashViewModel`に
/// `maximumDisplayDuration`(先行取得完了待ちの上限、既定4秒)が追加された後は、先行取得の
/// 完了待ちでSplash自体は最大でその上限まで表示され続ける — バーだけが先に満タンになって、
/// 残り最大2.4秒間「止まっているように見える」状態になっていた。2段階のアニメーションに変更:
/// 1. 0→`firstStageFraction`(92%)を`minimumDisplayDuration`で埋める(従来の見た目に近い速さ)。
/// 2. `maximumDisplayDuration`が`minimumDisplayDuration`より長い場合のみ、残りの8%をその差分の
///    時間でゆっくり埋め続ける — 先行取得の完了待ちの間もバーが動き続け、満タンのまま止まって
///    見えないようにする。先行取得が無い経路(未ログイン・セッション切れ)は両者が等しい値で渡され、
///    2段目は実行されない(従来どおり1段で終わる)。
struct SplashLoadingBar: View {
    @State private var fillFraction: CGFloat = 0

    private let trackHeight: CGFloat = 4
    private let minimumFillDuration: TimeInterval
    private let extraFillDuration: TimeInterval
    private let firstStageFraction: CGFloat = 0.92

    init(minimumDisplayDuration: Duration, maximumDisplayDuration: Duration) {
        self.minimumFillDuration = Double(minimumDisplayDuration.milliseconds) / 1000
        let maximum = Double(maximumDisplayDuration.milliseconds) / 1000
        self.extraFillDuration = max(0, maximum - minimumFillDuration)
    }

    var body: some View {
        GeometryReader { geometry in
            Capsule()
                .fill(DesignTokens.Colors.textSecondary.opacity(0.2))
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(DesignTokens.Colors.accentGradient)
                        .frame(width: geometry.size.width * fillFraction)
                        .shadow(color: DesignTokens.Colors.accentCyan.opacity(0.7), radius: 4)
                }
        }
        .frame(width: 220, height: trackHeight)
        .onAppear {
            withAnimation(.easeInOut(duration: minimumFillDuration)) {
                fillFraction = extraFillDuration > 0 ? firstStageFraction : 1
            }
            guard extraFillDuration > 0 else { return }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(minimumFillDuration))
                withAnimation(.easeInOut(duration: extraFillDuration)) {
                    fillFraction = 1
                }
            }
        }
    }
}
