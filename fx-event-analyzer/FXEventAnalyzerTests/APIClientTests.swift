import XCTest
@testable import FXEventAnalyzer

final class APIClientTests: XCTestCase {
    func testSendThrowsNotConfiguredWhenNoBaseURL() async {
        let client = URLSessionAPIClient(baseURLProvider: { nil })

        do {
            let _: HomeResponse = try await client.send(Endpoint(path: "home"))
            XCTFail("Expected APIError.notConfigured to be thrown")
        } catch let error as APIError {
            XCTAssertTrue(error.isNotConfigured)
        } catch {
            XCTFail("Expected APIError, got \(error)")
        }
    }

    func testAPIErrorBodyDecodesServerErrorShape() throws {
        // Matches api-design.md §4's Error Response shape verbatim.
        let json = """
        { "error": { "code": "EVENT_NOT_FOUND", "message": "Event not found." } }
        """.data(using: .utf8)!

        let body = try JSONDecoder().decode(APIErrorBody.self, from: json)

        XCTAssertEqual(body.error.code, "EVENT_NOT_FOUND")
        XCTAssertEqual(body.error.message, "Event not found.")
        XCTAssertEqual(APIErrorCode(rawValue: body.error.code), .eventNotFound)
    }
}
