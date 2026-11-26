import XCTest
@testable import FXEventAnalyzer

final class ServerWarmUpTests: XCTestCase {
    func testHealthURLIsHostRootNotUnderAPIPath() {
        let base = URL(string: "https://example.onrender.com/api/v1")
        XCTAssertEqual(ServerWarmUp.healthURL(from: base)?.absoluteString, "https://example.onrender.com/health")
    }

    func testHealthURLKeepsPortAndDropsQuery() {
        let base = URL(string: "http://localhost:3000/api/v1?x=1")
        XCTAssertEqual(ServerWarmUp.healthURL(from: base)?.absoluteString, "http://localhost:3000/health")
    }

    func testNoBaseURLMeansNoWarmUp() {
        XCTAssertNil(ServerWarmUp.healthURL(from: nil))
    }
}
