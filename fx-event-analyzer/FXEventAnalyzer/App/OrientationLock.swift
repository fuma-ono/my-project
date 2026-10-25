import UIKit

/// HQ指示(2026-10-25)「過去イベント比較の表が縦画面に入らないので、この画面だけ
/// 横画面できるようにしたい」: iPhoneはProject.ymlの`UISupportedInterfaceOrientations`
/// でPortrait固定(2026-10-20、TestFlightのiPad 4方向必須バリデーション対応の
/// 際にHQ自身が「iPhone: Portraitのみ(横画面禁止を維持)」と明記)だったが、
/// 今回は特定の1画面だけ例外的に回転を許可する必要がある。
///
/// SwiftUIの`App`プロトコル自体には画面ごとの回転許可を変える仕組みが無く、
/// UIKitの`UIApplicationDelegate.application(_:supportedInterfaceOrientationsFor:)`
/// を実装する必要がある(`FXEventAnalyzerApp.swift`に`@UIApplicationDelegateAdaptor`
/// で接続)。このメソッドが返す値は`project.yml`の`UISupportedInterfaceOrientations`
/// (iPhone)と掛け合わされる(両方が許可した向きだけが実際に使える)ため、
/// project.yml側もPortrait専用からPortrait+Landscapeへ変更している
/// — 全画面が横画面になって良いわけではなく、実際にどの向きを許すかは
/// この`OrientationLock.mask`を画面側(`HistoricalComparisonView`)が
/// 出入りのタイミングで書き換えることで制御する。既定値はPortraitのみ。
@MainActor
enum OrientationLock {
    private(set) static var mask: UIInterfaceOrientationMask = .portrait

    /// 横画面を許可したい画面の`onAppear`で呼ぶ。
    static func unlockLandscape() {
        set(.allButUpsideDown)
    }

    /// 横画面を許可した画面の`onDisappear`で呼び、既定(Portrait専用)へ戻す。
    static func lockToPortrait() {
        set(.portrait)
    }

    private static func set(_ newMask: UIInterfaceOrientationMask) {
        guard mask != newMask else { return }
        mask = newMask
        let windowScenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let windowScene = windowScenes.first(where: { $0.activationState == .foregroundActive }) ?? windowScenes.first {
            windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: newMask)) { _ in
                // 実機のごく一部の状態(マルチタスク切替直後など)では失敗することが
                // あるが、`attemptRotationToDeviceOrientation()`が最終的な再評価の
                // きっかけになるため、ここでは無視して良い(Appleのドキュメントにも
                // 同様の記載がある)。
            }
        }
        UIViewController.attemptRotationToDeviceOrientation()
    }
}

/// `application(_:supportedInterfaceOrientationsFor:)`だけが目的の最小限の
/// delegate。他の`UIApplicationDelegate`責務(push通知等)は`FXEventAnalyzerApp`
/// 側で個別に処理済みのため、ここには追加しない。
final class OrientationAppDelegate: NSObject, UIApplicationDelegate {
    @MainActor
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        OrientationLock.mask
    }
}
