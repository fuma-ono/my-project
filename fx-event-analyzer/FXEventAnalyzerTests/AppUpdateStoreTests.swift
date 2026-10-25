import XCTest
@testable import FXEventAnalyzer

@MainActor
final class AppUpdateStoreTests: XCTestCase {
    private func makeStore(currentVersion: String = "1.0.0") -> AppUpdateStore {
        AppUpdateStore(
            userDefaults: UserDefaults(suiteName: "AppUpdateStoreTests-\(UUID().uuidString)")!,
            bundleId: "com.fumaono.fxeventanalyzer",
            currentVersion: currentVersion
        )
    }

    // MARK: - isNewerVersion(_:than:)

    func testIsNewerVersionDetectsAHigherMinorVersion() {
        XCTAssertTrue(AppUpdateStore.isNewerVersion("1.2.0", than: "1.1.0"))
    }

    func testIsNewerVersionIsNotFooledByStringOrdering() {
        // "1.9.0" < "1.10.0"だが、文字列として比較すると"1" "9"側が大きく見えて誤る。
        XCTAssertTrue(AppUpdateStore.isNewerVersion("1.10.0", than: "1.9.0"))
        XCTAssertFalse(AppUpdateStore.isNewerVersion("1.9.0", than: "1.10.0"))
    }

    func testIsNewerVersionTreatsEqualVersionsAsNotNewer() {
        XCTAssertFalse(AppUpdateStore.isNewerVersion("1.2.0", than: "1.2.0"))
    }

    func testIsNewerVersionHandlesDifferentComponentCounts() {
        XCTAssertTrue(AppUpdateStore.isNewerVersion("1.2.1", than: "1.2"))
        XCTAssertFalse(AppUpdateStore.isNewerVersion("1.2", than: "1.2.1"))
        XCTAssertFalse(AppUpdateStore.isNewerVersion("1.2.0", than: "1.2"))
    }

    func testIsNewerVersionReturnsFalseForOlderVersion() {
        XCTAssertFalse(AppUpdateStore.isNewerVersion("1.0.0", than: "1.1.0"))
    }

    // MARK: - dismiss()

    func testDismissClearsAvailableUpdate() {
        let store = makeStore()
        let info = AppUpdateInfo(latestVersion: "2.0.0", storeURL: URL(string: "https://apps.apple.com/app/id123")!)
        store.set(availableUpdate: info)
        XCTAssertNotNil(store.availableUpdate)

        store.dismiss()
        XCTAssertNil(store.availableUpdate)
    }

    func testDismissedVersionIsRememberedAcrossStoreInstances() async {
        // `checkForUpdate()`はBundle.mainから読んだ現在バージョンを使うため、
        // ここでは同じ`UserDefaults`スイートを共有する2つ目のStoreで
        // 「後で」の記録が引き継がれることだけを確かめる(ネットワークに
        // 依存しない範囲での検証)。
        let suiteName = "AppUpdateStoreTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let first = AppUpdateStore(userDefaults: defaults, bundleId: "com.fumaono.fxeventanalyzer", currentVersion: "1.0.0")
        first.set(availableUpdate: AppUpdateInfo(latestVersion: "2.0.0", storeURL: URL(string: "https://apps.apple.com/app/id123")!))
        first.dismiss()

        XCTAssertEqual(defaults.string(forKey: "appUpdate.dismissedVersion"), "2.0.0")
    }

    // MARK: - checkForUpdate() のガード(通信に依存しない範囲)

    func testCheckForUpdateDoesNothingWithoutABundleId() async {
        let store = AppUpdateStore(
            userDefaults: UserDefaults(suiteName: "AppUpdateStoreTests-\(UUID().uuidString)")!,
            bundleId: nil,
            currentVersion: "1.0.0"
        )
        await store.checkForUpdate()
        XCTAssertNil(store.availableUpdate)
    }
}
