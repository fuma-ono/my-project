import XCTest
@testable import FXEventAnalyzer

@MainActor
final class DiagnosticsStoreTests: XCTestCase {
    private func makeStore() -> DiagnosticsStore {
        DiagnosticsStore(defaults: UserDefaults(suiteName: "DiagnosticsStoreTests-\(UUID().uuidString)")!)
    }

    func testFreshStoreStartsWithNoPreviousLaunch() {
        let store = makeStore()
        XCTAssertNil(store.previous)
        XCTAssertNil(store.current.runInitSequenceStartMs)
        XCTAssertEqual(store.current.sessionCheckOutcome, .notMeasured)
    }

    func testRecordRunInitSequenceStartSetsANonNegativeElapsedValue() {
        let store = makeStore()
        store.recordRunInitSequenceStart()
        XCTAssertNotNil(store.current.runInitSequenceStartMs)
        XCTAssertGreaterThanOrEqual(store.current.runInitSequenceStartMs ?? -1, 0)
    }

    func testSessionCheckRecordsStartEndAndOutcome() {
        let store = makeStore()
        store.recordSessionCheckStart()
        XCTAssertNotNil(store.current.sessionCheckStartMs)
        XCTAssertEqual(store.current.sessionCheckOutcome, .notMeasured)

        store.recordSessionCheckEnd(succeeded: true)
        XCTAssertNotNil(store.current.sessionCheckEndMs)
        XCTAssertEqual(store.current.sessionCheckOutcome, .success)
        XCTAssertGreaterThanOrEqual(store.current.sessionCheckEndMs ?? -1, store.current.sessionCheckStartMs ?? 0)
    }

    func testSessionCheckFailureRecordsFailureOutcome() {
        let store = makeStore()
        store.recordSessionCheckStart()
        store.recordSessionCheckEnd(succeeded: false)
        XCTAssertEqual(store.current.sessionCheckOutcome, .failure)
    }

    func testRunInitSequenceFinishedRecordsSplashFinishedAndOutcome() {
        let store = makeStore()
        store.recordRunInitSequenceFinished(succeeded: true)
        XCTAssertNotNil(store.current.splashFinishedMs)
        XCTAssertEqual(store.current.runInitSequenceOutcome, .success)
    }

    /// タブ切り替え等で`MainTabView`が再度`.onAppear`しても、最初に記録した
    /// 値を上書きしない(「起動シーケンス中に初めて表示可能になった時刻」
    /// のまま)。
    func testMainScreenAppearedIsOnlyRecordedOnce() {
        let store = makeStore()
        store.recordMainScreenAppeared()
        let first = store.current.mainScreenAppearedMs
        XCTAssertNotNil(first)

        store.recordMainScreenAppeared()
        XCTAssertEqual(store.current.mainScreenAppearedMs, first)
    }

    func testHomeReadyToDisplayIsOnlyRecordedOnce() {
        let store = makeStore()
        store.recordHomeReadyToDisplay()
        let first = store.current.homeReadyToDisplayMs
        XCTAssertNotNil(first)

        store.recordHomeReadyToDisplay()
        XCTAssertEqual(store.current.homeReadyToDisplayMs, first)
    }

    /// 1回目だけが`current.homeRequestID`に反映される。2回目以降は回数
    /// (`homeRequestCount`)だけ増えるが、`beginHomeRequest()`の戻り値・
    /// `current.homeRequestID`は1回目のIDのままで動かない(起動時の値を
    /// 後の再取得で上書きしないため — 下記
    /// `testFirstHomeRequestsDetailSurvivesASecondRequestStarting`参照)。
    func testOnlyTheFirstHomeRequestBecomesCurrent() {
        let store = makeStore()
        let first = store.beginHomeRequest()
        XCTAssertEqual(store.current.homeRequestID, first)
        XCTAssertEqual(store.current.homeRequestCount, 1)

        let second = store.beginHomeRequest()
        XCTAssertEqual(second, first)
        XCTAssertEqual(store.current.homeRequestID, first)
        XCTAssertEqual(store.current.homeRequestCount, 2)
    }

