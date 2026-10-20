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
    /// (`homeRequestCount`)だけ増え、`current.homeRequestID`は1回目の
    /// ままで動かない(起動時の値を後の再取得で上書きしないため — 下記
    /// `testFirstHomeRequestsDetailSurvivesASecondRequestStarting`参照)。
    func testOnlyTheFirstHomeRequestBecomesCurrent() {
        let store = makeStore()
        let first = store.beginHomeRequest()
        XCTAssertEqual(store.current.homeRequestID, first)
        XCTAssertEqual(store.current.homeRequestCount, 1)

        let second = store.beginHomeRequest()
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(store.current.homeRequestID, first)
        XCTAssertEqual(store.current.homeRequestCount, 2)
    }

    /// HQ指示(2026-10-20、実機で検出): タブの出入り等で`/home`が2回目
    /// 以降走っても、起動シーケンス診断の対象である1回目の詳細値
    /// (認証・通信時刻)を上書きしてはいけない。
    func testFirstHomeRequestsDetailSurvivesASecondRequestStarting() {
        let store = makeStore()
        let first = store.beginHomeRequest()
        store.recordHomeAuthTokenStart(requestID: first)
        store.recordHomeAuthTokenEnd(requestID: first)
        store.recordHomeHTTPStart(requestID: first)
        store.recordHomeHTTPEnd(requestID: first, statusCode: 200)
        XCTAssertNotNil(store.current.homeAuthTokenStartMs)
        XCTAssertEqual(store.current.homeHTTPStatusCode, 200)

        _ = store.beginHomeRequest()

        XCTAssertNotNil(store.current.homeAuthTokenStartMs)
        XCTAssertEqual(store.current.homeHTTPStatusCode, 200)
    }

    /// 2回目以降の`beginHomeRequest()`が返すIDは`current.homeRequestID`と
    /// 一致しないダミーのため、それで記録しようとしても無視される。
    func testSecondHomeRequestsRecordsAreIgnored() {
        let store = makeStore()
        _ = store.beginHomeRequest()
        let second = store.beginHomeRequest()

        store.recordHomeAuthTokenStart(requestID: second)
        store.recordHomeAuthTokenEnd(requestID: second)
        store.recordHomeHTTPStart(requestID: second)
        store.recordHomeHTTPEnd(requestID: second, statusCode: 500)
        store.recordHomeDecodeStart(requestID: second)
        store.recordHomeDecodeEnd(requestID: second, succeeded: true)
        store.recordHomeStateApplied(requestID: second)

        XCTAssertNil(store.current.homeAuthTokenStartMs)
        XCTAssertNil(store.current.homeHTTPStatusCode)
        XCTAssertEqual(store.current.homeRequestOutcome, .notMeasured)
        XCTAssertNil(store.current.homeStateAppliedMs)
    }

    /// 今の`current.homeRequestID`と一致しない、本当に無関係なIDでの記録も
    /// 無視される(例: 別の診断セッションの値が紛れ込まない)。
    func testUnrelatedRequestIDIsIgnored() {
        let store = makeStore()
        _ = store.beginHomeRequest()
        let unrelated = UUID()

        store.recordHomeAuthTokenStart(requestID: unrelated)
        store.recordHomeHTTPEnd(requestID: unrelated, statusCode: 500)
        store.recordHomeStateApplied(requestID: unrelated)

        XCTAssertNil(store.current.homeAuthTokenStartMs)
        XCTAssertNil(store.current.homeHTTPStatusCode)
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
