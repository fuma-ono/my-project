import XCTest
@testable import FXEventAnalyzer

private func waitUntil(_ condition: @escaping () -> Bool) async {
    for _ in 0..<100 {
        if condition() { return }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
}

final class HelpFAQTests: XCTestCase {
    func testEveryCategoryHasQuestions() {
        XCTAssertEqual(HelpFAQ.categories.map(\.title), ["アカウントについて", "プラン・支払いについて", "通知について", "チャートの使い方", "データの見方", "その他"])
        XCTAssertTrue(HelpFAQ.categories.allSatisfy { !$0.items.isEmpty })
    }

    func testSearchMatchesQuestionsAndAnswersWithAllWords() {
        XCTAssertTrue(HelpFAQ.search("解約").contains { $0.item.question == "解約したい" })
        XCTAssertTrue(HelpFAQ.search("通知 時間帯").contains { $0.item.question == "夜は通知を止めたい" })
        XCTAssertTrue(HelpFAQ.search("  ").isEmpty)
        XCTAssertTrue(HelpFAQ.search("存在しないキーワードxyz").isEmpty)
    }
}

@MainActor
final class SupportViewModelTests: XCTestCase {
    private func makeStore() -> NotificationsStore {
        NotificationsStore(userDefaults: UserDefaults(suiteName: "SupportTests-\(UUID().uuidString)")!)
    }

    private func request(status: SupportRequest.Status, reply: String?) -> SupportRequest {
        SupportRequest(id: "r1", kind: .inquiry, category: "BUG", body: "アプリが落ちます", status: status, replyBody: reply, repliedAt: nil, createdAt: Date())
    }

    func testDecodesTheSupportRequest() throws {
        let json = Data(#"{"id":"r1","kind":"FEEDBACK","category":"OTHER","body":"いいアプリ","status":"IGNORED","reply_body":null,"replied_at":null,"created_at":"2026-10-06T09:00:00Z"}"#.utf8)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(SupportRequest.self, from: json)
        XCTAssertEqual(decoded.kind, .feedback)
        XCTAssertEqual(decoded.status, .ignored)
        XCTAssertEqual(SupportViewModel.replyText(decoded), "お問い合わせを受け付けました。")
    }

    func testTooShortBodiesCannotBeSent() {
        let viewModel = SupportViewModel(apiClient: MockAPIClient(), store: makeStore())
        viewModel.body = " あ "
        XCTAssertFalse(viewModel.canSend)
        viewModel.body = "通知が届きません"
        XCTAssertTrue(viewModel.canSend)
    }

    func testSendingPostsTheRequestAndRecordsTheReply() async throws {
        let apiClient = MockAPIClient()
        apiClient.result = .success(request(status: .escalated, reply: "不具合のご報告ありがとうございます。"))
        let store = makeStore()
        let viewModel = SupportViewModel(apiClient: apiClient, store: store)
        viewModel.category = "BUG"
        viewModel.body = "アプリが落ちます"

        await viewModel.send(kind: .inquiry)

        XCTAssertEqual(apiClient.lastEndpoint?.path, "support/requests")
        XCTAssertEqual(apiClient.lastEndpoint?.method, .post)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(apiClient.lastEndpoint?.body)) as? [String: Any])
        XCTAssertEqual(body["kind"] as? String, "INQUIRY")
        XCTAssertEqual(body["category"] as? String, "BUG")
        XCTAssertNotNil(body["os_version"])
        XCTAssertEqual(viewModel.body, "")
        let entry = try XCTUnwrap(store.entries.first)
        XCTAssertEqual(entry.kind, .system)
        XCTAssertEqual(NotificationListView.route(for: entry), .supportHistory)
    }

    func testIgnoredRequestsDoNotCreateANotification() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(request(status: .ignored, reply: nil))
        let store = makeStore()
        let viewModel = SupportViewModel(apiClient: apiClient, store: store)
        viewModel.body = "ああああああ"

        await viewModel.send(kind: .feedback)

        XCTAssertTrue(store.entries.isEmpty)
        if case .sent = viewModel.sendState {} else { XCTFail("expected .sent") }
    }

    func testRateLimitShowsAFriendlyMessage() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.server(code: .validationError, message: "Too many", httpStatus: 429))
        let viewModel = SupportViewModel(apiClient: apiClient, store: makeStore())
        viewModel.body = "通知が届きません"

        await viewModel.send(kind: .inquiry)

        XCTAssertEqual(viewModel.sendState, .error("短い時間に何度も送信されています。しばらくしてからお試しください。"))
    }
}
