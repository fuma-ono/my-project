import SwiftUI

/// SCR-020 表示・地域設定(ui-screens.md v2.0 §3、api-design.md §24.4)。
///
/// 言語は`ja`/`en`の2択(Backendの許可値と同じ)。地域・タイムゾーンは主要
/// 市場の候補から選ぶ。Backendに候補外の値が保存されていても、そのまま
/// 表示・保持する(`including`)。正式なUI画像の受領前の暫定レイアウト。
struct DisplaySettingsView: View {
    @StateObject private var viewModel: SettingsSectionViewModel<DisplaySettings>
    @Binding var tabSelection: Int

    init(apiClient: APIClient, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: SettingsSectionViewModel<DisplaySettings>(apiClient: apiClient))
        _tabSelection = tabSelection
    }

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

    /// IANA timezone名
    static let timezones = [
        SettingsOption(value: "Asia/Tokyo", label: "東京 (Asia/Tokyo)"),
        SettingsOption(value: "America/New_York", label: "ニューヨーク (America/New_York)"),
        SettingsOption(value: "Europe/London", label: "ロンドン (Europe/London)"),
        SettingsOption(value: "Australia/Sydney", label: "シドニー (Australia/Sydney)"),
        SettingsOption(value: "Asia/Singapore", label: "シンガポール (Asia/Singapore)"),
        SettingsOption(value: "UTC", label: "UTC"),
    ]

    var body: some View {
        SettingsSectionScaffold(title: "表示・地域設定", viewModel: viewModel, tabSelection: $tabSelection, saveButtonY: 220) {
            SettingsCaption(text: "表示言語").position(x: 117, y: 74)
            SettingsSegmentedPicker(
                options: Self.languages.including(viewModel.draft.language) { $0 },
                selection: $viewModel.draft.language
            )
            .position(x: 117, y: 94)

            SettingsCaption(text: "地域・タイムゾーン").position(x: 117, y: 122)
            SettingsFormRow(icon: "globe", title: "地域") {
                SettingsMenuPicker(options: Self.regions.including(viewModel.draft.region) { $0 }, selection: $viewModel.draft.region)
            }
            .position(x: 117, y: 142)
            SettingsFormRow(icon: "clock", title: "タイムゾーン") {
                SettingsMenuPicker(options: Self.timezones.including(viewModel.draft.timezone) { $0 }, selection: $viewModel.draft.timezone)
            }
            .position(x: 117, y: 176)
        }
    }
}
