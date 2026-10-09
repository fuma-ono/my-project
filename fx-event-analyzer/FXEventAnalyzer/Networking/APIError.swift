import Foundation

/// Error codes mirrored from `docs/projects/fx-event-analyzer/api-design.md`
/// §4 (Error Response). These are the codes the Backend is specified to
/// return in `error.code`; the client must not invent its own vocabulary
/// for the same failure modes.
enum APIErrorCode: String, Decodable, Equatable {
    case unauthorized = "UNAUTHORIZED"
    case forbidden = "FORBIDDEN"
    case notFound = "NOT_FOUND"
    case validationError = "VALIDATION_ERROR"
    case conflict = "CONFLICT"
    case rateLimited = "RATE_LIMITED"
    case internalError = "INTERNAL_ERROR"
    case serviceUnavailable = "SERVICE_UNAVAILABLE"
    case eventNotFound = "EVENT_NOT_FOUND"
    case indicatorNotFound = "INDICATOR_NOT_FOUND"
    case fxPairNotFound = "FX_PAIR_NOT_FOUND"
    case subscriptionRequired = "SUBSCRIPTION_REQUIRED"
    case featureNotEntitled = "FEATURE_NOT_ENTITLED"
}

/// Decodes `docs/projects/fx-event-analyzer/api-design.md` §4's Error
/// Response body: `{ "error": { "code": "...", "message": "..." } }`.
struct APIErrorBody: Decodable {
    struct Detail: Decodable {
        let code: String
        let message: String
    }
    let error: Detail
}

/// Client-side representation of anything that can go wrong calling the
/// Backend. `notConfigured` and `transport` are client-only states (no
/// Backend exists to reach yet in Phase 1 — see `APIClient.swift`); every
/// other case maps 1:1 to an `APIErrorCode` returned by the Backend.
///
/// Per api-design.md §7, "data not ready yet" states (DATA_PENDING /
/// DATA_UNAVAILABLE / NOT_ANALYZABLE) are never HTTP errors — they arrive
/// as HTTP 200 + a status field, so they are intentionally absent here.
/// ViewModels that consume such a response decode the status field
/// themselves; it is not part of this error type.
enum APIError: Error, Equatable {
    /// No Backend base URL is configured yet (expected in Phase 1 — the
    /// Backend is built in Phase 6). Callers must present this distinctly
    /// from a real network failure, never as a generic crash.
    case notConfigured
    case transport(String)
    case decoding(String)
    case server(code: APIErrorCode, message: String, httpStatus: Int)
    case unexpectedStatus(Int)

    var isNotConfigured: Bool {
        if case .notConfigured = self { return true }
        return false
    }
}
