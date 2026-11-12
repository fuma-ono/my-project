import XCTest
@testable import FXEventAnalyzer

final class SupabaseConfigTests: XCTestCase {
    func testLoadReturnsNilWhenInfoPlistHasNoSupabaseKeys() {
        // The test bundle's Info.plist has no SUPABASE_URL/SUPABASE_ANON_KEY
        // entries — this is the expected state for all of Phase 1 (no real
        // Supabase project exists yet). Must not crash.
        let config = SupabaseConfig.loadFromInfoPlist(bundle: Bundle(for: Self.self))
        XCTAssertNil(config)
    }

    func testAuthURLAppendsAuthV1Path() {
        let config = SupabaseConfig(
            projectURL: URL(string: "https://example.supabase.co")!,
            anonKey: "anon-key"
        )
        XCTAssertEqual(config.authURL.absoluteString, "https://example.supabase.co/auth/v1")
    }
}

final class UserSessionTests: XCTestCase {
    func testIsExpiredReflectsExpiresAt() {
        let expired = UserSession(userID: UUID(), accessToken: "t", expiresAt: Date().addingTimeInterval(-1))
        let valid = UserSession(userID: UUID(), accessToken: "t", expiresAt: Date().addingTimeInterval(3600))

        XCTAssertTrue(expired.isExpired)
        XCTAssertFalse(valid.isExpired)
    }
}
