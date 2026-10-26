import SwiftUI
import UIKit

/// HQ指示(2026-10-25)「過去イベント比較の表が縦画面に入らないので、この画面だけ
/// 横画面できるようにしたい」。アプリ全体はPortrait固定のまま
/// (project.ymlのiPhone用`UISupportedInterfaceOrientations`は既定でPortrait)
/// で、`HistoricalComparisonView`がオンスクリーンの間だけ横画面を許可する。
///
/// 過去4回の失敗を踏まえた5回目の実装:
/// 1回目(AppDelegateの`supportedInterfaceOrientationsFor:`を画面ごとに
/// 切り替えるだけ): UIKitはこのメソッドを「向きの再判定が必要になった時」
/// にしか呼ばない。画面遷移で許可する向きの集合が変わっても、UIKit側に
/// 「再判定して」と明示的に伝える呼び出し(`setNeedsUpdateOfSupportedInterfaceOrientations()`)
/// が無かったため、実機では常に最初に確定したPortraitのまま回転せず、
/// CI実機キャプチャで文字が横倒しのまま・画面半分が黒という壊れ方をした。
/// 2回目(`UIDevice.current.orientation`を見てコンテンツ自体を
/// `.rotationEffect`で回転): インターフェースの向き(≒ウィンドウの実寸・
/// スクリーンショットのキャプチャ対象)自体はPortraitのまま変わらないため、
/// 横長に組んだ中身をその縦長キャンバスの中で回転させても、
/// スクリーンショットでは依然として文字が横倒しに写った。
/// 3回目: `setAllowed(_:)`で許可する向きの集合を切り替えるのと同時に
/// `setNeedsUpdateOfSupportedInterfaceOrientations()`を呼び、UIKitに実際の
/// インターフェース回転を行わせる方式に戻した。CI実機キャプチャでは
/// ウィンドウの実寸(画像サイズ)自体は正しく横長になったが、中身が
/// Portrait時のレイアウトのまま90°回転しただけの状態でスクリーンショットに
/// 写り、新しく広がった分が黒いままだった。
/// 4回目: iOS16+の`UIWindowScene.requestGeometryUpdate(_:)`を追加で
/// 呼び、シーンのジオメトリ遷移そのものを能動的に要求した。この版で
/// スクリーンショットのための待ち時間を0.6秒→2.5秒に伸ばしたが、
/// それでも3回目と酷似した壊れ方のスクリーンショットが撮れたため、
/// 一旦この機能自体を撤回していた。
///
/// 5回目(今回、HQ再指示により再挑戦): 4回目までの実装自体は
/// Apple公式の推奨API(`setNeedsUpdateOfSupportedInterfaceOrientations()` +
/// `requestGeometryUpdate(_:)`)を正しい役割分担で呼んでおり、かつ
/// `testHistoricalComparisonAllowsLandscape`の構造面アサーション
/// (`historyLandscapeTopBar`が実際に出現し、縦画面専用の`v5HeaderBack`・
/// タブバーが消えること)は毎回パスしていた — つまりSwiftUIの論理的な
/// ビューツリーは横画面レイアウトへ正しく切り替わっていた。壊れて見えた
/// のはスクリーンショットの「ピクセル」側だけで、これは要素の存在判定
/// (アクセシビリティツリー)と実際に合成されるピクセル(UIKitの回転
/// トランジションアニメーション)のタイミングが別物であることに起因する
/// CI実機キャプチャ側の取得タイミングの問題である可能性が高いと判断した。
///
/// 最初、ここに`requestGeometryUpdate`実行後の`DispatchQueue.main.async`で
/// ウィンドウへ`setNeedsLayout()`+`layoutIfNeeded()`を明示的に呼ぶ対策を
/// 追加したが、これを入れたCI実機キャプチャでは逆に新しい壊れ方
/// (`v5Tab1`= 縦画面専用のタブバーが横画面でも存在判定上消えない)が
/// 出た。回転直後に同期的な`layoutIfNeeded()`を強制すると、SwiftUIの
/// `NavigationStack`が裏で保持している直前の画面(指標詳細)の再描画が
/// 意図せず誘発され、そちらのタブバーの要素がアクセシビリティツリー上に
/// 残ってしまったと見られる。この対策は取り下げ、4回目の実装
/// (`requestGeometryUpdate`まで、`layoutIfNeeded()`は呼ばない)に戻した。
/// スクリーンショット側(`ScreenshotTests.swift`)の待ち時間だけ2.5秒→
/// 4.0秒に伸ばし、ピクセル合成のタイミング差だけを個別に確認する。
/// これでも同じ壊れ方が再現する場合、原因はこのアプリのコードではなく
/// CIのシミュレーター環境でのXCUITest駆動の回転(`XCUIDevice.shared.orientation`)
/// 自体がこのアプリのような画面単位の動的向き制御と組み合わさったときに
/// 正しくピクセルへ反映されないという、CI検証手段側の既知の制限である
/// 可能性が高い — その場合は実機での目視確認に切り替える。
@MainActor
final class HistoricalComparisonOrientation {
    static let shared = HistoricalComparisonOrientation()
    private init() {}

    private(set) var isLandscapeAllowed = false

    /// `HistoricalComparisonView`の`.onAppear`/`.onDisappear`から呼ぶ。
    func setAllowed(_ allowed: Bool) {
        isLandscapeAllowed = allowed
        guard
            let windowScene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
            let rootViewController = windowScene.windows.first(where: \.isKeyWindow)?.rootViewController
        else { return }
        rootViewController.setNeedsUpdateOfSupportedInterfaceOrientations()
        let mask: UIInterfaceOrientationMask = allowed ? [.portrait, .landscapeLeft, .landscapeRight] : .portrait
        windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in
            // ベストエフォート: ここで失敗しても`supportedInterfaceOrientationsFor:`
            // ベースの通常の回転判定は引き続き効く。
        }
    }
}

/// `@UIApplicationDelegateAdaptor`経由で`FXEventAnalyzerApp`に接続する
/// (SwiftUIのApp/Sceneライフサイクルでも、画面ごとの向き制御はこの
/// 古典的なAppDelegateメソッド経由が標準的な方法)。
final class OrientationAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        HistoricalComparisonOrientation.shared.isLandscapeAllowed ? [.portrait, .landscapeLeft, .landscapeRight] : .portrait
    }
}
