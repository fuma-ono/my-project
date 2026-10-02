import SwiftUI

/// SCR-021 チャート設定(ui-screens.md v2.0 §3、api-design.md §24.4)。
///
/// 通貨ペアの一覧APIはないため、候補はBackendの`fx_pairs`シード
/// (USDJPY / EURUSD / EURJPY)と同じものを持つ。存在しない記号はBackendが
/// 422で弾く。時間足はBackendの許可値(1m〜60m)と同じ。正式なUI画像の
/// 受領前の暫定レイアウト。
struct ChartSettingsView: View {
    @StateObject private var viewModel: SettingsSectionViewModel<ChartSettings>
    @Binding var tabSelection: Int

    init(apiClient: APIClient, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: SettingsSectionViewModel<ChartSettings>(apiClient: apiClient))
        _tabSelection = tabSelection
    }

    static let fxPairs: [SettingsOption<String?>] = [
        SettingsOption(value: nil, label: "指定なし"),
        SettingsOption(value: "USDJPY", label: "USD/JPY"),
        SettingsOption(value: "EURUSD", label: "EUR/USD"),
        SettingsOption(value: "EURJPY", label: "EUR/JPY"),
    ]

    static let timeframes = [
        SettingsOption(value: "1m", label: "1分"),
        SettingsOption(value: "5m", label: "5分"),
        SettingsOption(value: "15m", label: "15分"),
        SettingsOption(value: "30m", label: "30分"),
        SettingsOption(value: "60m", label: "60分"),
    ]

    var body: some View {
        SettingsSectionScaffold(title: "チャート設定", viewModel: viewModel, tabSelection: $tabSelection, saveButtonY: 186) {
            SettingsCaption(text: "初期表示").position(x: 117, y: 74)
            SettingsFormRow(icon: "dollarsign.circle", title: "通貨ペア") {
                SettingsMenuPicker(
                    options: Self.fxPairs.including(viewModel.draft.defaultFxPairSymbol) { $0 ?? "指定なし" },
                    selection: $viewModel.draft.defaultFxPairSymbol
                )
            }
            .position(x: 117, y: 94)

            SettingsCaption(text: "時間足").position(x: 117, y: 122)
            SettingsSegmentedPicker(
                options: Self.timeframes.including(viewModel.draft.defaultTimeframe) { $0 },
                selection: $viewModel.draft.defaultTimeframe
            )
            .position(x: 117, y: 142)
        }
    }
}
