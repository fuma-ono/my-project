import SwiftUI

/// お問い合わせ・フィードバックの送信画面。送ると、その場で自動返信を表示する。
///
/// HQ指示(Calendar/Settings/Accountのみ移植): 送信後の「お問い合わせ履歴を見る」
/// (`SupportHistoryView`)への導線は削除した — `SupportHistoryView`は対象外として
/// 明示的に除外されている画面のため。送信とその場の自動返信表示はそのまま使える。
struct SupportFormView: View {
    let kind: SupportRequest.Kind
    @StateObject private var viewModel: SupportViewModel
    @Binding var tabSelection: Int
    @State private var showsCategories = false
    @FocusState private var editorFocused: Bool
    @Environment(\.dismiss) private var dismiss
    private let apiClient: APIClient

    init(apiClient: APIClient, kind: SupportRequest.Kind, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        self.kind = kind
        _viewModel = StateObject(wrappedValue: SupportViewModel(apiClient: apiClient))
        _tabSelection = tabSelection
    }

    private var title: String { kind == .inquiry ? "お問い合わせ" : "フィードバック" }

    var body: some View {
        V5Viewport {
            V5Header(title: title, back: true, onBack: { dismiss() })
            ScrollView(showsIndicators: false) {
                VStack(spacing: 10) {
                    if case .sent(let request) = viewModel.sendState {
                        result(request)
                    } else {
                        form
                    }
                }
                .padding(.top, 6)
                .frame(width: V5P.W)
            }
            .frame(width: V5P.W, height: 398)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showsCategories) { categorySheet }
    }

    // MARK: - 入力

    @ViewBuilder private var form: some View {
        if kind == .inquiry {
            SettingsListSection(title: "お問い合わせの種類") {
                SettingsListValueRow(title: "種類", value: SupportCategory.label(viewModel.category)) { showsCategories = true }
            }
        }
        SettingsListSection(title: kind == .inquiry ? "お問い合わせ内容" : "ご意見・ご要望") {
            ZStack(alignment: .topLeading) {
                if viewModel.body.isEmpty {
                    NotoText.text(placeholder, size: 8.5)
                        .foregroundStyle(V5P.muted.opacity(0.8))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $viewModel.body)
                    .font(.system(size: 9))
                    .foregroundStyle(.white)
                    .tint(V5P.cyan)
                    .scrollContentBackground(.hidden)
                    .focused($editorFocused)
                    .accessibilityLabel(kind == .inquiry ? "お問い合わせ内容" : "ご意見・ご要望")
            }
            .padding(6)
            .frame(height: 130)
        }
        HStack {
            NotoText.text(note, size: 7)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            NotoText.text("\(viewModel.body.utf16.count)/\(SupportViewModel.maxLength)", size: 7)
                .foregroundStyle(viewModel.body.utf16.count > SupportViewModel.maxLength ? V5P.red : SettingsCardStyle.subtitleColor)
        }
        .frame(width: 214)
        if case .error(let message) = viewModel.sendState {
            NotoText.text(message, size: 7.5).foregroundStyle(V5P.red).frame(width: 214)
        }
        AccountPrimaryButton(title: "送信する", isLoading: viewModel.sendState == .sending, isEnabled: viewModel.canSend) {
            editorFocused = false
            Task { await viewModel.send(kind: kind) }
        }
    }

    private var placeholder: String {
        kind == .inquiry
            ? "できるだけ具体的にご記入ください。不具合の場合は、起きたことと操作の手順を書いていただけると助かります。"
            : "アプリへのご意見・ご要望をお聞かせください。"
    }

    private var note: String {
        "送信時に、アプリのバージョンと端末の種類・OSのバージョンを添えます。"
    }

    private var categorySheet: some View {
        SettingsListOptionSheet(title: "お問い合わせの種類", footer: "不具合の報告は、開発チームで修正の対象として登録します。") {
            ForEach(SupportCategory.inquiryOptions, id: \.value) { option in
                SettingsListOptionRow(label: option.label, isSelected: viewModel.category == option.value) {
                    viewModel.category = option.value
                    showsCategories = false
                }
            }
        }
    }

    // MARK: - 送信後

    private func result(_ request: SupportRequest) -> some View {
        VStack(spacing: 10) {
            AccountInfoCard(
                icon: "checkmark.circle.fill",
                title: request.status == .ignored ? "受け付けました" : "送信しました",
                text: SupportViewModel.replyText(request),
                tint: V5P.green,
                textSize: 8
            )
            AccountSecondaryButton(title: "閉じる") { dismiss() }
        }
    }
}
