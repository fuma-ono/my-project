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

    func testBeginHomeRequestIssuesAFreshIDAndIncrementsCount() {
        let store = makeStore()
        let first = store.beginHomeRequest()
        XCTAssertEqual(store.current.homeRequestID, first)
        XCTAssertEqual(store.current.homeRequestCount, 1)

        let second = store.beginHomeRequest()
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(store.current.homeRequestID, second)
        XCTAssertEqual(store.current.homeRequestCount, 2)
    }

    /// 2回目の/home取得を始めたら、1回目の詳細値(認証・通信・デコード)は
    /// クリアされる — 古いリクエストの値が新しいリクエストの値と混ざらない。
    func testBeginHomeRequestClearsThePreviousRequestsDetail() {
        let store = makeStore()
        let first = store.beginHomeRequest()
        store.recordHomeAuthTokenStart(requestID: first)
        store.recordHomeAuthTokenEnd(requestID: first)
        store.recordHomeHTTPStart(requestID: first)
        store.recordHomeHTTPEnd(requestID: first, statusCode: 200)
        XCTAssertNotNil(store.current.homeAuthTokenStartMs)
        XCTAssertEqual(store.current.homeHTTPStatusCode, 200)

        _ = store.beginHomeRequest()
        XCTAssertNil(store.current.homeAuthTokenStartMs)
        XCTAssertNil(store.current.homeAuthTokenEndMs)
        XCTAssertNil(store.current.homeHTTPStatusCode)
    }

    /// 古い(現在の`homeRequestID`と一致しない)IDでの記録は無視される。
    func testStaleHomeRequestIDIsIgnored() {
        let store = makeStore()
        let stale = store.beginHomeRequest()
        _ = store.beginHomeRequest() // 新しいリクエストを開始、staleはもう最新ではない

        store.recordHomeAuthTokenStart(requestID: stale)
        store.recordHomeAuthTokenEnd(requestID: stale)
        store.recordHomeHTTPStart(requestID: stale)
        store.recordHomeHTTPEnd(requestID: stale, statusCode: 500)
        store.recordHomeDecodeStart(requestID: stale)
        store.recordHomeDecodeEnd(requestID: stale, succeeded: true)
        store.recordHomeStateApplied(requestID: stale)

        XCTAssertNil(store.current.homeAuthTokenStartMs)
        XCTAssertNil(store.current.homeHTTPStatusCode)
        XCTAssertEqual(store.current.homeRequestOutcome, .notMeasured)
        XCTAssertNil(store.current.homeStateAppliedMs)
    }

    func testCurrentHomeRequestIDRecordsAreApplied() {
        let store = makeStore()
        let id = store.beginHomeRequest()
        store.recordHomeAuthTokenStart(requestID: id)
        store.recordHomeAuthTokenEnd(requestID: id)
        store.recordHomeHTTPStart(requestID: id)
        store.recordHomeHTTPEnd(requestID: id, statusCode: 200)
        store.recordHomeDecodeStart(requestID: id)
        store.recordHomeDecodeEnd(requestID: id, succeeded: true)
        store.recordHomeStateApplied(requestID: id)

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
