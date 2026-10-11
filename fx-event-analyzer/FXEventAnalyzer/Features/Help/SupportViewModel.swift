import Foundation

/// SCR-020 お問い合わせ・フィードバックの送信。返信はBackendがその場で
/// 自動で作る(ルールとテンプレート)。
///
/// HQ指示(Calendar/Settings/Accountのみ移植): 元の実装は送信後、通知一覧の
/// 「システム」にも返信を記録していた(`NotificationsStore.recordSystem`、
/// HQ指示 2026-10-06「返信はアプリ内」)が、通知一覧・バッジ基盤自体は今回の
/// ポート対象外のため、その記録は行わない — 送信してその場で自動返信を見せる
/// ところまでがこのViewModelの責務。同じ理由で「お問い合わせ履歴」
/// (`SupportHistoryView`)関連の状態も持たない。
@MainActor
final class SupportViewModel: ObservableObject {
    enum SendState: Equatable {
        case idle
        case sending
        case sent(SupportRequest)
        case error(String)
    }

    static let maxLength = 2000
    /// これより短い内容は送らない(Backendも意味の分からない内容には返信しない)。
    static let minLength = 5

    @Published var category = "OTHER"
    @Published var body = ""
    @Published private(set) var sendState: SendState = .idle

    private let service: SupportService

    init(apiClient: APIClient) {
        service = SupportService(apiClient: apiClient)
    }

    var trimmedBody: String { body.trimmingCharacters(in: .whitespacesAndNewlines) }
    var canSend: Bool {
        sendState != .sending && trimmedBody.count >= Self.minLength && body.utf16.count <= Self.maxLength
    }

    func send(kind: SupportRequest.Kind) async {
        guard canSend else { return }
        sendState = .sending
        let request = NewSupportRequest.withDeviceInfo(kind: kind, category: kind == .feedback ? "OTHER" : category, body: trimmedBody)
        do {
            let sent = try await service.send(request)
            sendState = .sent(sent)
            body = ""
        } catch APIError.server(code: _, message: _, httpStatus: 429), APIError.unexpectedStatus(429) {
            sendState = .error("短い時間に何度も送信されています。しばらくしてからお試しください。")
        } catch {
            sendState = .error("送信できませんでした。通信環境を確認して、もう一度お試しください。")
        }
    }

    func resetForm() {
        sendState = .idle
    }

    /// 返信しない(意味の分からない・迷惑な)内容でも、送った人には受け付けたことだけを伝える。
    static func replyText(_ request: SupportRequest) -> String {
        request.replyBody ?? "お問い合わせを受け付けました。"
    }
}
