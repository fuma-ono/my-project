import Foundation

/// `GET/PATCH /api/v1/settings` response shape (api-design.md §24.4) —
/// SCR-016 通知設定 / SCR-018 表示・地域設定 / SCR-019 チャート設定.
/// `updated_at` is deliberately not decoded: no screen uses it.
struct SettingsResponse: Decodable, Equatable {
    var notifications: NotificationSettings
    var display: DisplaySettings
    var chart: ChartSettings
    /// SCR-026 ホーム通貨ペア編集(項目追加前のBackendは既定値)。
    var home: HomeSettings = .defaults

    enum CodingKeys: String, CodingKey {
        case notifications, display, chart, home
    }
}

extension SettingsResponse {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            notifications: try c.decode(NotificationSettings.self, forKey: .notifications),
            display: try c.decode(DisplaySettings.self, forKey: .display),
            chart: try c.decode(ChartSettings.self, forKey: .chart),
            home: try c.decodeIfPresent(HomeSettings.self, forKey: .home) ?? .defaults
        )
    }
}

/// SCR-026 ホーム通貨ペア編集(HQ指示 2026-10-07)。ホームに出す通貨ペア(最大3つ、
/// 並び順どおり)。`nil`はBackendの既定(USD/JPY・EUR/USD・EUR/JPY)。
struct HomeSettings: SettingsSection {
    var fxPairs: [String]?

    static let defaults = HomeSettings(fxPairs: nil)
    static let maxPairs = 3
    static let defaultPairs = ["USDJPY", "EURUSD", "EURJPY"]

    enum CodingKeys: String, CodingKey {
        case fxPairs = "fx_pairs"
    }

    /// `nil`(既定に戻す)を明示的な`null`で送る。
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(fxPairs, forKey: .fxPairs)
    }
}

/// One editable group of `SettingsResponse`. Each settings screen edits
/// exactly one section and PATCHes it as a whole.
protocol SettingsSection: Codable, Equatable {
    /// Same values as the `user_settings` column defaults (db-design.md
    /// §3.14) — shown only until `GET /settings` answers.
    static var defaults: Self { get }
}

/// SCR-016 通知設定(api-design.md §24.4)。HQ指示(2026-10-05)で参考画像の
/// 項目に作り直し、端末内のローカル通知で実際に届けるようにした
/// (`LocalNotificationScheduler`)。
struct NotificationSettings: SettingsSection {
    /// プッシュ通知(全体のON/OFF)
    var push: Bool
    /// 重要な経済指標の通知
    var indicators: Bool
    /// 要人発言の通知
    var speeches: Bool
    /// 対象通貨ペア(`fx_pairs.symbol`)。`nil`は「すべての通貨ペア」。
    var fxPairs: [String]?
    /// 通知する重要度。Backendは常に 高→中→低 の順で返す。
    var importances: [String]
    /// 発表の何分前に通知するか。0は発表時。
    var leadMinutes: Int
    /// 通知しない時間帯(HQ指示 2026-10-06)。ONの間、表示設定のタイムゾーンで
    /// 開始〜終了に届く通知はBackendが`/notifications/upcoming`から除く。
    /// 終了が開始より前なら日付をまたぐ(既定の23:00〜7:00)。
    var quietHoursEnabled: Bool = false
    /// "HH:MM"
    var quietStart: String = "23:00"
    /// "HH:MM"
    var quietEnd: String = "07:00"

    static let defaults = NotificationSettings(push: true, indicators: true, speeches: true, fxPairs: nil, importances: ["HIGH", "MEDIUM"], leadMinutes: 5)
    static let importanceOrder = ["HIGH", "MEDIUM", "LOW"]
    static let leadMinuteOptions = [0, 5, 10, 15, 30, 60]
    /// 通知しない時間帯の開始・終了の選択肢(1時間ごと)。
    static let quietTimeOptions = (0..<24).map { String(format: "%02d:00", $0) }

    enum CodingKeys: String, CodingKey {
        case push
        case indicators
        case speeches
        case fxPairs = "fx_pairs"
        case importances
        case leadMinutes = "lead_minutes"
        case quietHoursEnabled = "quiet_hours_enabled"
        case quietStart = "quiet_start"
        case quietEnd = "quiet_end"
    }

