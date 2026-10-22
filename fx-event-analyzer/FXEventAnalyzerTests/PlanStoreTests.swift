import XCTest
@testable import FXEventAnalyzer

/// HQ指示(2026-10-22「A1ホームスナップショットのプラン失効対策」)対応。
/// `PlanStore`に追加した確認状態(`confirmationState`)と、同時呼び出しの
/// 重複排除(`inFlightLoad`)を検証する。
@MainActor
final class PlanStoreTests: XCTestCase {
    func testInitialStateIsNotLoaded() {
        let store = PlanStore()
        XCTAssertEqual(store.confirmationState, .notLoaded)
        XCTAssertEqual(store.plan, .free)
    }

    func testLoadSuccessSetsConfirmedAndUpdatesPlan() async {
        let store = PlanStore()
        let apiClient = MockAPIClient()
        apiClient.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .pro, limits: nil))

        let result = await store.load(apiClient: apiClient)

        XCTAssertEqual(result, .confirmed)
        XCTAssertEqual(store.confirmationState, .confirmed)
        XCTAssertEqual(store.plan, .pro)
    }

    func testLoadFailureSetsFailedAndKeepsPreviousPlan() async {
        let store = PlanStore()
        store.set(plan: .pro, limits: .pro())

        let apiClient = MockAPIClient()
        apiClient.results["entitlements"] = .failure(APIError.transport("connection reset"))

        let result = await store.load(apiClient: apiClient)

        XCTAssertEqual(result, .failed)
        XCTAssertEqual(store.confirmationState, .failed)
        // 取れないときは前回の値のまま(既存の挙動を維持)。
        XCTAssertEqual(store.plan, .pro)
    }

    func testSetMarksConfirmed() {
        let store = PlanStore()
        store.set(plan: .free, limits: .free())
        XCTAssertEqual(store.confirmationState, .confirmed)
        XCTAssertEqual(store.plan, .free)
    }

    /// HQ指示「フォアグラウンド復帰時のプラン再取得とスナップショットの
    /// 利用判定が競合しないようにする」「独自のプラン判定を重複実装しない」:
    /// 同時に複数箇所から`load()`を呼んでも、entitlementsの取得は1回だけ。
    func testConcurrentLoadCallsAreDeduplicated() async {
        let store = PlanStore()
        let apiClient = MockAPIClient()
        apiClient.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .pro, limits: nil))

        async let first = store.load(apiClient: apiClient)
        async let second = store.load(apiClient: apiClient)
        let (resultA, resultB) = await (first, second)

        XCTAssertEqual(resultA, .confirmed)
        XCTAssertEqual(resultB, .confirmed)
        XCTAssertEqual(apiClient.requestedPaths.filter { $0 == "entitlements" }.count, 1, "同時に呼んでもentitlementsの取得は1回のはず")
    }

    func testSequentialLoadCallsEachFetchAgain() async {
        let store = PlanStore()
        let apiClient = MockAPIClient()
        apiClient.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil))

        await store.load(apiClient: apiClient)
        await store.load(apiClient: apiClient)

        // 前の呼び出しが完了した後の呼び出しは、重複排除の対象ではなく
        // 新たに取得し直す(フォアグラウンド復帰のたびに最新化するため)。
        XCTAssertEqual(apiClient.requestedPaths.filter { $0 == "entitlements" }.count, 2)
    }
}
