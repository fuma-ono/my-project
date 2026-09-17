import Foundation

/// `GET /api/v1/entitlements` response shape (api-design.md §27) — the
/// user's currently-active `feature_code`s only (expired/disabled rows are
/// filtered out Backend-side, not left for the client to interpret).
struct EntitlementsResponse: Decodable, Equatable {
    let features: [String]
}
