import XCTest
@testable import FXEventAnalyzer

@MainActor
final class HomeSnapshotStoreTests: XCTestCase {
    private var tempDirectory: URL!
    private var store: HomeSnapshotStore!

    override func setUpWithError() throws {
        tempDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
        store = HomeSnapshotStore(directory: tempDirectory)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: tempDirectory)
    }

    private func makeSnapshot(
        fetchedAt: Date = Date(),
        requestedDate: String = "2026-10-21",
        requestedTimezone: String = "Asia/Tokyo",
        userID: String = "user-1",
        plan: String? = "FREE"
    ) -> HomeSnapshot {
        HomeSnapshot(events: [], majorFx: [], speeches: [], fetchedAt: fetchedAt, requestedDate: requestedDate, requestedTimezone: requestedTimezone, userID: userID, plan: plan)
    }

    func testSaveThenLoadRoundTripsWithMatchingConditions() {
        let snapshot = makeSnapshot()
        store.save(snapshot)

        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")

        guard case .usable(let loaded) = result else {
            return XCTFail("Expected .usable, got \(result)")
        }
        XCTAssertEqual(loaded, snapshot)
    }

    func testLoadWithoutAnySavedDataReturnsNotFound() {
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        XCTAssertEqual(result, .unusable(.notFound, ageSeconds: nil))
    }

    func testLoadWithDifferentUserIsUnusable() {
        store.save(makeSnapshot(userID: "user-1"))
        let result = store.load(userID: "user-2", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        XCTAssertEqual(result.outcome, .userMismatch)
    }

    // MARK: - HQ指示(2026-10-22「A1ホームスナップショットのプラン失効対策」)

    func testLoadWithDifferentPlanIsUnusable() {
        store.save(makeSnapshot(plan: "PRO"))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        XCTAssertEqual(result.outcome, .planMismatch)
    }

    func testLoadWithMatchingPlanIsUsable() {
        store.save(makeSnapshot(plan: "PRO"))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "PRO")
        guard case .usable = result else {
            return XCTFail("Expected .usable, got \(result)")
        }
    }

    /// この対策より前に保存された(`plan`キーを持たない)古い保存データは
    /// プランが分からないため、現在のプランが何であっても使えない。
    func testLoadWithMissingPlanFromOldDataIsUnusable() {
        store.save(makeSnapshot(plan: nil))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        XCTAssertEqual(result.outcome, .planMismatch)
    }

    func testLoadWithDifferentDateIsUnusable() {
        store.save(makeSnapshot(requestedDate: "2026-10-20"))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        XCTAssertEqual(result.outcome, .dateMismatch)
    }

    func testLoadWithDifferentTimezoneIsUnusable() {
        store.save(makeSnapshot(requestedTimezone: "UTC"))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        XCTAssertEqual(result.outcome, .timezoneMismatch)
    }

    func testLoadOlderThanTwelveHoursIsExpired() {
        let old = Date().addingTimeInterval(-(HomeSnapshotStore.maxAge + 60))
        store.save(makeSnapshot(fetchedAt: old))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        XCTAssertEqual(result.outcome, .expired)
    }

    func testLoadWithinTwelveHoursIsUsable() {
        let recent = Date().addingTimeInterval(-(HomeSnapshotStore.maxAge - 60))
        store.save(makeSnapshot(fetchedAt: recent))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        guard case .usable = result else {
            return XCTFail("Expected .usable, got \(result)")
        }
    }

    func testLoadWithFutureFetchedAtIsUnusable() {
        // 端末時計の巻き戻り等、不自然な未来方向のデータは使わない。
        let future = Date().addingTimeInterval(60)
        store.save(makeSnapshot(fetchedAt: future))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        XCTAssertEqual(result.outcome, .expired)
    }

    func testLoadWithCorruptedFileIsUnusable() throws {
        let fileURL = tempDirectory.appendingPathComponent("home_snapshot.json")
        try Data("not json".utf8).write(to: fileURL)
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        XCTAssertEqual(result.outcome, .decodeFailed)
    }

    func testClearRemovesSavedData() {
        store.save(makeSnapshot())
        store.clear()
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        XCTAssertEqual(result.outcome, .notFound)
    }

    func testClearWithNoSavedDataDoesNotThrow() {
        store.clear()
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo", plan: "FREE")
        XCTAssertEqual(result.outcome, .notFound)
    }
}
