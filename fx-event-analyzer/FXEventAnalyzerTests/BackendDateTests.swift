import XCTest
@testable import FXEventAnalyzer

/// 本番のBackend(PostgresのtimestamptzをそのままJSONにする)が返す日時の形。
final class BackendDateTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 1_791_256_365) // 2026-10-06T03:12:45Z

    func testParsesWithoutFraction() {
        XCTAssertEqual(BackendDate.parse("2026-10-06T03:12:45Z"), base)
        XCTAssertEqual(BackendDate.parse("2026-10-06T12:12:45+09:00"), base)
    }

    func testParsesMicrosecondsAndMilliseconds() throws {
        let micro = try XCTUnwrap(BackendDate.parse("2026-10-06T03:12:45.123456+00:00"))
        XCTAssertEqual(micro.timeIntervalSince(base), 0.123456, accuracy: 0.000001)
        let milli = try XCTUnwrap(BackendDate.parse("2026-10-06T03:12:45.5Z"))
        XCTAssertEqual(milli.timeIntervalSince(base), 0.5, accuracy: 0.000001)
    }

    func testRejectsGarbage() {
        XCTAssertNil(BackendDate.parse("not a date"))
        XCTAssertNil(BackendDate.parse("2026-10-06"))
    }

    func testAccountResponseDecodesPostgresTimestamps() throws {
        let json = Data(#"{"user_id":"7d0c3a1e-5a9f-4d6b-9a0e-2f5f7c1d2b3a","created_at":"2026-10-06T03:12:45.123456+00:00","updated_at":"2026-10-06T03:12:45+00:00","display_name":null,"birth_date":null}"#.utf8)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(BackendDate.decode)
        let account = try decoder.decode(AccountResponse.self, from: json)
        XCTAssertEqual(account.updatedAt, base)
    }
}
