import Foundation
import UIKit

/// SCR-020 ヘルプ・お問い合わせ(api-design.md「Support API」)。お問い合わせ・
/// フィードバックはBackendにためられ、ルールとテンプレートで自動返信される
/// (意味の分からない内容・迷惑な内容には返信しない)。不具合の報告はBackendが
/// GitHub Issueとして改修対象に登録する(その情報はアプリには返らない)。
struct SupportRequest: Decodable, Equatable, Identifiable {
    enum Kind: String, Codable { case inquiry = "INQUIRY", feedback = "FEEDBACK" }
    /// `REPLIED`(返信あり) / `ESCALATED`(不具合として登録・返信あり) / `IGNORED`(返信しない)
    enum Status: String, Codable { case replied = "REPLIED", escalated = "ESCALATED", ignored = "IGNORED" }

    let id: String
    let kind: Kind
    let category: String
    let body: String
    let status: Status
    let replyBody: String?
    let repliedAt: Date?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, kind, category, body, status
        case replyBody = "reply_body"
        case repliedAt = "replied_at"
        case createdAt = "created_at"
    }
}

struct SupportRequestListResponse: Decodable, Equatable {
    let data: [SupportRequest]
}

struct NewSupportRequest: Encodable, Equatable {
    let kind: SupportRequest.Kind
    let category: String
    let body: String
    let appVersion: String?
    let osVersion: String?
    let deviceModel: String?

    enum CodingKeys: String, CodingKey {
        case kind, category, body
        case appVersion = "app_version"
        case osVersion = "os_version"
        case deviceModel = "device_model"
    }

    /// 不具合の調査に使う端末の情報を添える(個人を特定する情報は送らない)。
    @MainActor
    static func withDeviceInfo(kind: SupportRequest.Kind, category: String, body: String) -> NewSupportRequest {
        var systemInfo = utsname()
        uname(&systemInfo)
        let model = withUnsafeBytes(of: &systemInfo.machine) { buffer in
            String(decoding: buffer.prefix { $0 != 0 }, as: UTF8.self)
        }
        return NewSupportRequest(
            kind: kind,
            category: category,
            body: body,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
            osVersion: "iOS " + UIDevice.current.systemVersion,
            deviceModel: model
        )
    }
}

enum SupportCategory {
    /// お問い合わせの種類(Backendの`category`)。
    static let inquiryOptions: [(value: String, label: String)] = [
        ("ACCOUNT", "アカウントについて"),
        ("BILLING", "プラン・支払いについて"),
        ("NOTIFICATION", "通知について"),
        ("CHART", "チャートの使い方"),
        ("DATA", "データの見方"),
        ("BUG", "不具合の報告"),
        ("OTHER", "その他"),
    ]

    static func label(_ value: String) -> String {
        inquiryOptions.first { $0.value == value }?.label ?? "その他"
    }
}

struct SupportService {
    let apiClient: APIClient

    func send(_ request: NewSupportRequest) async throws -> SupportRequest {
        let body = try JSONEncoder().encode(request)
        return try await apiClient.send(Endpoint(path: "support/requests", method: .post, body: body))
    }

    func history() async throws -> [SupportRequest] {
        let response: SupportRequestListResponse = try await apiClient.send(Endpoint(path: "support/requests"))
        return response.data
    }
}
