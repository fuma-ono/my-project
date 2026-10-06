import SwiftUI
import UIKit

/// SCR-016 通知設定(api-design.md §24.4)。HQ指示(2026-10-06)の参考画像
/// (見出し+項目名と右端のスイッチ・値だけの行)に合わせ、「通知の種類」
/// 「通知の条件」「通知について」を並べる(参考画像のニュース速報は不要)。保存ボタンは
/// 無く、変更はその場で保存される(`NotificationSettingsViewModel`)。
struct NotificationSettingsView: View {
    @StateObject private var viewModel: NotificationSettingsViewModel
    @Binding var tabSelection: Int
    @State private var picker: OptionPicker?
    @Environment(\.dismiss) private var dismiss

    private enum OptionPicker: String, Identifiable {
        case fxPairs, importances, timing, quietStart, quietEnd
        var id: String { rawValue }
    }

    init(apiClient: APIClient, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: NotificationSettingsViewModel(apiClient: apiClient))
        _tabSelection = tabSelection
    }

    var body: some View {
        V5Viewport {
            V5Header(title: "通知設定", back: true, onBack: { dismiss() })
            switch viewModel.loadState {
            case .loading:
                centered { LoadingView(caption: "読み込み中...") }
            case .backendNotConfigured:
                centered { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "設定はまだ利用できません。") }
            case .error(let message):
                centered { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
            case .loaded:
                // 端末の文字幅で収まらない場合もタブバーに重ならないよう、
                // ヘッダー下〜タブバー上の範囲でスクロールさせる。
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 8) {
                        kindsCard
                        conditionsCard
                        quietHoursCard
                        aboutCard
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
            case .fxPairs: fxPairSheet
            case .importances: importanceSheet
            case .timing: timingSheet
            case .quietStart:
                quietTimeSheet(title: "開始", selection: viewModel.settings.quietStart) { viewModel.setQuietStart($0) }
            case .quietEnd:
                quietTimeSheet(title: "終了", selection: viewModel.settings.quietEnd) { viewModel.setQuietEnd($0) }
            }
        }
    }

    private func centered(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
            .padding(.top, 53)
    }

    // MARK: - 通知の種類

    private var kindsCard: some View {
        SettingsListSection(title: "通知の種類") {
            SettingsListToggleRow(title: "プッシュ通知", isOn: viewModel.settings.push, onChange: { viewModel.setPush($0) })
            SettingsListSeparator()
            SettingsListToggleRow(title: "重要な経済指標の通知", isOn: viewModel.settings.indicators, onChange: { viewModel.setIndicators($0) })
                .dimmed(!viewModel.settings.push)
            SettingsListSeparator()
            SettingsListToggleRow(title: "要人発言の通知", isOn: viewModel.settings.speeches, onChange: { viewModel.setSpeeches($0) })
                .dimmed(!viewModel.settings.push)
        }
    }

    // MARK: - 通知の条件

    private var conditionsCard: some View {
        SettingsListSection(title: "通知の条件") {
            SettingsListValueRow(title: "対象通貨ペア", value: viewModel.fxPairsLabel) { picker = .fxPairs }
            SettingsListSeparator()
            SettingsListValueRow(title: "重要度", value: viewModel.importancesLabel) { picker = .importances }
            SettingsListSeparator()
            SettingsListValueRow(
                title: "通知のタイミング",
                value: NotificationSettingsViewModel.leadLabel(viewModel.settings.leadMinutes)
            ) { picker = .timing }
        }
        .dimmed(!viewModel.settings.push)
    }

    // MARK: - 通知時間帯

    /// HQ指示(2026-10-06)「通知しない時間帯 OFF / ONにした場合 開始 23:00 終了 7:00」。
    private var quietHoursCard: some View {
        SettingsListSection(title: "通知時間帯") {
            SettingsListToggleRow(title: "通知しない時間帯", isOn: viewModel.settings.quietHoursEnabled, onChange: { viewModel.setQuietHours($0) })
            if viewModel.settings.quietHoursEnabled {
                SettingsListSeparator()
                SettingsListValueRow(title: "開始", value: NotificationSettingsViewModel.timeLabel(viewModel.settings.quietStart)) { picker = .quietStart }
                SettingsListSeparator()
                SettingsListValueRow(title: "終了", value: NotificationSettingsViewModel.timeLabel(viewModel.settings.quietEnd)) { picker = .quietEnd }
            }
        }
        .dimmed(!viewModel.settings.push)
    }

    // MARK: - 通知について

    private var aboutCard: some View {
        VStack(spacing: 3) {
            AccountInfoCard(
                icon: "info.circle.fill",
                title: "通知について",
                text: "選択した通貨ペア・重要度・タイミングの条件で配信されます。端末の通知設定もご確認ください。",
                // HQ指示(2026-10-06)で指定した大きさ。
                textSize: NotificationLayout.aboutTextSize
            )
            statusLine
                .frame(width: 214, height: 12)
        }
    }

    @ViewBuilder private var statusLine: some View {
        if viewModel.authorizationDenied {
            Button {
                if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            } label: {
                NotoText.text("端末の通知がオフです。タップして設定を開く", size: 6.5)
                    .foregroundStyle(V5P.yellow)
                    .underline()
            }
            .buttonStyle(.plain)
        } else {
            switch viewModel.saveState {
            case .error(let message): NotoText.text(message, size: 6.5).foregroundStyle(V5P.red)
            // 保存できたときは何も出さない(HQ指示 2026-10-06)。失敗だけ知らせる。
            case .idle, .saving, .saved: EmptyView()
            }
        }
    }

    // MARK: - 選択シート

    private var fxPairSheet: some View {
        let selected = viewModel.settings.fxPairs
        return SettingsListOptionSheet(title: "対象通貨ペア", footer: "選択しない場合は、すべての通貨ペアが対象になります。") {
            SettingsListOptionRow(label: "すべての通貨ペア", isSelected: selected == nil) {
                viewModel.setFxPairs(nil)
            }
            ForEach(viewModel.fxPairSymbols, id: \.self) { symbol in
                SettingsListOptionRow(label: FXPairSymbol.displayName(symbol), isSelected: selected?.contains(symbol) == true) {
                    var next = selected ?? []
                    if let index = next.firstIndex(of: symbol) { next.remove(at: index) } else { next.append(symbol) }
                    viewModel.setFxPairs(next)
                }
            }
        }
    }

    private var importanceSheet: some View {
        SettingsListOptionSheet(title: "重要度", footer: "1つ以上選択してください。") {
            ForEach(NotificationSettings.importanceOrder, id: \.self) { importance in
                SettingsListOptionRow(
                    label: NotificationImportance.label(importance),
                    isSelected: viewModel.settings.importances.contains(importance)
                ) { viewModel.toggleImportance(importance) }
            }
        }
    }

    private func quietTimeSheet(title: String, selection: String, onSelect: @escaping (String) -> Void) -> some View {
        SettingsListOptionSheet(title: title, footer: "開始から終了までの間は通知しません。") {
            ForEach(NotificationSettings.quietTimeOptions, id: \.self) { time in
                SettingsListOptionRow(label: NotificationSettingsViewModel.timeLabel(time), isSelected: selection == time) {
                    onSelect(time)
                    picker = nil
                }
            }
        }
    }

    private var timingSheet: some View {
        SettingsListOptionSheet(title: "通知のタイミング", footer: nil) {
            ForEach(NotificationSettings.leadMinuteOptions, id: \.self) { minutes in
                SettingsListOptionRow(
                    label: NotificationSettingsViewModel.leadLabel(minutes),
                    isSelected: viewModel.settings.leadMinutes == minutes
                ) {
                    viewModel.setLeadMinutes(minutes)
                    picker = nil
                }
            }
        }
    }
}

private enum NotificationLayout {
    static let aboutTextSize: CGFloat = 7.5
}
