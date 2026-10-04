import Foundation

/// api-design.md §5 Pagination envelope, shared by every list endpoint.
struct PaginationMeta: Decodable, Equatable {
    let page: Int
    let limit: Int
    let total: Int
    let hasNext: Bool

    enum CodingKeys: String, CodingKey {
        case page
        case limit
        case total
        case hasNext = "has_next"
    }
}
