import SwiftUI

/// SCR-019 チャート設定(api-design.md §24.4)。HQ指示(2026-10-06)の参考画像
/// (「チャートの基本設定」「テクニカル指標の設定」「チャートの表示設定」)に
/// 合わせた。保存ボタンは無く、変えるとその場で保存する。参考画像に無い
/// 「デフォルトの通貨ペア」も、既存の設定項目なので基本設定の先頭に残している。
///
/// 通貨ペアの候補は`FXPairCatalog`から取得する。存在しない記号はBackendが422で弾く。
struct ChartSettingsView: View {
    @StateObject private var viewModel: SettingsSectionViewModel<ChartSettings>
    @Binding var tabSelection: Int
    private let fxPairCatalog: FXPairCatalog
    @State private var fxPairSymbols: [String] = []
    @State private var picker: OptionPicker?
    @Environment(\.dismiss) private var dismiss

    private enum OptionPicker: String, Identifiable {
        case fxPair, timeframe, chartType
        var id: String { rawValue }
    }

    init(apiClient: APIClient, tabSelection: Binding<Int>, fxPairCatalog: FXPairCatalog? = nil) {
        _viewModel = StateObject(wrappedValue: SettingsSectionViewModel<ChartSettings>(apiClient: apiClient))
        _tabSelection = tabSelection
        self.fxPairCatalog = fxPairCatalog ?? RemoteFXPairCatalog(apiClient: apiClient)
    }

    // MARK: - 選択肢

    /// 先頭に「指定なし」(`nil`)を置いた通貨ペアの選択肢。保存済みの値が
    /// 候補にない場合も`including`で残すため、候補の取得に失敗しても現在値は
    /// 失われない。
    static func fxPairOptions(symbols: [String], current: String?) -> [SettingsOption<String?>] {
        let options = [SettingsOption<String?>(value: nil, label: "指定なし")]
            + symbols.map { SettingsOption<String?>(value: $0, label: FXPairSymbol.displayName($0)) }
        return options.including(current) { $0.map(FXPairSymbol.displayName) ?? "指定なし" }
    }

    static let timeframes = [
        SettingsOption(value: "1m", label: "1分足"),
        SettingsOption(value: "5m", label: "5分足"),
        SettingsOption(value: "15m", label: "15分足"),
        SettingsOption(value: "30m", label: "30分足"),
        SettingsOption(value: "60m", label: "1時間足"),
    ]

    static let chartTypes = [
        SettingsOption(value: "CANDLE", label: "ローソク足"),
        SettingsOption(value: "LINE", label: "ライン"),
        SettingsOption(value: "BAR", label: "バー"),
    ]

    // MARK: - 画面

    var body: some View {
        V5Viewport {
            V5Header(title: "チャート設定", back: true, onBack: { dismiss() })
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
                        basicSection
                        indicatorSection
                        displaySection
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
        .task {
            viewModel.load()
            fxPairSymbols = (try? await fxPairCatalog.availableSymbols()) ?? []
        }
        .sheet(item: $picker) { picker in
            switch picker {
            case .fxPair: fxPairSheet
            case .timeframe: optionSheet("デフォルトの時間足", Self.timeframes, \.defaultTimeframe)
            case .chartType: optionSheet("デフォルトのチャートタイプ", Self.chartTypes, \.chartType)
            }
        }
    }

    private func centered(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
            .padding(.top, 53)
    }

    private var settings: ChartSettings { viewModel.draft }

    private var basicSection: some View {
        SettingsListSection(title: "チャートの基本設定") {
            SettingsListValueRow(
                title: "デフォルトの通貨ペア",
                value: settings.defaultFxPairSymbol.map(FXPairSymbol.displayName) ?? "指定なし"
            ) { picker = .fxPair }
            SettingsListSeparator()
            SettingsListValueRow(title: "デフォルトの時間足", value: label(Self.timeframes, settings.defaultTimeframe)) { picker = .timeframe }
            SettingsListSeparator()
            SettingsListValueRow(title: "デフォルトのチャートタイプ", value: label(Self.chartTypes, settings.chartType)) { picker = .chartType }
            SettingsListSeparator()
            toggle("テクニカル指標を表示", \.showIndicators)
        }
    }

    private var indicatorSection: some View {
        SettingsListSection(title: "テクニカル指標の設定") {
            toggle("移動平均線（MA）", \.indicatorMA)
            SettingsListSeparator()
            toggle("ボリンジャーバンド", \.indicatorBollinger)
            SettingsListSeparator()
            toggle("MACD", \.indicatorMACD)
            SettingsListSeparator()
            toggle("RSI", \.indicatorRSI)
            SettingsListSeparator()
            toggle("ストキャスティクス", \.indicatorStochastic)
        }
        // 「テクニカル指標を表示」がオフの間は、個々の指標は選べない。
        .dimmed(!settings.showIndicators)
    }

    private var displaySection: some View {
        SettingsListSection(title: "チャートの表示設定") {
            toggle("クロスヘア", \.crosshair)
            SettingsListSeparator()
            toggle("価格ライン", \.priceLine)
        }
    }

    private func toggle(_ title: String, _ key: WritableKeyPath<ChartSettings, Bool>) -> some View {
        SettingsListToggleRow(title: title, isOn: settings[keyPath: key]) { isOn in
            viewModel.update { $0[keyPath: key] = isOn }
        }
    }

    private func label(_ options: [SettingsOption<String>], _ value: String) -> String {
        options.first { $0.value == value }?.label ?? value
    }

    private var fxPairSheet: some View {
        SettingsListOptionSheet(title: "デフォルトの通貨ペア", footer: nil) {
            ForEach(Self.fxPairOptions(symbols: fxPairSymbols, current: settings.defaultFxPairSymbol)) { option in
                SettingsListOptionRow(label: option.label, isSelected: settings.defaultFxPairSymbol == option.value) {
                    viewModel.update { $0.defaultFxPairSymbol = option.value }
                    picker = nil
                }
            }
        }
    }

    private func optionSheet(_ title: String, _ options: [SettingsOption<String>], _ key: WritableKeyPath<ChartSettings, String>) -> some View {
        SettingsListOptionSheet(title: title, footer: nil) {
            ForEach(options.including(settings[keyPath: key]) { $0 }) { option in
                SettingsListOptionRow(label: option.label, isSelected: settings[keyPath: key] == option.value) {
                    viewModel.update { $0[keyPath: key] = option.value }
                    picker = nil
                }
            }
        }
    }
}