    /// `fxPairs`の`nil`(すべての通貨ペア)を明示的な`null`で送る。合成の
    /// エンコーダーはキーごと省き、PATCHでは「変更しない」になってしまう。
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(push, forKey: .push)
        try container.encode(indicators, forKey: .indicators)
        try container.encode(speeches, forKey: .speeches)
        try container.encode(fxPairs, forKey: .fxPairs)
        try container.encode(importances, forKey: .importances)
        try container.encode(leadMinutes, forKey: .leadMinutes)
        try container.encode(quietHoursEnabled, forKey: .quietHoursEnabled)
        try container.encode(quietStart, forKey: .quietStart)
        try container.encode(quietEnd, forKey: .quietEnd)
    }
}

extension NotificationSettings {
    /// 通知しない時間帯の項目が無い応答(項目追加前のBackend)は既定値で読む。
    /// 拡張に置くのは、メンバーごとの初期化子を残すため。
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            push: try container.decode(Bool.self, forKey: .push),
            indicators: try container.decode(Bool.self, forKey: .indicators),
            speeches: try container.decode(Bool.self, forKey: .speeches),
            fxPairs: try container.decodeIfPresent([String].self, forKey: .fxPairs),
            importances: try container.decode([String].self, forKey: .importances),
            leadMinutes: try container.decode(Int.self, forKey: .leadMinutes),
            quietHoursEnabled: try container.decodeIfPresent(Bool.self, forKey: .quietHoursEnabled) ?? false,
            quietStart: try container.decodeIfPresent(String.self, forKey: .quietStart) ?? "23:00",
            quietEnd: try container.decodeIfPresent(String.self, forKey: .quietEnd) ?? "07:00"
        )
    }
}

/// SCR-018 表示・地域設定(HQ指示 2026-10-06の参考画像で項目を追加)。
/// 反映先は`AppPreferences`。
struct DisplaySettings: SettingsSection {
    /// `ja` / `en`
    var language: String
    /// ISO 3166-1 alpha-2
    var region: String
    /// IANA timezone名
    var timezone: String
    /// `SYSTEM` / `DARK` / `LIGHT`
    var theme: String = "SYSTEM"
    /// `SMALL` / `STANDARD` / `LARGE`
    var textSize: String = "STANDARD"
    /// `YYYY/MM/DD` / `YYYY-MM-DD` / `MM/DD/YYYY` / `YYYY年M月D日`
    var dateFormat: String = "YYYY/MM/DD"
    /// `24H` / `12H`
    var timeFormat: String = "24H"
    /// ISO 4217
    var currency: String = "JPY"
    /// `SUNDAY` / `MONDAY`
    var weekStart: String = "MONDAY"

    static let defaults = DisplaySettings(language: "ja", region: "JP", timezone: "Asia/Tokyo")

    enum CodingKeys: String, CodingKey {
        case language, region, timezone, theme, currency
        case textSize = "text_size"
        case dateFormat = "date_format"
        case timeFormat = "time_format"
        case weekStart = "week_start"
    }
}

extension DisplaySettings {
    /// 項目追加前のBackendの応答は、追加分を既定値で読む(拡張に置くのは、
    /// メンバーごとの初期化子を残すため)。
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let fallback = DisplaySettings.defaults
        self.init(
            language: try c.decode(String.self, forKey: .language),
            region: try c.decode(String.self, forKey: .region),
            timezone: try c.decode(String.self, forKey: .timezone),
            theme: try c.decodeIfPresent(String.self, forKey: .theme) ?? fallback.theme,
            textSize: try c.decodeIfPresent(String.self, forKey: .textSize) ?? fallback.textSize,
            dateFormat: try c.decodeIfPresent(String.self, forKey: .dateFormat) ?? fallback.dateFormat,
            timeFormat: try c.decodeIfPresent(String.self, forKey: .timeFormat) ?? fallback.timeFormat,
            currency: try c.decodeIfPresent(String.self, forKey: .currency) ?? fallback.currency,
            weekStart: try c.decodeIfPresent(String.self, forKey: .weekStart) ?? fallback.weekStart
        )
    }
}

