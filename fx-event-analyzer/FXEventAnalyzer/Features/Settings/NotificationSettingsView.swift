import SwiftUI
import UIKit

/// SCR-016 通知設定(api-design.md §24.4)。HQ指示(2026-10-05)の参考画像
/// (「通知の種類」「通知の条件」「通知について」の3枚のカード)の配置を、
/// ヘッダー下〜タブバー上(V5座標の約54〜452)に換算した。保存ボタンは
/// 無く、変更はその場で保存される(`NotificationSettingsViewModel`)。
struct NotificationSettingsView: View {
    @StateObject private var viewModel: NotificationSettingsViewModel
    @Binding var tabSelection: Int
    @State private var picker: OptionPicker?
    @Environment(\.dismiss) private var dismiss

    private enum OptionPicker: String, Identifiable {
        case fxPairs, importances, timing
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
                VStack(spacing: 8) {
                    kindsCard
                    conditionsCard
                    aboutCard
                }
                .accountPinned(top: 59, height: 392)
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
        NotificationCard(icon: "bell.fill", title: "通知の種類", subtitle: "受け取りたい通知を選択してください。") {
            NotificationToggleRow(
                icon: "iphone.radiowaves.left.and.right", title: "プッシュ通知",
                subtitle: "アプリからの各種通知を受け取ります。",
                isOn: viewModel.settings.push, onChange: { viewModel.setPush($0) }
            )
            NotificationSeparator()
            NotificationToggleRow(
                icon: "chart.bar.fill", title: "重要な経済指標の通知",
                subtitle: "指定した通貨ペアの重要な経済指標の発表をお知らせします。",
                isOn: viewModel.settings.indicators, onChange: { viewModel.setIndicators($0) }
            )
            .dimmed(!viewModel.settings.push)
            NotificationSeparator()
            NotificationToggleRow(
                icon: "person.wave.2.fill", title: "要人発言の通知",
                subtitle: "主要な金融当局者の発言をお知らせします。",
                isOn: viewModel.settings.speeches, onChange: { viewModel.setSpeeches($0) }
            )
            .dimmed(!viewModel.settings.push)
        }
    }

    // MARK: - 通知の条件

    private var conditionsCard: some View {
        NotificationCard(icon: "gearshape.fill", title: "通知の条件", subtitle: "通知の詳細な条件を設定できます。") {
            NotificationValueRow(
                icon: "globe", title: "対象通貨ペア",
                subtitle: "通知を受け取る通貨ペアを選択してください。",
                value: viewModel.fxPairsLabel
            ) { picker = .fxPairs }
            NotificationSeparator()
            NotificationValueRow(
                icon: "star.fill", title: "重要度",
                subtitle: "重要度の高いイベントのみ通知します。",
                value: viewModel.importancesLabel
            ) { picker = .importances }
            NotificationSeparator()
            NotificationValueRow(
                icon: "clock.fill", title: "通知のタイミング",
                subtitle: "発表の何分前に通知するかを設定します。",
                value: NotificationSettingsViewModel.leadLabel(viewModel.settings.leadMinutes)
            ) { picker = .timing }
        }
        .dimmed(!viewModel.settings.push)
    }

    // MARK: - 通知について

    private var aboutCard: some View {
        VStack(spacing: 5) {
            AccountInfoCard(
                icon: "info.circle.fill",
                title: "通知について",
                text: "通知は、選択した通貨ペア・重要度・タイミングの条件に基づいて配信されます。プッシュ通知の設定は、端末の通知設定もご確認ください。"
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

private enum NotificationLayout {
    static let width: CGFloat = 214
    static let sectionTitleSize: CGFloat = 9.5
    static let rowTitleSize: CGFloat = 8.5
    static let subtitleSize: CGFloat = 6.5
    static let valueSize: CGFloat = 7.5
}

/// 丸いアイコン・見出し・説明の下に、枠で囲んだ行を並べるカード。
private struct NotificationCard<Rows: View>: View {
    let icon: String
    let title: String
    let subtitle: String
    @ViewBuilder let rows: () -> Rows

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(V5P.cyan)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(V5P.cyan.opacity(0.14)))
                    .overlay(Circle().stroke(V5P.cyan.opacity(0.45), lineWidth: 0.6))
                VStack(alignment: .leading, spacing: 2) {
                    V5JPFont.text(title, size: NotificationLayout.sectionTitleSize, weight: .bold).foregroundStyle(.white)
                    V5JPFont.text(subtitle, size: NotificationLayout.subtitleSize, weight: .regular)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(height: 36)

            VStack(spacing: 0) { rows() }
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.black.opacity(0.14))
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(SettingsCardStyle.separator, lineWidth: 0.6))
                )
                .padding(.horizontal, 6)
                .padding(.bottom, 6)
        }
        .frame(width: NotificationLayout.width)
        .background(AccountCardBackground())
    }
}

private struct NotificationSeparator: View {
    var body: some View {
        Rectangle().fill(SettingsCardStyle.separator).frame(height: 0.6).padding(.horizontal, 8)
    }
}

/// 角丸の四角に入った行のアイコン。
private struct NotificationIconTile: View {
    let icon: String
    var body: some View {
        Image(systemName: icon)
            .font(.system(size: 9.5, weight: .semibold))
            .foregroundStyle(V5P.cyan)
            .frame(width: 20, height: 20)
            .background(RoundedRectangle(cornerRadius: 5).fill(SettingsCardStyle.cardFill))
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.6))
    }
}

private struct NotificationRowText: View {
    let title: String
    let subtitle: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            V5JPFont.text(title, size: NotificationLayout.rowTitleSize, weight: .bold).foregroundStyle(.white)
            V5JPFont.text(subtitle, size: NotificationLayout.subtitleSize, weight: .regular)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// ON/OFFの行。標準Toggleは固定キャンバスに対して大きすぎるため、V5の
/// 寸法でスイッチを描き、VoiceOverには切り替えスイッチとして見せる。
private struct NotificationToggleRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let isOn: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        Button { onChange(!isOn) } label: {
            HStack(spacing: 8) {
                NotificationIconTile(icon: icon)
                NotificationRowText(title: title, subtitle: subtitle)
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
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
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
    let icon: String
    let title: String
    let subtitle: String
    let value: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                NotificationIconTile(icon: icon)
                NotificationRowText(title: title, subtitle: subtitle)
                    .frame(width: 98, alignment: .leading)
                Spacer(minLength: 2)
                V5JPFont.text(value, size: NotificationLayout.valueSize, weight: .regular)
                    .foregroundStyle(SettingsCardStyle.chevronColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 7.5, weight: .semibold))
                    .foregroundStyle(SettingsCardStyle.chevronColor)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
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
