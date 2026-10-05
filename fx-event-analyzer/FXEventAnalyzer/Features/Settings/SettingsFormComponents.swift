import SwiftUI

/// SCR-016 / SCR-018 / SCR-019 の共通部品。V5の固定キャンバス(234×491)上に、
/// AccountViewの行(214×30のパネル行)と同じ見た目で並べる。正式なUI画像を
/// HQから受け取るまでの暫定レイアウトで、共有コンポーネント
/// (V5PixelFrontend.swift)には手を入れず、この3画面専用としてここに置く。

struct SettingsOption<Value: Hashable>: Identifiable {
    let value: Value
    let label: String
    var id: Value { value }
}

extension Array {
    /// `current`が選択肢にない値(Backend側で別の値が保存されている場合)でも
    /// 表示・保持できるよう、末尾にそのまま追加する。
    func including<Value: Hashable>(_ current: Value, label: (Value) -> String) -> [SettingsOption<Value>] where Element == SettingsOption<Value> {
        contains { $0.value == current } ? self : self + [SettingsOption(value: current, label: label(current))]
    }
}

/// 読み込み中・Backend未設定・エラー・読み込み完了を切り替える外枠。
/// 読み込み完了時はV5のヘッダー(戻る付き)・下部タブ・保存ボタンを置き、
/// 行は`content`側で`.position`する。
struct SettingsSectionScaffold<Section: SettingsSection, Content: View>: View {
    let title: String
    @ObservedObject var viewModel: SettingsSectionViewModel<Section>
    @Binding var tabSelection: Int
    /// 保存ボタンの中心y(行の数で画面ごとに変わる)。
    let saveButtonY: CGFloat
    let content: () -> Content
    @Environment(\.dismiss) private var dismiss

    init(
        title: String,
        viewModel: SettingsSectionViewModel<Section>,
        tabSelection: Binding<Int>,
        saveButtonY: CGFloat,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.viewModel = viewModel
        _tabSelection = tabSelection
        self.saveButtonY = saveButtonY
        self.content = content
    }

