import Foundation

/// `GET/PATCH /api/v1/settings` response shape (api-design.md §24.4) —
/// SCR-018 通知設定 / SCR-020 表示・地域設定 / SCR-021 チャート設定.
/// `updated_at` is deliberately not decoded: no screen uses it.
struct SettingsResponse: Decodable, Equatable {
    var notifications: NotificationSettings
    var display: DisplaySettings
    var chart: ChartSettings
}

/// One editable group of `SettingsResponse`. Each settings screen edits
/// exactly one section and PATCHes it as a whole.
protocol SettingsSection: Codable, Equatable {
    /// Same values as the `user_settings` column defaults (db-design.md
    /// §3.14) — shown only until `GET /settings` answers.
    static var defaults: Self { get }
}

/// 通知対象の保存のみ(MVPではPush通知を送らない、api-design.md §24.4)。
struct NotificationSettings: SettingsSection {
    /// 重要指標の発表前通知
    var preRelease: Bool
    /// 重要指標の結果通知
    var result: Bool
    /// お気に入りイベント通知
    var favorites: Bool
    /// 通知する重要度の下限(★1〜★5)。指標のLOW/MEDIUM/HIGHとは
    /// 暫定マッピング LOW→★1 / MEDIUM→★3 / HIGH→★5(db-design.md §3.14)。
    var minImportance: Int

    static let defaults = NotificationSettings(preRelease: true, result: true, favorites: true, minImportance: 3)
    static let importanceRange = 1...5

    enum CodingKeys: String, CodingKey {
        case preRelease = "pre_release"
        case result
        case favorites
        case minImportance = "min_importance"
    }
}

struct DisplaySettings: SettingsSection {
    /// `ja` / `en`
    var language: String
    /// ISO 3166-1 alpha-2
    var region: String
    /// IANA timezone名
    var timezone: String

    static let defaults = DisplaySettings(language: "ja", region: "JP", timezone: "Asia/Tokyo")
}

struct ChartSettings: SettingsSection {
    /// `fx_pairs.symbol`、`nil`は「指定なし」
    var defaultFxPairSymbol: String?
    /// `1m` / `5m` / `15m` / `30m` / `60m`
    var defaultTimeframe: String

    static let defaults = ChartSettings(defaultFxPairSymbol: nil, defaultTimeframe: "5m")

    enum CodingKeys: String, CodingKey {
        case defaultFxPairSymbol = "default_fx_pair_symbol"
        case defaultTimeframe = "default_timeframe"
    }

    /// Hand-written so `nil` is sent as an explicit JSON `null` (clears the
    /// pair). The synthesized encoder would omit the key, which PATCH
    /// treats as "leave unchanged".
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(defaultFxPairSymbol, forKey: .defaultFxPairSymbol)
        try container.encode(defaultTimeframe, forKey: .defaultTimeframe)
    }
}

/// `PATCH /api/v1/settings` body (api-design.md §24.5): only the sections
/// present are updated (`nil` sections are omitted from the JSON).
struct SettingsUpdate: Encodable, Equatable {
    var notifications: NotificationSettings?
    var display: DisplaySettings?
    var chart: ChartSettings?
}
