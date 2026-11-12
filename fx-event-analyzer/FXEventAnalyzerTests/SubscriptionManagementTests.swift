import XCTest
@testable import FXEventAnalyzer

@MainActor
private final class MockPurchaseClient: PurchaseClient {
    var loadedProducts: [ProProduct] = []
    var outcome: PurchaseOutcome = .cancelled
    var current: SignedPurchase?
    var restored: SignedPurchase?
    var records: [PurchaseRecord] = []
    private(set) var purchasedToken: UUID?
    private(set) var manageShown = false

    func products() async throws -> [ProProduct] { loadedProducts }

    func purchase(productID: String, appAccountToken: UUID) async throws -> PurchaseOutcome {
        purchasedToken = appAccountToken
        return outcome
    }

    func currentSubscription() async -> SignedPurchase? { current }
    func restore() async throws -> SignedPurchase? { restored }
    func history() async -> [PurchaseRecord] { records }
    func showManageSubscriptions() async { manageShown = true }
}

@MainActor
final class SubscriptionManagementViewModelTests: XCTestCase {
    private let expires = Date(timeIntervalSince1970: 1_793_934_000) // 2026-11-06T03:00:00Z
    private var pro: SubscriptionResponse {
        SubscriptionResponse(plan: "PRO", status: "ACTIVE", startedAt: nil, expiresAt: expires, productId: ProProduct.yearlyID)
    }

    func testDecodesTheProductOfTheSubscription() throws {
        let json = Data(#"{"plan":"PRO","status":"CANCELED","started_at":null,"expires_at":null,"product_id":"com.fumaono.fxeventanalyzer.pro.monthly"}"#.utf8)
        let response = try JSONDecoder().decode(SubscriptionResponse.self, from: json)
        XCTAssertEqual(response.productId, ProProduct.monthlyID)
        XCTAssertTrue(response.isCanceled)
    }

    func testProPlanShowsPriceAndRenewalDate() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(pro)
        let purchases = MockPurchaseClient()
        purchases.loadedProducts = [ProProduct(id: ProProduct.yearlyID, period: .yearly, displayPrice: "¥9,900")]
        let viewModel = SubscriptionManagementViewModel(apiClient: apiClient, purchases: purchases)

        await viewModel.load()

        XCTAssertEqual(viewModel.loadState, .loaded)
        XCTAssertEqual(viewModel.planTitle, "プレミアムプラン")
        XCTAssertEqual(viewModel.priceLabel, "年額 ¥9,900", "StoreKit's price wins over the fallback")
        XCTAssertTrue(viewModel.renewalLabel?.hasPrefix("次回更新日 2026/11/0") == true)
        XCTAssertTrue(viewModel.canCancel)
    }

    func testFreePlanHasNoRenewalAndCannotCancel() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(SubscriptionResponse.free)
        let viewModel = SubscriptionManagementViewModel(apiClient: apiClient, purchases: MockPurchaseClient())

        await viewModel.load()

        XCTAssertEqual(viewModel.planTitle, "無料プラン")
        XCTAssertNil(viewModel.renewalLabel)
        XCTAssertFalse(viewModel.canCancel)
        XCTAssertEqual(viewModel.products, ProProduct.fallback)
    }

    func testPurchaseIsTiedToTheUserAndVerifiedByTheBackend() async throws {
        let apiClient = MockAPIClient()
        let userID = UUID()
        apiClient.results["subscription"] = .success(SubscriptionResponse.free)
        apiClient.results["account"] = .success(AccountResponse(userID: userID, createdAt: Date(), updatedAt: Date()))
        apiClient.results["subscription/verify"] = .success(pro)
        let purchases = MockPurchaseClient()
        purchases.outcome = .purchased(SignedPurchase(transaction: "jws.tx", renewalInfo: "jws.renewal"))
        let viewModel = SubscriptionManagementViewModel(apiClient: apiClient, purchases: purchases)
        await viewModel.load()
        apiClient.results["subscription"] = .success(pro)

        await viewModel.purchase(ProProduct.fallback[1])

        XCTAssertEqual(purchases.purchasedToken, userID)
        XCTAssertTrue(apiClient.requestedPaths.contains("subscription/verify"))
        XCTAssertEqual(viewModel.subscription, pro)
        XCTAssertEqual(viewModel.notice, "年額プランに登録しました。")
    }

    func testVerifyRequestSendsBothSignedValues() throws {
        let body = try JSONEncoder().encode(SignedPurchase(transaction: "a", renewalInfo: "b").request)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
        XCTAssertEqual(json, ["signed_transaction": "a", "signed_renewal_info": "b"])
    }

    func testRestoreWithNothingToRestoreSaysSo() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(SubscriptionResponse.free)
        let viewModel = SubscriptionManagementViewModel(apiClient: apiClient, purchases: MockPurchaseClient())
        await viewModel.load()

        await viewModel.restore()

        XCTAssertEqual(viewModel.notice, "復元できる購入はありませんでした。")
        XCTAssertFalse(apiClient.requestedPaths.contains("subscription/verify"))
    }

    func testCancellingOpensAppStoreAndResyncs() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(pro)
        let purchases = MockPurchaseClient()
        let viewModel = SubscriptionManagementViewModel(apiClient: apiClient, purchases: purchases)
        await viewModel.load()
        let canceled = SubscriptionResponse(plan: "PRO", status: "CANCELED", startedAt: nil, expiresAt: expires, productId: ProProduct.yearlyID)
        apiClient.result = .success(canceled)

        await viewModel.manageSubscription()

        XCTAssertTrue(purchases.manageShown)
        XCTAssertFalse(viewModel.canCancel)
        XCTAssertTrue(viewModel.renewalLabel?.contains("自動更新オフ") == true)
    }
}
