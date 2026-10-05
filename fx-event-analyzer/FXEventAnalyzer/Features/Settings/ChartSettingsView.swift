import SwiftUI

/// SCR-019 チャート設定(ui-screens.md v2.0 §3、api-design.md §24.4)。
///
/// 通貨ペアの候補は`FXPairCatalog`から取得する。通貨ペア一覧APIがまだない
/// ため、現状はBackendの`fx_pairs`シードと同じ固定値(`StaticFXPairCatalog`)で、
/// API追加時はカタログの実装を差し替えるだけでこの画面は変更不要。存在しない
/// 記号はBackendが422で弾く。時間足はBackendの許可値(1m〜60m)と同じ。
/// 正式なUI画像の受領前の暫定レイアウト。
struct ChartSettingsView: View {
    @StateObject private var viewModel: SettingsSectionViewModel<ChartSettings>
    @Binding var tabSelection: Int
    private let fxPairCatalog: FXPairCatalog
    @State private var fxPairSymbols: [String] = []

    init(apiClient: APIClient, tabSelection: Binding<Int>, fxPairCatalog: FXPairCatalog = StaticFXPairCatalog()) {
        _viewModel = StateObject(wrappedValue: SettingsSectionViewModel<ChartSettings>(apiClient: apiClient))
        _tabSelection = tabSelection
        self.fxPairCatalog = fxPairCatalog
    }

    /// 先頭に「指定なし」(`nil`)を置いた通貨ペアの選択肢。保存済みの値が
    /// 候補にない場合も`including`で残すため、候補の取得に失敗しても現在値は
    /// 失われない。
    static func fxPairOptions(symbols: [String], current: String?) -> [SettingsOption<String?>] {
        let options = [SettingsOption<String?>(value: nil, label: "指定なし")]
            + symbols.map { SettingsOption<String?>(value: $0, label: FXPairSymbol.displayName($0)) }
        return options.including(current) { $0.map(FXPairSymbol.displayName) ?? "指定なし" }
    }

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
                    options: Self.fxPairOptions(symbols: fxPairSymbols, current: viewModel.draft.defaultFxPairSymbol),
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
        .task {
            fxPairSymbols = (try? await fxPairCatalog.availableSymbols()) ?? []
        }
    }
}
