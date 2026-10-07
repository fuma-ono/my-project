import SwiftUI
import UniformTypeIdentifiers

/// SCR-026 ホーム通貨ペア編集(HQ指示 2026-10-07の参考画像)。選択中の通貨
/// ペア(最大3つ、ドラッグで並べ替え)と「通貨ペアを追加する」、保存ボタン。
/// 追加・外すは遷移先の`HomeCurrencyPairPickerView`で行い、同じViewModelを
/// 共有するので、戻ってから「保存」でまとめて送る。国旗はホーム画面と同じく、
/// 基軸通貨と決済通貨の2つを並べる。
struct HomeCurrencyPairEditorView: View {
    @StateObject private var viewModel: HomeCurrencyPairEditorViewModel
    @Binding var tabSelection: Int
    @State private var dragging: String?
    @State private var showsPicker = false
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: HomeCurrencyPairEditorViewModel(apiClient: apiClient))
        _tabSelection = tabSelection
    }

    var body: some View {
        V5Viewport {
            V5Header(title: "ホーム通貨ペア編集", back: true, onBack: { dismiss() })
            switch viewModel.loadState {
            case .loading:
                centered { LoadingView(caption: "読み込み中...") }
            case .backendNotConfigured:
                centered { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "設定はまだ利用できません。") }
            case .error(let message):
                centered { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { Task { await viewModel.load() } }) }
            case .loaded:
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 8) {
                        NotoText.text("ホーム画面に表示する通貨ペアを選択・並べ替えできます。\n最大\(HomeSettings.maxPairs)つまで設定できます。", size: 7.5)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 4)
                        selectedSection
                        addButton
                        if case .error(let message) = viewModel.saveState {
                            NotoText.text(message, size: 7.5).foregroundStyle(V5P.red).frame(width: 214)
                        }
                        AccountPrimaryButton(title: "保存", isLoading: viewModel.saveState == .saving, isEnabled: viewModel.canSave) {
                            Task { if await viewModel.save() { dismiss() } }
                        }
                        .padding(.top, 10)
                    }
                    .frame(width: 214)
                    .padding(.vertical, 6)
                    .frame(width: V5P.W)
                }
                .frame(width: V5P.W, height: 398)
                .position(x: V5P.W / 2, y: 54 + 398 / 2)
            }
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await viewModel.load() }
        .navigationDestination(isPresented: $showsPicker) {
            HomeCurrencyPairPickerView(viewModel: viewModel, tabSelection: $tabSelection)
        }
    }

    private func centered(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
            .padding(.top, 53)
    }

    // MARK: - 選択中の通貨ペア

    private var selectedSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            NotoText.text("選択中の通貨ペア（\(viewModel.selected.count)/\(HomeSettings.maxPairs)）", size: 10.5)
                .foregroundStyle(SettingsListLayout.sectionTitleColor)
                .padding(.horizontal, 4)
            VStack(spacing: 0) {
                if viewModel.selected.isEmpty {
                    NotoText.text("「通貨ペアを追加する」から選んでください。", size: 8)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity, minHeight: 34)
                }
                ForEach(Array(viewModel.selected.enumerated()), id: \.element) { index, symbol in
                    if index > 0 { SettingsListSeparator() }
                    selectedRow(symbol)
                }
            }
            .frame(width: 214)
            .background(AccountCardBackground())
        }
    }

    private func selectedRow(_ symbol: String) -> some View {
        HStack(spacing: 7) {
            PairFlags(symbol: symbol)
            PairLabels(symbol: symbol)
            Spacer(minLength: 4)
            // 参考画像の「≡」。押したまま上下へ動かして並べ替える。
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(SettingsCardStyle.chevronColor)
                .frame(width: 20, height: 24)
                .contentShape(Rectangle())
                .accessibilityLabel("\(FXPairSymbol.displayName(symbol))を並べ替え")
        }
        .padding(.horizontal, 9)
        .frame(height: 34)
        .contentShape(Rectangle())
        .opacity(dragging == symbol ? 0.5 : 1)
        .onDrag {
            dragging = symbol
            return NSItemProvider(object: symbol as NSString)
        }
        .onDrop(of: [UTType.text], delegate: PairReorderDelegate(target: symbol, dragging: $dragging, viewModel: viewModel))
    }

    /// 参考画像の枠線だけの「⊕ 通貨ペアを追加する」。
    private var addButton: some View {
        Button { showsPicker = true } label: {
            HStack(spacing: 5) {
                Image(systemName: "plus.circle")
                    .font(.system(size: 10, weight: .semibold))
                NotoText.text("通貨ペアを追加する", size: AccountLayout.leadSize)
            }
            .foregroundStyle(.white)
            .frame(width: 214, height: 29)
            .background(
                RoundedRectangle(cornerRadius: 7)
                    .fill(SettingsCardStyle.cardFill)
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(V5P.cyan.opacity(0.7), lineWidth: 0.8))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
    }
}

