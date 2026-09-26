import Foundation

/// Describes a single Backend request against `api-design.md`'s `/api/v1`
/// base path. Deliberately minimal for Phase 1 — no endpoints are called
/// yet (the Backend is Phase 6); this exists so `APIClient` and its
/// consumers (starting with `HomeViewModel`) have a real shape to build
/// against instead of ad-hoc `URLRequest` construction later.
struct Endpoint {
    enum Method: String, Equatable {
        case get = "GET"
        case post = "POST"
        case patch = "PATCH"
        case delete = "DELETE"
    }

    let path: String
    let method: Method
    let queryItems: [URLQueryItem]

    init(path: String, method: Method = .get, queryItems: [URLQueryItem] = []) {
        self.path = path
        self.method = method
        self.queryItems = queryItems
    }
}