    /// HQ指示(2026-10-20、実機で検出): タブの出入り等で`/home`が2回目
    /// 以降走っても、起動シーケンス診断の対象である1回目の詳細値
    /// (認証・通信時刻)を上書きしてはいけない。
    func testFirstHomeRequestsDetailSurvivesASecondRequestStarting() {
        let store = makeStore()
        _ = store.beginHomeRequest()
        store.recordHomeAuthTokenStart()
        store.recordHomeAuthTokenEnd()
        store.recordHomeHTTPStart()
        store.recordHomeHTTPEnd(statusCode: 200)
        XCTAssertNotNil(store.current.homeAuthTokenStartMs)
        XCTAssertEqual(store.current.homeHTTPStatusCode, 200)

        _ = store.beginHomeRequest()

        XCTAssertNotNil(store.current.homeAuthTokenStartMs)
        XCTAssertEqual(store.current.homeHTTPStatusCode, 200)
    }

    /// 2回目以降の`/home`取得中(`homeRequestCount != 1`)は、どの記録呼び出しも
    /// 無視される(IDの一致ではなく回数で判定 — `DiagnosticsStore.swift`
    /// 冒頭のコメント参照)。
    func testSecondHomeRequestsRecordsAreIgnored() {
        let store = makeStore()
        _ = store.beginHomeRequest()
        _ = store.beginHomeRequest()

        store.recordHomeAuthTokenStart()
        store.recordHomeAuthTokenEnd()
        store.recordHomeHTTPStart()
        store.recordHomeHTTPEnd(statusCode: 500)
        store.recordHomeDecodeStart()
        store.recordHomeDecodeEnd(succeeded: true)
        store.recordHomeStateApplied()

        XCTAssertNil(store.current.homeAuthTokenStartMs)
        XCTAssertNil(store.current.homeHTTPStatusCode)
        XCTAssertEqual(store.current.homeRequestOutcome, .notMeasured)
        XCTAssertNil(store.current.homeStateAppliedMs)
    }

    func testFirstHomeRequestRecordsAreApplied() {
        let store = makeStore()
        _ = store.beginHomeRequest()
        store.recordHomeAuthTokenStart()
        store.recordHomeAuthTokenEnd()
        store.recordHomeHTTPStart()
        store.recordHomeHTTPEnd(statusCode: 200)
        store.recordHomeDecodeStart()
        store.recordHomeDecodeEnd(succeeded: true)
        store.recordHomeStateApplied()

        XCTAssertNotNil(store.current.homeAuthTokenStartMs)
        XCTAssertNotNil(store.current.homeAuthTokenEndMs)
        XCTAssertNotNil(store.current.homeHTTPStartMs)
        XCTAssertNotNil(store.current.homeHTTPEndMs)
        XCTAssertEqual(store.current.homeHTTPStatusCode, 200)
        XCTAssertNotNil(store.current.homeDecodeStartMs)
        XCTAssertNotNil(store.current.homeDecodeEndMs)
        XCTAssertEqual(store.current.homeRequestOutcome, .success)
        XCTAssertNotNil(store.current.homeStateAppliedMs)
    }

    /// 次の起動の`init()`が、前回のインスタンスが保存した`current`を
    /// `previous`として読み込む(明示的な「正常終了」通知を必要としない)。
    func testNextLaunchReadsThePreviousInstancesCurrentAsPrevious() {
        let suiteName = "DiagnosticsStoreTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!

        let first = DiagnosticsStore(defaults: defaults)
        first.recordRunInitSequenceStart()
        first.recordSessionCheckStart()
        first.recordSessionCheckEnd(succeeded: true)
        let firstLaunchID = first.current.launchID

        let second = DiagnosticsStore(defaults: defaults)
        XCTAssertEqual(second.previous?.launchID, firstLaunchID)
        XCTAssertEqual(second.previous?.sessionCheckOutcome, .success)
        // 新しいインスタンスの`current`は、前回とは別の新しい起動として扱う。
        XCTAssertNotEqual(second.current.launchID, firstLaunchID)
    }

    /// 起動が正常に完了しなかった場合(失敗・強制終了)でも、その時点までの
    /// 値が次回「前回の起動」として残る。
    func testPreviousLaunchRetainsPartialDataFromAnIncompleteLaunch() {
        let suiteName = "DiagnosticsStoreTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!

        let first = DiagnosticsStore(defaults: defaults)
        first.recordRunInitSequenceStart()
        first.recordSessionCheckStart()
        // セッション取得完了まで到達せずに終了したことを模す(recordSessionCheckEndを呼ばない)。

        let second = DiagnosticsStore(defaults: defaults)
        XCTAssertNotNil(second.previous?.sessionCheckStartMs)
        XCTAssertNil(second.previous?.sessionCheckEndMs)
        XCTAssertEqual(second.previous?.sessionCheckOutcome, .notMeasured)
    }
}
