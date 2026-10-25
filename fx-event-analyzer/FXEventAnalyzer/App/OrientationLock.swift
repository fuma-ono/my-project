import SwiftUI
import UIKit

/// HQ指示(2026-10-25)「過去イベント比較の表が縦画面に入らないので、この画面だけ
/// 横画面できるようにしたい」。アプリ全体はPortrait固定のまま
/// (project.ymlのiPhone用`UISupportedInterfaceOrientations`は既定でPortrait)
/// で、`HistoricalComparisonView`がオンスクリーンの間だけ横画面を許可する。
///
/// 過去2回の失敗を踏まえた3回目の実装:
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
/// スクリーンショットでは依然として文字が横倒しに写った
/// (ユーザーが実機を物理的に横に持てば中身は正立して見える発想だったが、
/// CIのスクリーンショット検証という目的に対しては成立しなかった)。
/// 3回目(今回): `setAllowed(_:)`で許可する向きの集合を切り替えるのと同時に
/// `setNeedsUpdateOfSupportedInterfaceOrientations()`を呼び、UIKitに実際の
/// インターフェース回転を行わせる。ウィンドウの実寸自体が横長になるため、
/// スクリーンショットも正しく横長で撮れる。
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
