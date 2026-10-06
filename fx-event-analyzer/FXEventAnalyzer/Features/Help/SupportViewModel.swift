import Foundation

/// SCR-020 お問い合わせ・フィードバックの送信と履歴。返信はBackendがその場で
/// 自動で作る(ルールとテンプレート)。返信があったときは通知一覧の「システム」
/// にも残す(HQ指示 2026-10-06「返信はアプリ内」)。
@MainActor
final class SupportViewModel: ObservableObject {
    enum SendState: Equatable {
        case idle
        case sending
        case sent(SupportRequest)
        case error(String)
    }

    enum HistoryState: Equatable {
        case loading
        case loaded([SupportRequest])
        case error(String)
    }

    static let maxLength = 2000
    /// これより短い内容は送らない(Backendも意味の分からない内容には返信しない)。
    static let minLength = 5

    @Published var category = "OTHER"
    @Published var body = ""
    @Published private(set) var sendState: SendState = .idle
    @Published private(set) var historyState: HistoryState = .loading

    private let service: SupportService
    private let store: NotificationsStore

    init(apiClient: APIClient, store: NotificationsStore? = nil) {
        service = SupportService(apiClient: apiClient)
        self.store = store ?? .shared
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
            if let reply = sent.replyBody {
                store.recordSystem(
                    targetID: Self.notificationTargetPrefix + sent.id,
                    title: kind == .feedback ? "フィードバックへのお礼" : "お問い合わせに返信しました",
                    body: reply
                )
            }
        } catch APIError.server(code: _, message: _, httpStatus: 429) {
            sendState = .error("短い時間に何度も送信されています。しばらくしてからお試しください。")
        } catch {
            sendState = .error("送信できませんでした。通信環境を確認して、もう一度お試しください。")
        }
    }

    func resetForm() {
        sendState = .idle
    }

    func loadHistory() async {
        historyState = .loading
        do {
            historyState = .loaded(try await service.history())
        } catch {
            historyState = .error("履歴を読み込めませんでした。")
        }
    }

    /// 通知一覧のシステム通知から、お問い合わせ履歴を開くための印。
    static let notificationTargetPrefix = "support-"

    /// 返信しない(意味の分からない・迷惑な)内容でも、送った人には受け付けたことだけを伝える。
    static func replyText(_ request: SupportRequest) -> String {
        request.replyBody ?? "お問い合わせを受け付けました。"
    }
}