/// SCR-019 チャート設定(HQ指示 2026-10-06の参考画像で項目を追加)。
struct ChartSettings: SettingsSection {
    /// `fx_pairs.symbol`、`nil`は「指定なし」
    var defaultFxPairSymbol: String?
    /// `1m` / `5m` / `15m` / `30m` / `60m`
    var defaultTimeframe: String
    /// `CANDLE` / `LINE` / `BAR`
    var chartType: String = "CANDLE"
    /// テクニカル指標を表示(個々の指標の前提)
    var showIndicators: Bool = true
    var indicatorMA: Bool = true
    var indicatorBollinger: Bool = false
    var indicatorMACD: Bool = true
    var indicatorRSI: Bool = false
    var indicatorStochastic: Bool = false
    var crosshair: Bool = true
    var priceLine: Bool = true

    static let defaults = ChartSettings(defaultFxPairSymbol: nil, defaultTimeframe: "5m")

    enum CodingKeys: String, CodingKey {
        case defaultFxPairSymbol = "default_fx_pair_symbol"
        case defaultTimeframe = "default_timeframe"
        case chartType = "chart_type"
        case showIndicators = "show_indicators"
        case indicatorMA = "indicator_ma"
        case indicatorBollinger = "indicator_bollinger"
        case indicatorMACD = "indicator_macd"
        case indicatorRSI = "indicator_rsi"
        case indicatorStochastic = "indicator_stochastic"
        case crosshair
        case priceLine = "price_line"
    }

    /// Hand-written so `nil` is sent as an explicit JSON `null` (clears the
    /// pair). The synthesized encoder would omit the key, which PATCH
    /// treats as "leave unchanged".
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(defaultFxPairSymbol, forKey: .defaultFxPairSymbol)
        try container.encode(defaultTimeframe, forKey: .defaultTimeframe)
        try container.encode(chartType, forKey: .chartType)
        try container.encode(showIndicators, forKey: .showIndicators)
        try container.encode(indicatorMA, forKey: .indicatorMA)
        try container.encode(indicatorBollinger, forKey: .indicatorBollinger)
        try container.encode(indicatorMACD, forKey: .indicatorMACD)
        try container.encode(indicatorRSI, forKey: .indicatorRSI)
        try container.encode(indicatorStochastic, forKey: .indicatorStochastic)
        try container.encode(crosshair, forKey: .crosshair)
        try container.encode(priceLine, forKey: .priceLine)
    }
}

extension ChartSettings {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let fallback = ChartSettings.defaults
        self.init(
            defaultFxPairSymbol: try c.decodeIfPresent(String.self, forKey: .defaultFxPairSymbol),
            defaultTimeframe: try c.decode(String.self, forKey: .defaultTimeframe),
            chartType: try c.decodeIfPresent(String.self, forKey: .chartType) ?? fallback.chartType,
            showIndicators: try c.decodeIfPresent(Bool.self, forKey: .showIndicators) ?? fallback.showIndicators,
            indicatorMA: try c.decodeIfPresent(Bool.self, forKey: .indicatorMA) ?? fallback.indicatorMA,
            indicatorBollinger: try c.decodeIfPresent(Bool.self, forKey: .indicatorBollinger) ?? fallback.indicatorBollinger,
            indicatorMACD: try c.decodeIfPresent(Bool.self, forKey: .indicatorMACD) ?? fallback.indicatorMACD,
            indicatorRSI: try c.decodeIfPresent(Bool.self, forKey: .indicatorRSI) ?? fallback.indicatorRSI,
            indicatorStochastic: try c.decodeIfPresent(Bool.self, forKey: .indicatorStochastic) ?? fallback.indicatorStochastic,
            crosshair: try c.decodeIfPresent(Bool.self, forKey: .crosshair) ?? fallback.crosshair,
            priceLine: try c.decodeIfPresent(Bool.self, forKey: .priceLine) ?? fallback.priceLine
        )
    }
}

/// `PATCH /api/v1/settings` body (api-design.md §24.5): only the sections
/// present are updated (`nil` sections are omitted from the JSON).
struct SettingsUpdate: Encodable, Equatable {
    var notifications: NotificationSettings?
    var display: DisplaySettings?
    var chart: ChartSettings?
    var home: HomeSettings?
}
