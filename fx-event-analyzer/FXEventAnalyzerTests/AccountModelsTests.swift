import XCTest
@testable import FXEventAnalyzer

/// Decodes literal JSON matching the real Backend's response shapes
/// verbatim (fx-event-analyzer-backend/src/routes/{account,subscription,
/// entitlements}.ts) through the same `.iso8601`-configured `JSONDecoder`
/// `URLSessionAPIClient` uses — `MockAPIClient`-based tests elsewhere skip
/// real JSON parsing entirely, so this is the one place CodingKeys/date-
/// format mismatches against the real Backend would actually be caught.
final class AccountModelsTests: XCTestCase {
    private func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    func testAccountResponseDecodesRealBackendShape() throws {
        let json = """
        {
          "user_id": "00000000-0000-0000-0000-000000000001",
          "created_at": "2026-09-10T12:30:00.000Z",
          "updated_at": "2026-09-10T12:30:00.000Z"
        }
        """.data(using: .utf8)!

        let account = try makeDecoder().decode(AccountResponse.self, from: json)

        XCTAssertEqual(account.userID, UUID(uuidString: "00000000-0000-0000-0000-000000000001"))
        XCTAssertEqual(account.createdAt, account.updatedAt)
    }

    func testSubscriptionResponseDecodesAnActiveSubscription() throws {
        let json = """
        {
          "plan": "PRO",
          "status": "ACTIVE",
          "started_at": "2026-09-01T00:00:00.000Z",
          "expires_at": "2026-10-01T00:00:00.000Z"
        }
        """.data(using: .utf8)!

        let subscription = try makeDecoder().decode(SubscriptionResponse.self, from: json)

        XCTAssertEqual(subscription.plan, "PRO")
        XCTAssertEqual(subscription.status, "ACTIVE")
        XCTAssertNotNil(subscription.startedAt)
        XCTAssertNotNil(subscription.expiresAt)
    }

    func testSubscriptionResponseDecodesTheImplicitFreeDefault() throws {
        // api-design.md §25: no subscriptions row is a legitimate state,
        // reported as FREE with everything else null — never a 404.
        let json = """
        { "plan": "FREE", "status": null, "started_at": null, "expires_at": null }
        """.data(using: .utf8)!

        let subscription = try makeDecoder().decode(SubscriptionResponse.self, from: json)

        XCTAssertEqual(subscription.plan, "FREE")
        XCTAssertNil(subscription.status)
        XCTAssertNil(subscription.startedAt)
        XCTAssertNil(subscription.expiresAt)
    }

    func testEntitlementsResponseDecodesFeatureList() throws {
        let json = """
        { "features": ["VIEW_BASIC_EVENT", "VIEW_HISTORICAL"] }
        """.data(using: .utf8)!

        let entitlements = try makeDecoder().decode(EntitlementsResponse.self, from: json)

        XCTAssertEqual(entitlements.features, ["VIEW_BASIC_EVENT", "VIEW_HISTORICAL"])
    }

    func testEntitlementsResponseDecodesEmptyFeatureList() throws {
        let json = """
        { "features": [] }
        """.data(using: .utf8)!

        let entitlements = try makeDecoder().decode(EntitlementsResponse.self, from: json)

        XCTAssertEqual(entitlements.features, [])
    }
}
