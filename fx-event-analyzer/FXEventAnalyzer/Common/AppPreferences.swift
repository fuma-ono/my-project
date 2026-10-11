import SwiftUI

/// SCR-018 表示・地域設定 / SCR-019 チャート設定の保存値を、アプリの表示に
/// 反映するための窓口(HQ指示 2026-10-06「機能も作成して」)。ログイン後に
/// `GET /settings`で読み込み、設定画面で保存するたびに更新する。
///
/// 今反映しているもの: 文字サイズ(iOS標準の部品=シート・確認画面など。V5の
/// 画面は固定キャンバスの寸法のまま)、日付・時刻の表示形式とタイムゾーン
/// (通知一覧・プラン・購読管理)。テーマは`MainTabView`がダーク固定のため保存
/// のみ(`colorScheme`はライト用デザインの用意後に使う)。週の開始曜日・通貨・
/// 言語とチャートの項目も保存のみで、カレンダー・チャート画面の実装時に読む。
@MainActor
final class AppPreferences: ObservableObject {
    static let shared = AppPreferences()

    @Published private(set) var display: DisplaySettings = .defaults
    @Published private(set) var chart: ChartSettings = .defaults

    func apply(_ settings: SettingsResponse) {
        display = settings.display
        chart = settings.chart
    }

    /// ログアウト・セッション切れで、前のユーザーの設定を残さない。
    func reset() {
        display = .defaults
        chart = .defaults
    }

    func load(apiClient: APIClient) async {
        if let settings = try? await SettingsService(apiClient: apiClient).fetchSettings() {
            apply(settings)
        }
    }

    // MARK: - テーマ・文字サイズ

    var colorScheme: ColorScheme? { Self.colorScheme(display.theme) }
    var dynamicTypeSize: DynamicTypeSize { Self.dynamicTypeSize(display.textSize) }

    nonisolated static func colorScheme(_ theme: String) -> ColorScheme? {
        switch theme {
        case "DARK": return .dark
        case "LIGHT": return .light
        default: return nil
        }
    }

    nonisolated static func dynamicTypeSize(_ textSize: String) -> DynamicTypeSize {
        switch textSize {
        case "SMALL": return .medium
        case "LARGE": return .xLarge
        default: return .large
        }
    }

    // MARK: - 日付・時刻

    var timeZone: TimeZone { TimeZone(identifier: display.timezone) ?? .current }

    /// 週の開始曜日を反映した暦(カレンダー画面用)。
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.firstWeekday = display.weekStart == "SUNDAY" ? 1 : 2
        return calendar
    }

    /// 「2026/10/06」など(表示形式どおり)。
    func dateString(_ date: Date) -> String {
        Self.format(date, pattern: Self.datePattern(display.dateFormat, withYear: true), timeZone: timeZone)
    }

    /// 年を省いた「10/06」など(一覧の受信日時など)。
    func shortDateString(_ date: Date) -> String {
        Self.format(date, pattern: Self.datePattern(display.dateFormat, withYear: false), timeZone: timeZone)
    }

    /// 「15:12」/「午後3:12」。
    func timeString(_ date: Date) -> String {
        Self.format(date, pattern: display.timeFormat == "12H" ? "ah:mm" : "H:mm", timeZone: timeZone)
    }

    /// 「（日本時間）」「（ニューヨーク時間）」。
    var timeZoneNote: String { "（\(Self.cityName(display.timezone))時間）" }

    nonisolated static func datePattern(_ format: String, withYear: Bool) -> String {
        switch format {
        case "YYYY-MM-DD": return withYear ? "yyyy-MM-dd" : "MM-dd"
        case "MM/DD/YYYY": return withYear ? "MM/dd/yyyy" : "MM/dd"
        case "YYYY年M月D日": return withYear ? "yyyy年M月d日" : "M月d日"
        default: return withYear ? "yyyy/MM/dd" : "MM/dd"
        }
    }

    nonisolated static func format(_ date: Date, pattern: String, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = timeZone
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }

    /// 表示・地域設定のタイムゾーンの候補と、その都市名。
    nonisolated static let timeZones: [(id: String, city: String)] = [
        ("Asia/Tokyo", "東京"),
        ("Asia/Singapore", "シンガポール"),
        ("Australia/Sydney", "シドニー"),
        ("Europe/London", "ロンドン"),
        ("Europe/Berlin", "フランクフルト"),
        ("America/New_York", "ニューヨーク"),
        ("UTC", "UTC"),
    ]

    nonisolated static func cityName(_ identifier: String) -> String {
        if identifier == "Asia/Tokyo" { return "日本" }
        return timeZones.first { $0.id == identifier }?.city ?? identifier
    }

    /// 「(UTC+9) 東京」(参考画像の表記)。オフセットは今日の時点の値(夏時間を含む)。
    nonisolated static func timeZoneLabel(_ identifier: String, now: Date = Date()) -> String {
        let zone = TimeZone(identifier: identifier) ?? .current
        let seconds = zone.secondsFromGMT(for: now)
        let hours = seconds / 3600
        let minutes = abs(seconds % 3600) / 60
        let offset = minutes == 0 ? String(format: "%+d", hours) : String(format: "%+d:%02d", hours, minutes)
        let city = timeZones.first { $0.id == identifier }?.city ?? identifier
        return identifier == "UTC" ? "(UTC)" : "(UTC\(offset)) \(city)"
    }
}
