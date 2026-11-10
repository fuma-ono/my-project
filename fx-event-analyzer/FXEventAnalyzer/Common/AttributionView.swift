import SwiftUI

/// 出典の短い1行表示+タップで免責文の全文を見られるシート(HQ決定2026-11-10「取得日の
/// 表示方法と出典対応」案a)。イベント詳細(`EventDetailCards`)・指標詳細(`IndicatorDetailCard`)
/// で共通して使う。以前はどちらも出典名・告知文(免責文)を常時表示していたが、免責文が長い
/// 指標(BLS等)でカードが縦に伸びすぎていた。1行(「出典：{出典}・取得日 {日付}」)+タップ展開に
/// まとめ、免責文の全文は削除・短縮せずシート側でそのまま出す。
struct AttributionLine: View {
    let attribution: Attribution
    /// この出典に紐づく値を取得した日時(イベント詳細の`snapshot.captured_at`等)。
    /// 無ければ(指標詳細のような、特定の発表に紐づかない出典や、古いBackend・未記録の取得元)
    /// 日付は出さず、推測もしない。
    var capturedAt: Date? = nil
    @State private var showsDetail = false

    var body: some View {
        Button {
            showsDetail = true
        } label: {
            NotoText.text(Self.summaryText(source: attribution.source, capturedAt: capturedAt), size: 6.5)
                .underline()
                .multilineTextAlignment(.leading)
        }
        .buttonStyle(.plain)
        .foregroundStyle(V5P.cyan)
        .sheet(isPresented: $showsDetail) {
            AttributionDetailSheet(attribution: attribution, capturedAt: capturedAt)
        }
    }

    /// `capturedAt`が無ければ(推測せず)出典名だけ。テストから直接確かめられるよう`static`にした。
    @MainActor static func summaryText(source: String, capturedAt: Date?) -> String {
        guard let capturedAt else { return "出典：\(source)" }
        return "出典：\(source)・取得日 \(AppPreferences.shared.shortDateString(capturedAt))"
    }
}

/// `AttributionLine`をタップしたときに出す、出典元リンク・取得日・免責文の全文。`SubscriptionSheet`
/// (`SubscriptionManagementView.swift`)と同じ構成(タイトル+「閉じる」、固定キャンバスの拡大表示には
/// 入れない通常サイズのシート)。
private struct AttributionDetailSheet: View {
    let attribution: Attribution
    let capturedAt: Date?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Text("出典について")
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .overlay(alignment: .trailing) {
                    Button("閉じる") { dismiss() }
                        .fontWeight(.semibold)
                        .foregroundStyle(V5P.cyan)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let url = URL(string: attribution.sourceUrl) {
                        Link(destination: url) {
                            Text("出典：\(attribution.source)")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(V5P.cyan)
                        }
                    } else {
                        Text("出典：\(attribution.source)")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                    }
                    if let capturedAt {
                        Text("取得日：\(AppPreferences.shared.dateString(capturedAt))")
                            .font(.footnote)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                    // HQ決定(2026-11-10)「免責文の全文は削除・短縮しない」: lineLimit等で
                    // 切らず、fixedSizeで必要な高さぶんそのまま表示する(ScrollView内)。
                    if let notice = attribution.notice {
                        Text(notice)
                            .font(.footnote)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(SettingsCardStyle.cardFill)
    }
}
