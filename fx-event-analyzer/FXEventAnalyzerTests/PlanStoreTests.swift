import XCTest
@testable import FXEventAnalyzer

/// HQ指示(2026-11-05)「Splash先行通信・Home Cache起動高速化」: `PlanStore.load()`が
/// Splash中に開始済みの`/entitlements`の先行取得を再利用し、二重取得にしないことの確認。
/// 既存のプラン確認・`PlanLimits`の計算等の挙動(`HomeCacheTests.swift`・
/// `CalendarViewModelTests.swift`等)は変えていない。
@MainActor
final class PlanStoreTests: XCTestCase {
    private let userA = UUID()
    private let userB = UUID()

    func testLoadWithoutAUserIDBehavesAsBefore() async {
        // userIDを渡さない既存の呼び出し方(購入後の再読み込み等)は、先行取得に
        // 一切触れず、常に新規取得する。
        let api = MockAPIClient()
        api.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .pro, limits: nil))
        let store = PlanStore()

        await store.load(apiClient: api)

        XCTAssertTrue(store.isConfirmed)
        XCTAssertTrue(store.isPro)
        XCTAssertEqual(api.requestedPaths, ["entitlements"])
    }

    func testLoadReusesThePrefetchedEntitlementsAndDoesNotRequestAgain() async {
        let coordinator = HomePrefetchCoordinator()
        let api = MockAPIClient()
        api.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .pro, limits: nil))
        coordinator.start(userID: userA, apiClient: api)
        let store = PlanStore()

        await store.load(apiClient: api, userID: userA, prefetchCoordinator: coordinator)

        XCTAssertTrue(store.isConfirmed)
        XCTAssertTrue(store.isPro)
        XCTAssertEqual(api.requestedPaths.filter { $0 == "entitlements" }.count, 1, "the prefetch's own request is the only one — load() must not send a second")
    }

    /// 先行取得をもう一度消費しようとしても(2回目の`load()`呼び出し)、
    /// `consumeEntitlements`が`nil`を返すため、通常どおり新規に取得する
    /// (二重取得にはならないが、取得自体は起きる — フォールバックの確認)。
    func testSecondLoadAfterConsumingThePrefetchFallsBackToANewRequest() async {
        let coordinator = HomePrefetchCoordinator()
        let api = MockAPIClient()
        api.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .pro, limits: nil))
        coordinator.start(userID: userA, apiClient: api)
        let store = PlanStore()

        await store.load(apiClient: api, userID: userA, prefetchCoordinator: coordinator)
        await store.load(apiClient: api, userID: userA, prefetchCoordinator: coordinator)

        XCTAssertEqual(api.requestedPaths.filter { $0 == "entitlements" }.count, 2, "the first load consumes the prefetch; the second must fetch fresh")
    }

    func testLoadNeverUsesAnotherUsersPrefetch() async {
        let coordinator = HomePrefetchCoordinator()
        let apiForA = MockAPIClient()
        apiForA.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .pro, limits: nil))
        coordinator.start(userID: userA, apiClient: apiForA)

        let apiForB = MockAPIClient()
        apiForB.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil))
        let store = PlanStore()

        await store.load(apiClient: apiForB, userID: userB, prefetchCoordinator: coordinator)

        XCTAssertTrue(store.isConfirmed)
        XCTAssertFalse(store.isPro, "user B must get its own FREE result, never user A's prefetched PRO")
        XCTAssertEqual(apiForB.requestedPaths, ["entitlements"], "user B must make its own request since the prefetch belongs to user A")
    }

    func testPrefetchFailureFallsBackToTheExistingErrorHandling() async {
        let coordinator = HomePrefetchCoordinator()
        let api = MockAPIClient()
        api.results["entitlements"] = .failure(APIError.transport("offline"))
        coordinator.start(userID: userA, apiClient: api)
        let store = PlanStore()
        store.set(plan: .pro, limits: .pro(), confirmed: false) // 起動直後の仮値

        await store.load(apiClient: api, userID: userA, prefetchCoordinator: coordinator)

        XCTAssertFalse(store.isConfirmed, "a failed prefetch must leave isConfirmed false, same as a failed direct fetch")
        XCTAssertTrue(store.isPro, "the previous value is kept on failure (no change), matching the existing behavior")
    }
}
