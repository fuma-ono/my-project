import XCTest
@testable import FXEventAnalyzer

final class AccountServiceTests: XCTestCase {
    func testFetchAccountCallsTheAccountPath() async throws {
        let apiClient = MockAPIClient()
        let account = AccountResponse(userID: UUID(), createdAt: Date(), updatedAt: Date())
        apiClient.result = .success(account)

        let result = try await AccountService(apiClient: apiClient).fetchAccount()

        XCTAssertEqual(apiClient.lastEndpoint?.path, "account")
        XCTAssertEqual(apiClient.lastEndpoint?.method, .get)
        XCTAssertEqual(result, account)
    }

    func testFetchAccountPropagatesServerErrors() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.server(code: .unauthorized, message: "Missing token.", httpStatus: 401))

        do {
            _ = try await AccountService(apiClient: apiClient).fetchAccount()
            XCTFail("Expected an error to be thrown")
        } catch let error as APIError {
            XCTAssertEqual(error, .server(code: .unauthorized, message: "Missing token.", httpStatus: 401))
        } catch {
            XCTFail("Expected APIError, got \(error)")
        }
    }
}

final class SubscriptionServiceTests: XCTestCase {
    func testFetchSubscriptionCallsTheSubscriptionPath() async throws {
        let apiClient = MockAPIClient()
        let subscription = SubscriptionResponse(plan: "FREE", status: nil, startedAt: nil, expiresAt: nil)
        apiClient.result = .success(subscription)

        let result = try await SubscriptionService(apiClient: apiClient).fetchSubscription()

        XCTAssertEqual(apiClient.lastEndpoint?.path, "subscription")
        XCTAssertEqual(apiClient.lastEndpoint?.method, .get)
        XCTAssertEqual(result, subscription)
    }
}

final class EntitlementsServiceTests: XCTestCase {
    func testFetchEntitlementsCallsTheEntitlementsPath() async throws {
        let apiClient = MockAPIClient()
        let entitlements = EntitlementsResponse(features: ["VIEW_BASIC_EVENT"])
        apiClient.result = .success(entitlements)

        let result = try await EntitlementsService(apiClient: apiClient).fetchEntitlements()

        XCTAssertEqual(apiClient.lastEndpoint?.path, "entitlements")
        XCTAssertEqual(apiClient.lastEndpoint?.method, .get)
        XCTAssertEqual(result, entitlements)
    }
}