    var body: some View {
        Group {
            switch viewModel.loadState {
            case .loading:
                scaffold { LoadingView(caption: "読み込み中...") }
            case .backendNotConfigured:
                scaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "設定はまだ利用できません。") }
            case .error(let message):
                scaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
            case .loaded:
                V5Viewport {
                    V5Header(title: title, back: true, onBack: { dismiss() })
                    content()
                    saveButton.position(x: 117, y: saveButtonY)
                    V5BottomBar(selected: $tabSelection)
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { viewModel.load() }
    }

    private var saveButton: some View {
        Button { viewModel.save() } label: {
            ZStack {
                V5Button(title: viewModel.saveState == .saving ? "" : "保存する")
                if viewModel.saveState == .saving { ProgressView().tint(.white).scaleEffect(0.6) }
            }
            .frame(width: 214)
            .opacity(viewModel.canSave || viewModel.saveState == .saving ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .disabled(!viewModel.canSave)
        .overlay(alignment: .bottom) {
            Group {
                switch viewModel.saveState {
                case .saved: V5JPFont.text("保存しました", size: 6, weight: .regular).foregroundStyle(V5P.green)
                case .error(let message): V5JPFont.text(message, size: 6, weight: .regular).foregroundStyle(V5P.red)
                case .idle, .saving: EmptyView()
                }
            }
            .multilineTextAlignment(.center)
            .frame(width: 214)
            .offset(y: 14)
        }
    }

    @ViewBuilder private func scaffold(@ViewBuilder content: () -> some View) -> some View {
        ZStack {
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
            content()
        }
    }
}

/// セクション見出し(行グループの上に置く小さな文字)。
struct SettingsCaption: View {
    let text: String
    var body: some View {
        V5JPFont.text(text, size: 7)
            .foregroundStyle(V5P.muted)
            .frame(width: 210, alignment: .leading)
    }
}

/// 補足説明(複数行可)。
///
/// この画面群の日本語は、HQ指示(2026-10-05「フォントが日本語っぽくない」)
/// により他画面と同じ`V5JPFont`(日本語部分のみNoto Sans JP)で描いている。
struct SettingsNote: View {
    let text: String
    var body: some View {
        V5JPFont.text(text, size: 6, weight: .regular)
            .foregroundStyle(V5P.muted)
            .frame(width: 210, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// AccountViewの行と同じ214×30のパネル行。右端に操作部品を置く。
struct SettingsFormRow<Trailing: View>: View {
    let icon: String
    let title: String
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 9)).frame(width: 12)
            V5JPFont.text(title, size: 8, weight: .regular)
            Spacer(minLength: 4)
            trailing()
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 9).frame(width: 214, height: 30)
        .background(V5P.panel, in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(V5P.line.opacity(0.5), lineWidth: 0.5))
    }
}

/// ON/OFFの行。標準Toggleは固定キャンバスに対して大きすぎるため、V5の
/// 寸法に合わせたスイッチを描き、VoiceOverには切り替えスイッチとして見せる。
struct SettingsToggleRow: View {
    let icon: String
    let title: String
    @Binding var isOn: Bool

    var body: some View {
        Button { isOn.toggle() } label: {
            SettingsFormRow(icon: icon, title: title) {
                Capsule()
                    .fill(isOn ? V5P.cyan.opacity(0.85) : V5P.panel2)
                    .overlay(Capsule().stroke(V5P.line, lineWidth: 0.5))
                    .frame(width: 22, height: 12)
                    .overlay(alignment: isOn ? .trailing : .leading) {
                        Circle().fill(.white).frame(width: 10, height: 10).padding(1)
                    }
                    .animation(.easeInOut(duration: 0.15), value: isOn)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(isOn ? "オン" : "オフ")
        .accessibilityAddTraits(.isToggle)
    }
}

/// 少数の選択肢を横並びのボタンで選ぶ(言語・時間足)。
struct SettingsSegmentedPicker<Value: Hashable>: View {
    let options: [SettingsOption<Value>]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 3) {
            ForEach(options) { option in
                let selected = option.value == selection
                Button { selection = option.value } label: {
                    V5JPFont.text(option.label, size: 7, weight: selected ? .bold : .regular)
                        .foregroundStyle(selected ? V5P.cyan : V5P.muted)
                        .frame(maxWidth: .infinity, minHeight: 20)
                        .background(selected ? V5P.cyan.opacity(0.16) : V5P.panel, in: RoundedRectangle(cornerRadius: 5))
                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(selected ? V5P.cyan.opacity(0.5) : V5P.line.opacity(0.5), lineWidth: 0.5))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .frame(width: 214)
    }
}

/// 選択肢の多い項目(地域・タイムゾーン・通貨ペア)をメニューで選ぶ行の右端。
struct SettingsMenuPicker<Value: Hashable>: View {
    let options: [SettingsOption<Value>]
    @Binding var selection: Value

    var body: some View {
        Menu {
            Picker("", selection: $selection) {
                ForEach(options) { Text($0.label).tag($0.value) }
            }
        } label: {
            HStack(spacing: 3) {
                V5JPFont.text(options.first { $0.value == selection }?.label ?? "", size: 7, weight: .regular)
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 6))
            }
            .foregroundStyle(V5P.cyan)
        }
    }
}

/// 通知する重要度の下限(★1〜★5)。
struct SettingsStarPicker: View {
    @Binding var minimum: Int

    var body: some View {
        HStack(spacing: 2) {
            ForEach(NotificationSettings.importanceRange, id: \.self) { stars in
                Button { minimum = stars } label: {
                    Image(systemName: stars <= minimum ? "star.fill" : "star")
                        .font(.system(size: 9))
                        .foregroundStyle(stars <= minimum ? V5P.yellow : V5P.muted)
                        .frame(width: 13, height: 20)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("★\(stars)以上")
                .accessibilityAddTraits(stars == minimum ? .isSelected : [])
            }
        }
    }
}
