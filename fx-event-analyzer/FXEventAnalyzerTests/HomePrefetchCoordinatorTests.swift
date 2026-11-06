import XCTest
@testable import FXEventAnalyzer

/// HQ指示(2026-11-05)「Splash先行通信・Home Cache起動高速化」:
/// `HomePrefetchCoordinator`がユーザーIDごとに`/home`・`/entitlements`の
/// Taskを1回だけ消費させることの確認。
@MainActor
final class HomePrefetchCoordinatorTests: XCTestCase {
    private let userA = UUID()
    private let userB = UUID()

    private func makeAPIClient(
        home: HomeResponse = HomePrefetchCoordinatorTests.homeResponse,
        entitlements: EntitlementsResponse = HomePrefetchCoordinatorTests.entitlementsResponse
    ) -> MockAPIClient {
        let api = MockAPIClient()
        api.results["home"] = .success(home)
        api.results["entitlements"] = .success(entitlements)
        return api
    }

    // MARK: - 一度だけ消費できる

    func testHomeCanBeConsumedOnlyOnce() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient())

        XCTAssertNotNil(coordinator.consumeHome(for: userA))
        XCTAssertNil(coordinator.consumeHome(for: userA), "a second consume must return nil")
    }

    func testEntitlementsCanBeConsumedOnlyOnce() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient())

        XCTAssertNotNil(coordinator.consumeEntitlements(for: userA))
        XCTAssertNil(coordinator.consumeEntitlements(for: userA), "a second consume must return nil")
    }

    /// `/home`と`/entitlements`は独立して消費できる(片方を消費しても他方はまだ残る)。
    func testHomeAndEntitlementsAreConsumedIndependently() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient())

        XCTAssertNotNil(coordinator.consumeHome(for: userA))
        XCTAssertNotNil(coordinator.consumeEntitlements(for: userA), "consuming /home must not consume /entitlements")
    }

    // MARK: - ユーザー間で結果が混ざらない

    func testDifferentUsersNeverShareAPrefetch() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient())

        XCTAssertNil(coordinator.consumeHome(for: userB), "user B must not receive user A's prefetch")
        XCTAssertNil(coordinator.consumeEntitlements(for: userB))
        XCTAssertNotNil(coordinator.consumeHome(for: userA), "user A's own prefetch must still be there")
    }

    /// ログイン切り替え(ユーザーAの先行取得中にユーザーBで`start`が呼ばれる)
    /// では、Aの結果は一切Bに渡らない。
    func testSwitchingUsersDiscardsThePreviousUsersPrefetch() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient(home: Self.homeResponse))
        coordinator.start(userID: userB, apiClient: makeAPIClient(home: Self.otherHomeResponse))

        XCTAssertNil(coordinator.consumeHome(for: userA), "switching users must drop the previous user's prefetch")
        let consumedForB = coordinator.consumeHome(for: userB)
        XCTAssertNotNil(consumedForB)
    }

    // MARK: - 冪等性(同じユーザーでの再呼び出し)

    /// 同じユーザーIDで`start`を2回呼んでも、新しいTaskは作られず、既存の
    /// Taskがそのまま使われる(`SplashViewModel.retry()`からの再呼び出しに
    /// 対する冪等性 — 二重に`/home`・`/entitlements`を叩かない)。
    func testStartingTwiceForTheSameUserDoesNotCreateANewRequest() async throws {
        let coordinator = HomePrefetchCoordinator()
        let api = makeAPIClient()

        let firstTask = coordinator.start(userID: userA, apiClient: api)
        let secondTask = coordinator.start(userID: userA, apiClient: api)

        _ = try await firstTask.value
        _ = try await secondTask.value
        XCTAssertEqual(api.requestedPaths.filter { $0 == "home" }.count, 1, "starting twice for the same user must not send a second /home request")
    }

    // MARK: - 先行取得が無いときはフォールバックできる(nilを返す)

    func testConsumingWithoutAPriorStartReturnsNil() {
        let coordinator = HomePrefetchCoordinator()
        XCTAssertNil(coordinator.consumeHome(for: userA))
        XCTAssertNil(coordinator.consumeEntitlements(for: userA))
    }

    func testResetClearsThePrefetchSoANewStartIsNeeded() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient())
        coordinator.reset()

        XCTAssertNil(coordinator.consumeHome(for: userA), "reset must clear the held prefetch")
    }

    // MARK: - 実際にTaskが正しい結果を運ぶ

    func testConsumedHomeTaskDeliversTheConfiguredResponse() async throws {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient(home: Self.homeResponse))

        let task = try XCTUnwrap(coordinator.consumeHome(for: userA))
        let response = try await task.value
        XCTAssertEqual(response.date, Self.homeResponse.date)
    }

    func testConsumedEntitlementsTaskDeliversTheConfiguredResponse() async throws {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient(entitlements: Self.entitlementsResponse))

        let task = try XCTUnwrap(coordinator.consumeEntitlements(for: userA))
        let response = try await task.value
        XCTAssertEqual(response.plan, Self.entitlementsResponse.plan)
    }

    // MARK: - Fixtures

    private static let homeResponse = HomeResponse(date: "2026-11-05", timezone: "UTC", events: [], majorFx: [])
    private static let otherHomeResponse = HomeResponse(date: "2026-11-06", timezone: "UTC", events: [], majorFx: [])
    private static let entitlementsResponse = EntitlementsResponse(features: [], plan: .pro, limits: nil)
}
