import SwiftUI

/// SCR-021 利用規約 / SCR-022 プライバシーポリシー(HQ指示 2026-10-06の参考画像:
/// 1枚のカードに文書名と各条を並べ、条の見出しの下に番号付きの項を置く)。
struct LegalDocumentView: View {
    let document: LegalDocument
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        V5Viewport {
            V5Header(title: document.screenTitle, back: true, onBack: { dismiss() })
            ScrollView(showsIndicators: false) {
                LegalDocumentContent(document: document)
                    .padding(12)
                    .frame(width: 214, alignment: .leading)
                    .background(AccountCardBackground())
                    .padding(.vertical, 6)
                    .frame(width: V5P.W)
            }
            .frame(width: V5P.W, height: 398)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}

/// 本文。V5の画面(`scale` 1)と、購入シートから開く通常サイズの表示(`scale`
/// 約1.7)で共通にする。
struct LegalDocumentContent: View {
    let document: LegalDocument
    var scale: CGFloat = 1

    var body: some View {
        VStack(alignment: .leading, spacing: 10 * scale) {
            // 文書名は13.5(HQ指示 2026-10-06)。改行の位置は本文側で指定し、
            // 1行の文書名は折り返さずに収める。
            V5JPFont.text(document.title, size: 13.5 * scale, weight: .bold)
                .foregroundStyle(.white)
                .lineLimit(document.title.contains("\n") ? nil : 1)
                .minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)
            if let preamble = document.preamble {
                paragraph(preamble)
            }
            ForEach(document.sections, id: \.self) { section in
                VStack(alignment: .leading, spacing: 4 * scale) {
                    V5JPFont.text(section.heading, size: 9.5 * scale, weight: .bold)
                        .foregroundStyle(SettingsListLayout.sectionTitleColor)
                    if let lead = section.lead { paragraph(lead) }
                    if section.items.count == 1 && section.lead == nil {
                        paragraph(section.items[0])
                    } else {
                        ForEach(Array(section.items.enumerated()), id: \.offset) { index, item in
                            HStack(alignment: .top, spacing: 3 * scale) {
                                NotoText.text("\(index + 1).", size: 8 * scale)
                                    .foregroundStyle(.white)
                                    .frame(width: 11 * scale, alignment: .leading)
                                paragraph(item)
                            }
                        }
                    }
                }
            }
            VStack(alignment: .trailing, spacing: 2 * scale) {
                ForEach(document.footer, id: \.self) { line in
                    V5JPFont.text(line, size: 7.5 * scale, weight: .regular).foregroundStyle(SettingsCardStyle.subtitleColor)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.top, 4 * scale)
        }
    }

    private func paragraph(_ text: String) -> some View {
        V5JPFont.text(text, size: 8 * scale, weight: .regular)
            .foregroundStyle(.white.opacity(0.88))
            .lineSpacing(2.5 * scale)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 購入シートなど、V5の画面の外から開く通常サイズの表示。
struct LegalDocumentSheet: View {
    let document: LegalDocument
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Text(document.screenTitle)
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .overlay(alignment: .trailing) {
                    Button("完了") { dismiss() }.fontWeight(.semibold).foregroundStyle(V5P.cyan)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            ScrollView {
                LegalDocumentContent(document: document, scale: 1.7)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
            }
        }
        .presentationBackground(SettingsCardStyle.cardFill)
    }
}
