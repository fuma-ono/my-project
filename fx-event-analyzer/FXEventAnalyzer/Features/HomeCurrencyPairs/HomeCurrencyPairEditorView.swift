import SwiftUI
import UniformTypeIdentifiers

/// SCR-026 ホーム通貨ペア編集(HQ指示 2026-10-07の参考画像)。上に表示する通貨
/// ペア(最大3つ、番号・並べ替え・外す)、下にその他の通貨ペア(追加)、最後に
/// 保存ボタン。国旗はホーム画面と同じく、基軸通貨と決済通貨の2つを並べる。
struct HomeCurrencyPairEditorView: View {
    @StateObject private var viewModel: HomeCurrencyPairEditorViewModel
    @Binding var tabSelection: Int
    @State private var dragging: String?
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
                        NotoText.text("ホーム画面に表示する通貨ペアを選択・並び替えできます。\n※ ホーム画面には最大3つまで表示されます。", size: 7.5)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 4)
                        selectedSection
                        othersSection
                        if case .error(let message) = viewModel.saveState {
                            NotoText.text(message, size: 7.5).foregroundStyle(V5P.red).frame(width: 214)
                        }
                        AccountPrimaryButton(title: "保存", isLoading: viewModel.saveState == .saving, isEnabled: viewModel.canSave) {
                            Task { if await viewModel.save() { dismiss() } }
                        }
                        .padding(.top, 4)
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
    }

    private func centered(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
            .padding(.top, 53)
    }

    // MARK: - 表示する通貨ペア

    private var selectedSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                NotoText.text("表示する通貨ペア（最大\(HomeSettings.maxPairs)つ）", size: 10.5)
                    .foregroundStyle(SettingsListLayout.sectionTitleColor)
                Spacer()
                NotoText.text("\(viewModel.selected.count)/\(HomeSettings.maxPairs)", size: 8.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            .padding(.horizontal, 4)
            VStack(spacing: 0) {
                if viewModel.selected.isEmpty {
                    NotoText.text("下の一覧から追加してください。", size: 8)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity, minHeight: 34)
                }
                ForEach(Array(viewModel.selected.enumerated()), id: \.element) { index, symbol in
                    if index > 0 { SettingsListSeparator() }
                    selectedRow(index: index, symbol: symbol)
                }
            }
            .frame(width: 214)
            .background(AccountCardBackground())
        }
    }

    private func selectedRow(index: Int, symbol: String) -> some View {
        HStack(spacing: 7) {
            NotoText.text("\(index + 1)", size: 8)
                .foregroundStyle(.white)
                .frame(width: 15, height: 15)
                .background(Circle().fill(Color.white.opacity(0.08)))
                .overlay(Circle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.6))
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
            Button { viewModel.remove(symbol) } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 6.5, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 15, height: 15)
                    .background(Circle().fill(Color.white.opacity(0.12)))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(FXPairSymbol.displayName(symbol))を外す")
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

    // MARK: - その他の通貨ペア

    private var othersSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            NotoText.text("その他の通貨ペア", size: 10.5)
                .foregroundStyle(SettingsListLayout.sectionTitleColor)
                .padding(.horizontal, 4)
            VStack(spacing: 0) {
                ForEach(Array(viewModel.others.enumerated()), id: \.element) { index, symbol in
                    if index > 0 { SettingsListSeparator() }
                    HStack(spacing: 7) {
                        PairFlags(symbol: symbol)
                        PairLabels(symbol: symbol)
                        Spacer(minLength: 4)
                        Button { viewModel.add(symbol) } label: {
                            Image(systemName: "plus")
                                .font(.system(size: 7.5, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 16, height: 16)
                                .background(Circle().fill(Color.white.opacity(0.12)))
                        }
                        .buttonStyle(.plain)
                        .disabled(!viewModel.canAdd)
                        .opacity(viewModel.canAdd ? 1 : 0.35)
                        .accessibilityLabel("\(FXPairSymbol.displayName(symbol))を追加")
                    }
                    .padding(.horizontal, 9)
                    .frame(height: 32)
                }
            }
            .frame(width: 214)
            .background(AccountCardBackground())
            if !viewModel.canAdd {
                NotoText.text("表示できるのは\(HomeSettings.maxPairs)つまでです。入れ替える場合は、上の一覧から外してください。", size: 7)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
            }
        }
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

/// 表示する通貨ペアのドラッグでの並べ替え。
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