/// SCR-026の遷移先「通貨ペアを追加」(参考画像の右側)。検索欄と絞り込み、
/// 選べる通貨ペアの一覧。選択中は✓、それ以外は＋で、行のタップで外す・追加する。
struct HomeCurrencyPairPickerView: View {
    @ObservedObject var viewModel: HomeCurrencyPairEditorViewModel
    @Binding var tabSelection: Int
    @State private var query = ""
    @State private var category: HomeCurrencyPairEditorViewModel.PairCategory = .all
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        V5Viewport {
            V5Header(title: "通貨ペアを追加", back: true, onBack: { dismiss() })
            VStack(alignment: .leading, spacing: 7) {
                HelpSearchField(text: $query, placeholder: "通貨ペアを検索")
                categoryBar
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 6) {
                        pairList
                        if !viewModel.canAdd {
                            NotoText.text("表示できるのは\(HomeSettings.maxPairs)つまでです。入れ替える場合は、チェックを外してから選んでください。", size: 7)
                                .foregroundStyle(SettingsCardStyle.subtitleColor)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.horizontal, 4)
                        }
                    }
                    .padding(.bottom, 6)
                }
            }
            .frame(width: 214)
            .padding(.top, 6)
            .frame(width: V5P.W, height: 398, alignment: .top)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private var categoryBar: some View {
        HStack(spacing: 4) {
            ForEach(HomeCurrencyPairEditorViewModel.PairCategory.allCases, id: \.self) { item in
                let isSelected = category == item
                Button { category = item } label: {
                    NotoText.text(item.label, size: 8)
                        .foregroundStyle(isSelected ? .white : SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity)
                        .frame(height: 20)
                        .background(Capsule().fill(isSelected ? V5P.blue : SettingsCardStyle.cardFill))
                        .overlay(Capsule().stroke(isSelected ? V5P.blue : SettingsCardStyle.cardBorder, lineWidth: 0.6))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
    }

    private var pairList: some View {
        let pairs = viewModel.pairs(in: category, matching: query)
        return VStack(spacing: 0) {
            if pairs.isEmpty {
                NotoText.text("該当する通貨ペアはありません。", size: 8)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(maxWidth: .infinity, minHeight: 34)
            }
            ForEach(Array(pairs.enumerated()), id: \.element) { index, symbol in
                if index > 0 { SettingsListSeparator() }
                pairRow(symbol)
            }
        }
        .frame(width: 214)
        .background(AccountCardBackground())
    }

    private func pairRow(_ symbol: String) -> some View {
        let isSelected = viewModel.selected.contains(symbol)
        let isEnabled = isSelected || viewModel.canAdd
        return Button { viewModel.toggle(symbol) } label: {
            HStack(spacing: 7) {
                PairFlags(symbol: symbol)
                PairLabels(symbol: symbol)
                Spacer(minLength: 4)
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 16, height: 16)
                        .background(Circle().fill(V5P.cyan.opacity(0.9)))
                } else {
                    Image(systemName: "plus")
                        .font(.system(size: 7.5, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 16, height: 16)
                        .overlay(Circle().stroke(Color.white.opacity(0.7), lineWidth: 0.8))
                        .opacity(isEnabled ? 1 : 0.35)
                }
            }
            .padding(.horizontal, 9)
            .frame(height: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel("\(FXPairSymbol.displayName(symbol))を\(isSelected ? "外す" : "追加")")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// ホーム画面と同じく、基軸通貨と決済通貨の国旗を2つ並べる。
private struct PairFlags: View {
    let symbol: String

    var body: some View {
        HStack(spacing: 2) {
            CountryFlagView(currencyCode: String(symbol.prefix(3)), diameter: 13)
            CountryFlagView(currencyCode: String(symbol.suffix(3)), diameter: 13)
        }
        .accessibilityHidden(true)
    }
}

private struct PairLabels: View {
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            NotoText.text(FXPairSymbol.displayName(symbol), size: 9.5).foregroundStyle(.white)
            NotoText.text(HomeCurrencyPairEditorViewModel.names(symbol), size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
        }
    }
}

/// 選択中の通貨ペアのドラッグでの並べ替え。
@MainActor
private struct PairReorderDelegate: DropDelegate {
    let target: String
    @Binding var dragging: String?
    let viewModel: HomeCurrencyPairEditorViewModel

    func dropEntered(info: DropInfo) {
        guard let dragging else { return }
        withAnimation(.easeInOut(duration: 0.15)) { viewModel.move(dragging, to: target) }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }

    func performDrop(info: DropInfo) -> Bool {
        dragging = nil
        return true
    }
}
