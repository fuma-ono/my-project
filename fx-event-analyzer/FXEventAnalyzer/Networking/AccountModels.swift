import Foundation

/// `GET /api/v1/account` response shape (api-design.md §24) — the Backend
/// never returns a raw Profile row, only these three fields.
struct AccountResponse: Decodable, Equatable {
    let userID: UUID
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}
