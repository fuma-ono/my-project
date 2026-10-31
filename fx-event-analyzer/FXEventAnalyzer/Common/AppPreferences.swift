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
        // 文字サイズの倍率(HQ指示 2026-10-15)。画面は RootView が作り直して反映する。
        NotoText.scale = NotoText.scale(forTextSize: settings.display.textSize)
        display = settings.display
        chart = settings.chart
    }

    /// ログアウト・セッション切れで、前のユーザーの設定を残さない。
    func reset() {
        NotoText.scale = 1
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
        // 2026-10-15「日付・時刻の表示形式を全画面にそろえる」: 24時間は一覧と同じ2桁(06:30)。
        Self.format(date, pattern: display.timeFormat == "12H" ? "ah:mm" : "HH:mm", timeZone: timeZone)
    }

    /// `timeString(_:)`と同じだが、`precision`が`.approximate`(Eurostat等、
    /// HQ指示 2026-10-30「APPROXIMATEの時刻が正確な時刻と誤認されない表示」)
    /// のときだけ「約」を前に付ける。`.exact`は`timeString(_:)`と完全に同じ
    /// (接頭辞なし)。`.dateOnly`・`.unknown`・nilも既存どおり接頭辞なし(この
    /// 2つは呼び出し側で時刻自体を出さない判断をしている場合が多く、ここでは
    /// 挙動を変えない)。カレンダー・ホーム・イベント詳細で同じイベントの
    /// 時刻表記が食い違わないよう、この1箇所だけに「約」を付ける判断を集約する。
    func timeString(_ date: Date, precision: ReleaseDatetimePrecision?) -> String {
        let base = timeString(date)
        return precision == .approximate ? "約\(base)" : base
    }

    /// カレンダー・ホームの時刻列(28pt/26ptの固定幅で、すぐ右に国旗アイコンが
    /// 続く詰まった列)専用。`timeString(_:precision:)`と同じ文言だが、
    /// 「約」をそのまま時刻と同じ大きさで前置すると、実機確認(2026-10-30)で
    /// 「約08:50」が国旗アイコンと重なって見切れることが判明した。「約」
    /// だけ`approximatePrefixSize`で縮小し、時刻の桁(`timeFontSize`)自体は
    /// 変えない(EXACTの見た目・サイズは一切変わらない)。EventDetailは
    /// この列より余裕があり重ならないため、引き続き`timeString(_:precision:)`
    /// の文字列をそのまま使う(ここは使わない)。
    func timeText(_ date: Date, precision: ReleaseDatetimePrecision?, timeFontSize: CGFloat, approximatePrefixSize: CGFloat) -> Text {
        let time = Text(timeString(date)).font(.system(size: timeFontSize, weight: .bold))
        guard precision == .approximate else { return time }
        return Text("約").font(.system(size: approximatePrefixSize, weight: .bold)) + time
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
