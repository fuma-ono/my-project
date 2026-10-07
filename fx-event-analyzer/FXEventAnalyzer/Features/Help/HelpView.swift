import SwiftUI

/// SCR-020 ヘルプ・お問い合わせ(HQ指示 2026-10-06の参考画像)。キーワード検索・
/// よくある質問(6分類)・お問い合わせ・フィードバックを並べる。
struct HelpView: View {
    let apiClient: APIClient
    @Binding var tabSelection: Int
    @State private var keyword = ""
    @State private var openedCategory: HelpFAQCategory?
    @State private var form: SupportRequest.Kind?
    @State private var showsHistory = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        V5Viewport {
            V5Header(title: "ヘルプ・お問い合わせ", back: true, onBack: { dismiss() })
            ScrollView(showsIndicators: false) {
                VStack(spacing: 10) {
                    HelpSearchField(text: $keyword)
                    if keyword.trimmingCharacters(in: .whitespaces).isEmpty {
                        faqSection
                    } else {
                        searchResults
                    }
                    contactCard(icon: "bubble.left.and.text.bubble.right", title: "お問い合わせ", subtitle: "フォームから問い合わせ") { form = .inquiry }
                    contactCard(icon: "square.and.pencil", title: "フィードバックを送る", subtitle: "ご意見・ご要望をお聞かせください") { form = .feedback }
                    Button { showsHistory = true } label: {
                        HStack(spacing: 4) {
                            NotoText.text("お問い合わせ履歴", size: 8.5)
                            Image(systemName: "chevron.right").font(.system(size: 8.5, weight: .semibold))
                        }
                        .foregroundStyle(SettingsListLayout.sectionTitleColor)
                        .frame(width: 214, alignment: .trailing)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 6)
                .padding(.bottom, 8)
                .frame(width: V5P.W)
            }
            .frame(width: V5P.W, height: 398)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(item: $openedCategory) { category in
            HelpFAQCategoryView(category: category, tabSelection: $tabSelection)
        }
        .navigationDestination(item: $form) { kind in
            SupportFormView(apiClient: apiClient, kind: kind, tabSelection: $tabSelection)
        }
        .navigationDestination(isPresented: $showsHistory) {
            SupportHistoryView(apiClient: apiClient, tabSelection: $tabSelection)
        }
    }

    private var faqSection: some View {
        SettingsListSection(title: "よくある質問") {
            ForEach(Array(HelpFAQ.categories.enumerated()), id: \.element.id) { index, category in
                if index > 0 { SettingsListSeparator() }
                SettingsListValueRow(title: category.title, value: "") { openedCategory = category }
            }
        }
    }

    private var searchResults: some View {
        let results = HelpFAQ.search(keyword)
        return SettingsListSection(title: "検索結果") {
            if results.isEmpty {
                NotoText.text("該当する質問が見つかりませんでした。お問い合わせからお送りください。", size: 8)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(Array(results.enumerated()), id: \.element.item.id) { index, result in
                    if index > 0 { SettingsListSeparator() }
                    HelpFAQAnswerRow(item: result.item)
                }
            }
        }
    }

    private func contactCard(icon: String, title: String, subtitle: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: 6).fill(V5P.blue))
                VStack(alignment: .leading, spacing: 2) {
                    NotoText.text(title, size: 9.5).foregroundStyle(.white)
                    NotoText.text(subtitle, size: 7.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(SettingsCardStyle.chevronColor)
            }
            .padding(.horizontal, 10)
            .frame(width: 214, height: 42)
            .background(AccountCardBackground())
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// 「キーワードで検索」欄。SCR-026の通貨ペア追加でも案内文を変えて使う。
struct HelpSearchField: View {
    @Binding var text: String
    var placeholder = "キーワードで検索"

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(SettingsCardStyle.chevronColor)
            ZStack(alignment: .leading) {
                if text.isEmpty {
                    NotoText.text(placeholder, size: 9)
                        .foregroundStyle(V5P.muted.opacity(0.8))
                        .allowsHitTesting(false)
                }
                TextField("", text: $text)
                    .font(.system(size: 9))
                    .foregroundStyle(.white)
                    .tint(V5P.cyan)
                    .submitLabel(.search)
                    .accessibilityLabel(placeholder)
            }
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 9)).foregroundStyle(V5P.muted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("検索を消す")
            }
        }
        .padding(.horizontal, 10)
        .frame(width: 214, height: 26)
        .background(AccountCardBackground())
    }
}

/// 質問をタップすると答えが開く行。
struct HelpFAQAnswerRow: View {
    let item: HelpFAQItem
    @State private var isOpen = false

    var body: some View {
        Button { withAnimation(.easeInOut(duration: 0.15)) { isOpen.toggle() } } label: {
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .top, spacing: 6) {
                    NotoText.text("Q", size: 9.5).foregroundStyle(V5P.cyan)
                    NotoText.text(item.question, size: 9)
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(SettingsCardStyle.chevronColor)
                }
                if isOpen {
                    NotoText.text(item.answer, size: 8)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.leading, 14)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(isOpen ? "答えを閉じる" : "答えを開く")
    }
}

/// よくある質問の1分類。
struct HelpFAQCategoryView: View {
    let category: HelpFAQCategory
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        V5Viewport {
            V5Header(title: category.title, back: true, onBack: { dismiss() })
            ScrollView(showsIndicators: false) {
                SettingsListSection(title: "よくある質問") {
                    ForEach(Array(category.items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { SettingsListSeparator() }
                        HelpFAQAnswerRow(item: item)
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
    }
}

extension SupportRequest.Kind: Identifiable {
    var id: String { rawValue }
}
