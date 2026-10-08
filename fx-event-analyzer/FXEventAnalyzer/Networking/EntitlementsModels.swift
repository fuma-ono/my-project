import Foundation

/// `GET /api/v1/entitlements` response shape (api-design.md §27) — the
/// user's currently-active `feature_code`s only (expired/disabled rows are
/// filtered out Backend-side, not left for the client to interpret).
struct EntitlementsResponse: Decodable, Equatable {
    enum Plan: String, Decodable, Equatable {
        case free = "FREE"
        case pro = "PRO"
    }

    let features: [String]
    /// v1.15で追加(HQ指示 2026-10-08、無料プランの制限)。古いBackendではnil。
    var plan: Plan? = nil
    var limits: PlanLimits? = nil
}
