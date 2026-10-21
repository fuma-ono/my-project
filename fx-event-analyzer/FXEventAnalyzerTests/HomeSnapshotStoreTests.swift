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
        userID: String = "user-1"
    ) -> HomeSnapshot {
        HomeSnapshot(events: [], majorFx: [], speeches: [], fetchedAt: fetchedAt, requestedDate: requestedDate, requestedTimezone: requestedTimezone, userID: userID)
    }

    func testSaveThenLoadRoundTripsWithMatchingConditions() {
        let snapshot = makeSnapshot()
        store.save(snapshot)

        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo")

        guard case .usable(let loaded) = result else {
            return XCTFail("Expected .usable, got \(result)")
        }
        XCTAssertEqual(loaded, snapshot)
    }

    func testLoadWithoutAnySavedDataReturnsNotFound() {
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo")
        XCTAssertEqual(result, .unusable(.notFound, ageSeconds: nil))
    }

    func testLoadWithDifferentUserIsUnusable() {
        store.save(makeSnapshot(userID: "user-1"))
        let result = store.load(userID: "user-2", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo")
        XCTAssertEqual(result.outcome, .userMismatch)
    }

    func testLoadWithDifferentDateIsUnusable() {
        store.save(makeSnapshot(requestedDate: "2026-10-20"))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo")
        XCTAssertEqual(result.outcome, .dateMismatch)
    }

    func testLoadWithDifferentTimezoneIsUnusable() {
        store.save(makeSnapshot(requestedTimezone: "UTC"))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo")
        XCTAssertEqual(result.outcome, .timezoneMismatch)
    }

    func testLoadOlderThanTwelveHoursIsExpired() {
        let old = Date().addingTimeInterval(-(HomeSnapshotStore.maxAge + 60))
        store.save(makeSnapshot(fetchedAt: old))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo")
        XCTAssertEqual(result.outcome, .expired)
    }

    func testLoadWithinTwelveHoursIsUsable() {
        let recent = Date().addingTimeInterval(-(HomeSnapshotStore.maxAge - 60))
        store.save(makeSnapshot(fetchedAt: recent))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo")
        guard case .usable = result else {
            return XCTFail("Expected .usable, got \(result)")
        }
    }

    func testLoadWithFutureFetchedAtIsUnusable() {
        // 端末時計の巻き戻り等、不自然な未来方向のデータは使わない。
        let future = Date().addingTimeInterval(60)
        store.save(makeSnapshot(fetchedAt: future))
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo")
        XCTAssertEqual(result.outcome, .expired)
    }

    func testLoadWithCorruptedFileIsUnusable() throws {
        let fileURL = tempDirectory.appendingPathComponent("home_snapshot.json")
        try Data("not json".utf8).write(to: fileURL)
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo")
        XCTAssertEqual(result.outcome, .decodeFailed)
    }

    func testClearRemovesSavedData() {
        store.save(makeSnapshot())
        store.clear()
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo")
        XCTAssertEqual(result.outcome, .notFound)
    }

    func testClearWithNoSavedDataDoesNotThrow() {
        store.clear()
        let result = store.load(userID: "user-1", requestedDate: "2026-10-21", requestedTimezone: "Asia/Tokyo")
        XCTAssertEqual(result.outcome, .notFound)
    }
}
