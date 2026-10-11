import SwiftUI

/// SCR-018 表示・地域設定(api-design.md §24.4)。HQ指示(2026-10-06)の参考画像
/// (「アプリの表示設定」「地域・言語設定」の2つのまとまり)に合わせた。保存
/// ボタンは無く、変えるとその場で保存し`AppPreferences`へ反映する。
struct DisplaySettingsView: View {
    @StateObject private var viewModel: SettingsSectionViewModel<DisplaySettings>
    @Binding var tabSelection: Int
    @State private var picker: OptionPicker?
    @Environment(\.dismiss) private var dismiss

    private enum OptionPicker: String, Identifiable {
        case theme, textSize, dateFormat, timeFormat, language, region, timezone, currency, weekStart
        var id: String { rawValue }
    }

    init(apiClient: APIClient, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: SettingsSectionViewModel<DisplaySettings>(apiClient: apiClient))
        _tabSelection = tabSelection
    }

    // MARK: - 選択肢

    static let themes = [
        SettingsOption(value: "SYSTEM", label: "システム設定に従う"),
        SettingsOption(value: "DARK", label: "ダーク"),
        SettingsOption(value: "LIGHT", label: "ライト"),
    ]

    static let textSizes = [
        SettingsOption(value: "SMALL", label: "小"),
        SettingsOption(value: "STANDARD", label: "標準"),
        SettingsOption(value: "LARGE", label: "大"),
    ]

    /// 表示は参考画像と同じく、2024年4月1日の見え方で出す。
    static let dateFormats = ["YYYY/MM/DD", "YYYY-MM-DD", "MM/DD/YYYY", "YYYY年M月D日"].map { format in
        SettingsOption(value: format, label: AppPreferences.format(sampleDate, pattern: AppPreferences.datePattern(format, withYear: true), timeZone: TimeZone(identifier: "UTC")!))
    }
    private static let sampleDate = Date(timeIntervalSince1970: 1_711_929_600) // 2024-04-01T00:00:00Z

    static let timeFormats = [
        SettingsOption(value: "24H", label: "24時間表示"),
        SettingsOption(value: "12H", label: "12時間表示"),
    ]

    static let languages = [
        SettingsOption(value: "ja", label: "日本語"),
        SettingsOption(value: "en", label: "English"),
    ]

    /// ISO 3166-1 alpha-2
    static let regions = [
        SettingsOption(value: "JP", label: "日本"),
        SettingsOption(value: "US", label: "アメリカ"),
        SettingsOption(value: "GB", label: "イギリス"),
        SettingsOption(value: "AU", label: "オーストラリア"),
        SettingsOption(value: "SG", label: "シンガポール"),
    ]

    /// IANA timezone名。表示は参考画像の「(UTC+9) 東京」。
    static let timezones = AppPreferences.timeZones.map { SettingsOption(value: $0.id, label: AppPreferences.timeZoneLabel($0.id)) }

    static let currencies = [
        SettingsOption(value: "JPY", label: "JPY（日本円）"),
        SettingsOption(value: "USD", label: "USD（米ドル）"),
        SettingsOption(value: "EUR", label: "EUR（ユーロ）"),
        SettingsOption(value: "GBP", label: "GBP（英ポンド）"),
        SettingsOption(value: "AUD", label: "AUD（豪ドル）"),
        SettingsOption(value: "CAD", label: "CAD（カナダドル）"),
        SettingsOption(value: "CHF", label: "CHF（スイスフラン）"),
        SettingsOption(value: "NZD", label: "NZD（NZドル）"),
    ]

    static let weekStarts = [
        SettingsOption(value: "SUNDAY", label: "日曜日"),
        SettingsOption(value: "MONDAY", label: "月曜日"),
    ]

    // MARK: - 画面

    var body: some View {
        V5Viewport {
            V5Header(title: "表示・地域設定", back: true, onBack: { dismiss() })
            switch viewModel.loadState {
            case .loading:
                centered { LoadingView(caption: "読み込み中...") }
            case .backendNotConfigured:
                centered { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "設定はまだ利用できません。") }
            case .error(let message):
                centered { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
            case .loaded:
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 8) {
                        SettingsListSection(title: "アプリの表示設定") {
                            row("テーマ", Self.themes, \.theme, .theme)
                            SettingsListSeparator()
                            row("文字サイズ", Self.textSizes, \.textSize, .textSize)
                            SettingsListSeparator()
                            row("日付の表示形式", Self.dateFormats, \.dateFormat, .dateFormat)
                            SettingsListSeparator()
                            row("時刻の表示形式", Self.timeFormats, \.timeFormat, .timeFormat)
                        }
                        SettingsListSection(title: "地域・言語設定") {
                            row("言語", Self.languages, \.language, .language)
                            SettingsListSeparator()
                            row("国・地域", Self.regions, \.region, .region)
                            SettingsListSeparator()
                            row("タイムゾーン", Self.timezones, \.timezone, .timezone)
                            SettingsListSeparator()
                            row("通貨", Self.currencies, \.currency, .currency)
                            SettingsListSeparator()
                            row("週の開始曜日", Self.weekStarts, \.weekStart, .weekStart)
                        }
                        SettingsSaveError(state: viewModel.saveState)
                    }
                    .padding(.top, 4)
                    .frame(width: V5P.W)
                }
                .frame(width: V5P.W, height: 398)
                .position(x: V5P.W / 2, y: 54 + 398 / 2)
            }
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { viewModel.load() }
        .sheet(item: $picker) { picker in
            switch picker {
            case .theme: sheet("テーマ", Self.themes, \.theme)
            case .textSize: sheet("文字サイズ", Self.textSizes, \.textSize, footer: "シートや確認画面など、iOS標準の部品の文字の大きさに反映されます。")
            case .dateFormat: sheet("日付の表示形式", Self.dateFormats, \.dateFormat)
            case .timeFormat: sheet("時刻の表示形式", Self.timeFormats, \.timeFormat)
            case .language: sheet("言語", Self.languages, \.language)
            case .region: sheet("国・地域", Self.regions, \.region)
            case .timezone: sheet("タイムゾーン", Self.timezones, \.timezone, footer: "発表時刻などをこのタイムゾーンで表示します。")
            case .currency: sheet("通貨", Self.currencies, \.currency)
            case .weekStart: sheet("週の開始曜日", Self.weekStarts, \.weekStart)
            }
        }
    }

    private func centered(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
            .padding(.top, 53)
    }

    private func row(_ title: String, _ options: [SettingsOption<String>], _ key: WritableKeyPath<DisplaySettings, String>, _ target: OptionPicker) -> some View {
        let current = viewModel.draft[keyPath: key]
        let label = options.first { $0.value == current }?.label ?? current
        return SettingsListValueRow(title: title, value: label) { picker = target }
    }

    private func sheet(_ title: String, _ options: [SettingsOption<String>], _ key: WritableKeyPath<DisplaySettings, String>, footer: String? = nil) -> some View {
        SettingsListOptionSheet(title: title, footer: footer) {
            ForEach(options.including(viewModel.draft[keyPath: key]) { $0 }) { option in
                SettingsListOptionRow(label: option.label, isSelected: viewModel.draft[keyPath: key] == option.value) {
                    viewModel.update { $0[keyPath: key] = option.value }
                    picker = nil
                }
            }
        }
    }
}

/// 自動保存に失敗したときだけ出す一言(保存できたときは何も出さない)。
struct SettingsSaveError: View {
    let state: SettingsSectionSaveState

    var body: some View {
        if case .error(let message) = state {
            NotoText.text(message, size: 7)
                .foregroundStyle(V5P.red)
                .frame(width: 214)
        }
    }
}
