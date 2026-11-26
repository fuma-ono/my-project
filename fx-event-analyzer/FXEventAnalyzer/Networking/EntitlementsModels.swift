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
    /// 1.0公開用のサーバー側フラグ(2026-11-24 オーナー決定)。価格由来の情報(為替レート・pips・
    /// チャート・戦略分析・価格アラート)を見せてよいか。キーが無い(古いBackend)ときはnil=false扱い。
    var priceFeaturesEnabled: Bool? = nil
    /// 購入(PRO課金)の導線を見せてよいか。キーが無いときはnil=false扱い。
    var purchasesEnabled: Bool? = nil
    /// テクニカル分析(チャート・指標)を見せてよいか。キーが無い(古いBackend)ときはnil=false扱い。
    /// 画面は`price_features_enabled`と両方trueのときだけ出す。
    var technicalAnalysisEnabled: Bool? = nil

    enum CodingKeys: String, CodingKey {
        case features
        case plan
        case limits
        case priceFeaturesEnabled = "price_features_enabled"
        case purchasesEnabled = "purchases_enabled"
        case technicalAnalysisEnabled = "technical_analysis_enabled"
    }
}
