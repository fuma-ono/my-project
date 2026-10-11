import XCTest
@testable import FXEventAnalyzer

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

/// HQ指示(Calendar/Settings/Accountのみ移植): 元のテストは送信成功後に
/// `NotificationsStore`へ「システム」通知を記録することも検証していたが、
/// 通知一覧・バッジ基盤自体がこのポートの対象外(`SupportViewModel`からその
/// 呼び出しを削除済み)のため、その検証は外した。送信・検証・自動返信表示の
/// 挙動はそのまま確認する。
@MainActor
final class SupportViewModelTests: XCTestCase {
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
        let viewModel = SupportViewModel(apiClient: MockAPIClient())
        viewModel.body = " あ "
        XCTAssertFalse(viewModel.canSend)
        viewModel.body = "通知が届きません"
        XCTAssertTrue(viewModel.canSend)
    }

    func testSendingPostsTheRequestAndShowsTheReply() async throws {
        let apiClient = MockAPIClient()
        apiClient.result = .success(request(status: .escalated, reply: "不具合のご報告ありがとうございます。"))
        let viewModel = SupportViewModel(apiClient: apiClient)
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
        if case .sent(let sent) = viewModel.sendState {
            XCTAssertEqual(sent.replyBody, "不具合のご報告ありがとうございます。")
        } else {
            XCTFail("expected .sent")
        }
    }

    func testIgnoredRequestsStillShowTheGenericAcknowledgement() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(request(status: .ignored, reply: nil))
        let viewModel = SupportViewModel(apiClient: apiClient)
        viewModel.body = "ああああああ"

        await viewModel.send(kind: .feedback)

        if case .sent(let sent) = viewModel.sendState {
            XCTAssertEqual(SupportViewModel.replyText(sent), "お問い合わせを受け付けました。")
        } else {
            XCTFail("expected .sent")
        }
    }

    func testRateLimitShowsAFriendlyMessage() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.server(code: .validationError, message: "Too many", httpStatus: 429))
        let viewModel = SupportViewModel(apiClient: apiClient)
        viewModel.body = "通知が届きません"

        await viewModel.send(kind: .inquiry)

        XCTAssertEqual(viewModel.sendState, .error("短い時間に何度も送信されています。しばらくしてからお試しください。"))
    }
}
