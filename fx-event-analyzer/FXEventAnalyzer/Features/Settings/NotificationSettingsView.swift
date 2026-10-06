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
        NotificationSection(title: "通知の種類") {
            NotificationToggleRow(title: "プッシュ通知", isOn: viewModel.settings.push, onChange: { viewModel.setPush($0) })
            NotificationSeparator()
            NotificationToggleRow(title: "重要な経済指標の通知", isOn: viewModel.settings.indicators, onChange: { viewModel.setIndicators($0) })
                .dimmed(!viewModel.settings.push)
            NotificationSeparator()
            NotificationToggleRow(title: "要人発言の通知", isOn: viewModel.settings.speeches, onChange: { viewModel.setSpeeches($0) })
                .dimmed(!viewModel.settings.push)
        }
    }

    // MARK: - 通知の条件

    private var conditionsCard: some View {
        NotificationSection(title: "通知の条件") {
            NotificationValueRow(title: "対象通貨ペア", value: viewModel.fxPairsLabel) { picker = .fxPairs }
            NotificationSeparator()
            NotificationValueRow(title: "重要度", value: viewModel.importancesLabel) { picker = .importances }
            NotificationSeparator()
            NotificationValueRow(
                title: "通知のタイミング",
                value: NotificationSettingsViewModel.leadLabel(viewModel.settings.leadMinutes)
            ) { picker = .timing }
        }
        .dimmed(!viewModel.settings.push)
    }

    // MARK: - 通知時間帯

    /// HQ指示(2026-10-06)「通知しない時間帯 OFF / ONにした場合 開始 23:00 終了 7:00」。
    private var quietHoursCard: some View {
        NotificationSection(title: "通知時間帯") {
            NotificationToggleRow(title: "通知しない時間帯", isOn: viewModel.settings.quietHoursEnabled, onChange: { viewModel.setQuietHours($0) })
            if viewModel.settings.quietHoursEnabled {
                NotificationSeparator()
                NotificationValueRow(title: "開始", value: NotificationSettingsViewModel.timeLabel(viewModel.settings.quietStart)) { picker = .quietStart }
                NotificationSeparator()
                NotificationValueRow(title: "終了", value: NotificationSettingsViewModel.timeLabel(viewModel.settings.quietEnd)) { picker = .quietEnd }
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
                V5JPFont.text("端末の通知がオフです。タップして設定を開く", size: 6.5, weight: .regular)
                    .foregroundStyle(V5P.yellow)
                    .underline()
            }
            .buttonStyle(.plain)
        } else {
            switch viewModel.saveState {
            case .saved: V5JPFont.text("保存しました", size: 6.5, weight: .regular).foregroundStyle(V5P.green)
            case .error(let message): V5JPFont.text(message, size: 6.5, weight: .regular).foregroundStyle(V5P.red)
            case .idle, .saving: EmptyView()
            }
        }
    }

    // MARK: - 選択シート

    private var fxPairSheet: some View {
        let selected = viewModel.settings.fxPairs
        return NotificationOptionSheet(title: "対象通貨ペア", footer: "選択しない場合は、すべての通貨ペアが対象になります。") {
            NotificationOptionRow(label: "すべての通貨ペア", isSelected: selected == nil) {
                viewModel.setFxPairs(nil)
            }
            ForEach(viewModel.fxPairSymbols, id: \.self) { symbol in
                NotificationOptionRow(label: FXPairSymbol.displayName(symbol), isSelected: selected?.contains(symbol) == true) {
                    var next = selected ?? []
                    if let index = next.firstIndex(of: symbol) { next.remove(at: index) } else { next.append(symbol) }
                    viewModel.setFxPairs(next)
                }
            }
        }
    }

    private var importanceSheet: some View {
        NotificationOptionSheet(title: "重要度", footer: "1つ以上選択してください。") {
            ForEach(NotificationSettings.importanceOrder, id: \.self) { importance in
                NotificationOptionRow(
                    label: NotificationImportance.label(importance),
                    isSelected: viewModel.settings.importances.contains(importance)
                ) { viewModel.toggleImportance(importance) }
            }
        }
    }

    private func quietTimeSheet(title: String, selection: String, onSelect: @escaping (String) -> Void) -> some View {
        NotificationOptionSheet(title: title, footer: "開始から終了までの間は通知しません。") {
            ForEach(NotificationSettings.quietTimeOptions, id: \.self) { time in
                NotificationOptionRow(label: NotificationSettingsViewModel.timeLabel(time), isSelected: selection == time) {
                    onSelect(time)
                    picker = nil
                }
            }
        }
    }

    private var timingSheet: some View {
        NotificationOptionSheet(title: "通知のタイミング", footer: nil) {
            ForEach(NotificationSettings.leadMinuteOptions, id: \.self) { minutes in
                NotificationOptionRow(
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

// MARK: - 部品

/// HQ指示(2026-10-06)の参考画像: 見出しはカードの外に文字だけで置き、
/// カードの中は項目名と右端のスイッチ・値だけの行を並べる。
private enum NotificationLayout {
    static let width: CGFloat = 214
    static let sectionTitleSize: CGFloat = 8.5
    static let rowTitleSize: CGFloat = 8.5
    static let valueSize: CGFloat = 8
    /// 通知しない時間帯をONにしても1画面に収まる高さ(HQ指示 2026-10-06)。
    static let rowHeight: CGFloat = 24
    static let aboutTextSize: CGFloat = 7.5
}

/// カードの上に見出しを置いたまとまり。
private struct NotificationSection<Rows: View>: View {
    let title: String
    @ViewBuilder let rows: () -> Rows

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            V5JPFont.text(title, size: NotificationLayout.sectionTitleSize, weight: .bold)
                .foregroundStyle(.white)
                .padding(.leading, 4)
            VStack(spacing: 0) { rows() }
                .frame(width: NotificationLayout.width)
                .background(AccountCardBackground())
        }
        .frame(width: NotificationLayout.width, alignment: .leading)
    }
}

private struct NotificationSeparator: View {
    var body: some View {
        Rectangle().fill(SettingsCardStyle.separator).frame(height: 0.6).padding(.horizontal, 8)
    }
}

/// ON/OFFの行。標準Toggleは固定キャンバスに対して大きすぎるため、V5の
/// 寸法でスイッチを描き、VoiceOverには切り替えスイッチとして見せる。
private struct NotificationToggleRow: View {
    let title: String
    let isOn: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        Button { onChange(!isOn) } label: {
            HStack(spacing: 6) {
                V5JPFont.text(title, size: NotificationLayout.rowTitleSize, weight: .medium).foregroundStyle(.white)
                Spacer(minLength: 4)
                Capsule()
                    .fill(isOn ? V5P.blue : V5P.panel2)
                    .overlay(Capsule().stroke(isOn ? V5P.blue : V5P.line, lineWidth: 0.5))
                    .frame(width: 25, height: 13)
                    .overlay(alignment: isOn ? .trailing : .leading) {
                        Circle().fill(.white).frame(width: 11, height: 11).padding(1)
                    }
                    .animation(.easeInOut(duration: 0.15), value: isOn)
            }
            .padding(.horizontal, 10)
            .frame(height: NotificationLayout.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(isOn ? "オン" : "オフ")
        .accessibilityAddTraits(.isToggle)
    }
}

/// 現在の値とシェブロンを右端に出し、タップで選択シートを開く行。
private struct NotificationValueRow: View {
    let title: String
    let value: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                V5JPFont.text(title, size: NotificationLayout.rowTitleSize, weight: .medium).foregroundStyle(.white)
                    .layoutPriority(1)
                Spacer(minLength: 4)
                // 「23:00」などの数字も日本語の値と同じ大きさに見えるよう、
                // 全体をNoto Sans JPで組む(HQ指示 2026-10-06)。
                NotoText.text(value, size: NotificationLayout.valueSize)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 7.5, weight: .semibold))
                    .foregroundStyle(SettingsCardStyle.chevronColor)
            }
            .padding(.horizontal, 10)
            .frame(height: NotificationLayout.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(value)
        .accessibilityAddTraits(.isButton)
    }
}

