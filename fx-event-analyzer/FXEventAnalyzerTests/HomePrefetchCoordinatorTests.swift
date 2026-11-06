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

        XCTAssertNotNil(coordinator.consumeHomeForToday(for: userA))
        XCTAssertNil(coordinator.consumeHomeForToday(for: userA), "a second consume must return nil")
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

        XCTAssertNotNil(coordinator.consumeHomeForToday(for: userA))
        XCTAssertNotNil(coordinator.consumeEntitlements(for: userA), "consuming /home must not consume /entitlements")
    }

    // MARK: - ユーザー間で結果が混ざらない

    func testDifferentUsersNeverShareAPrefetch() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient())

        XCTAssertNil(coordinator.consumeHomeForToday(for: userB), "user B must not receive user A's prefetch")
        XCTAssertNil(coordinator.consumeEntitlements(for: userB))
        XCTAssertNotNil(coordinator.consumeHomeForToday(for: userA), "user A's own prefetch must still be there")
    }

    /// ログイン切り替え(ユーザーAの先行取得中にユーザーBで`start`が呼ばれる)
    /// では、Aの結果は一切Bに渡らない。
    func testSwitchingUsersDiscardsThePreviousUsersPrefetch() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient(home: Self.homeResponse))
        coordinator.start(userID: userB, apiClient: makeAPIClient(home: Self.otherHomeResponse))

        XCTAssertNil(coordinator.consumeHomeForToday(for: userA), "switching users must drop the previous user's prefetch")
        let consumedForB = coordinator.consumeHomeForToday(for: userB)
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
        XCTAssertNil(coordinator.consumeHomeForToday(for: userA))
        XCTAssertNil(coordinator.consumeEntitlements(for: userA))
    }

    func testResetClearsThePrefetchSoANewStartIsNeeded() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient())
        coordinator.reset()

        XCTAssertNil(coordinator.consumeHomeForToday(for: userA), "reset must clear the held prefetch")
    }

    // MARK: - 実際にTaskが正しい結果を運ぶ

    func testConsumedHomeTaskDeliversTheConfiguredResponse() async throws {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient(home: Self.homeResponse))

        let task = try XCTUnwrap(coordinator.consumeHomeForToday(for: userA))
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

    // MARK: - 日付・タイムゾーンが違う先行取得は使わない

    /// 先行取得の`/home`は、開始時の日付・タイムゾーンで取得する。
    func testStartRequestsHomeForTheDateAndTimezoneAtStart() async throws {
        let coordinator = HomePrefetchCoordinator()
        let api = makeAPIClient()
        let task = coordinator.start(userID: userA, apiClient: api, now: { Self.nov5Late })
        _ = try await task.value

        let query = try XCTUnwrap(api.requestedEndpoints.first { $0.path == "home" }?.queryItems)
        XCTAssertEqual(query.first { $0.name == "date" }?.value, Self.dateString(Self.nov5Late))
        XCTAssertEqual(query.first { $0.name == "timezone" }?.value, TimeZone.current.identifier)
    }

    /// Splash中に日付が変わった・バックグラウンドから翌日に戻ったときは、前日の`/home`を
    /// 今日の分として渡さない(呼び出し元は自分で取得する)。一度断ったら消費済みにする。
    func testHomeForAnotherDateIsNotHandedOutAndIsConsumed() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient(), now: { Self.nov5Late })

        let nextDay = Self.dateString(Self.nov5Late.addingTimeInterval(24 * 3600))
        XCTAssertNil(coordinator.consumeHome(for: userA, date: nextDay, timezone: TimeZone.current.identifier),
                     "a prefetch for the previous date must not be used as today's /home")
        XCTAssertNil(coordinator.consumeHome(for: userA, date: Self.dateString(Self.nov5Late), timezone: TimeZone.current.identifier),
                     "a refused prefetch must be marked as consumed")
    }

    func testHomeForAnotherTimezoneIsNotHandedOut() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient(), now: { Self.nov5Late })

        let otherTimezone = TimeZone.current.identifier == "Asia/Tokyo" ? "UTC" : "Asia/Tokyo"
        XCTAssertNil(coordinator.consumeHome(for: userA, date: Self.dateString(Self.nov5Late), timezone: otherTimezone))
    }

    /// `/home`を断っても、`/entitlements`(日付に依らない)は引き続き使える。
    func testRefusingHomeForAnotherDateDoesNotConsumeEntitlements() {
        let coordinator = HomePrefetchCoordinator()
        coordinator.start(userID: userA, apiClient: makeAPIClient(), now: { Self.nov5Late })

        let nextDay = Self.dateString(Self.nov5Late.addingTimeInterval(24 * 3600))
        _ = coordinator.consumeHome(for: userA, date: nextDay, timezone: TimeZone.current.identifier)
        XCTAssertNotNil(coordinator.consumeEntitlements(for: userA))
    }

    // MARK: - Fixtures

    private static let homeResponse = HomeResponse(date: "2026-11-05", timezone: "UTC", events: [], majorFx: [])
    private static let otherHomeResponse = HomeResponse(date: "2026-11-06", timezone: "UTC", events: [], majorFx: [])
    private static let entitlementsResponse = EntitlementsResponse(features: [], plan: .pro, limits: nil)
    /// 端末のタイムゾーンで 2026-11-05 23:59:30(日付が変わる直前)。
    private static let nov5Late: Date = {
        var components = DateComponents(year: 2026, month: 11, day: 5, hour: 23, minute: 59, second: 30)
        components.timeZone = .current
        return Calendar(identifier: .gregorian).date(from: components)!
    }()

    fileprivate static func dateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        return formatter.string(from: date)
    }
}

extension HomePrefetchCoordinator {
    /// テスト用: 今日(端末の日付・タイムゾーン)の値で`consumeHome`を呼ぶ。`start`を既定の
    /// `now`(現在時刻)で呼んだテストが、日付の照合を意識せずに消費できるようにする。
    func consumeHomeForToday(for userID: UUID) -> Task<HomeResponse, Error>? {
        consumeHome(for: userID, date: HomePrefetchCoordinatorTests.dateString(Date()), timezone: TimeZone.current.identifier)
    }
}