private extension View {
    /// プッシュ通知がオフの間は、他の項目を薄くして操作できなくする。
    func dimmed(_ isDimmed: Bool) -> some View {
        opacity(isDimmed ? 0.45 : 1).disabled(isDimmed)
    }
}

/// 選択肢のシート。固定キャンバスの拡大表示に入れず、通常サイズで出す。
private struct NotificationOptionSheet<Rows: View>: View {
    let title: String
    let footer: String?
    @ViewBuilder let rows: () -> Rows
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .overlay(alignment: .trailing) {
                    Button("完了") { dismiss() }
                        .fontWeight(.semibold)
                        .foregroundStyle(V5P.cyan)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)

            ScrollView {
                VStack(spacing: 0) { rows() }
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.06)))
                    .padding(.horizontal, 16)
                if let footer {
                    Text(footer)
                        .font(.footnote)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 24)
                        .padding(.top, 8)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationBackground(SettingsCardStyle.cardFill)
    }
}

private struct NotificationOptionRow: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(label).foregroundStyle(.white)
                Spacer()
                Image(systemName: "checkmark")
                    .fontWeight(.semibold)
                    .foregroundStyle(V5P.cyan)
                    .opacity(isSelected ? 1 : 0)
            }
            .padding(.horizontal, 16)
            .frame(height: 46)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
