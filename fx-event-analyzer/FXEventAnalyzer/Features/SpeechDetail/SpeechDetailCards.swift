import SwiftUI

/// SCR-013 要人発言詳細の本体。SCR-007 イベント詳細(`EventDetailCards`)と
/// 同じカード構成(話者のカード、発言内容のカード、通貨ペア別の値動き
/// (pips)の表)・同じ見た目(`AccountCardBackground`・`SettingsCardStyle`の
/// 色、214幅のカード列)で統一する(HQ指示: 「イベント詳細画面とデザインは
/// 統一して」)。
///
/// 値動き(pips)の表と発言の引用については、`SpeechDetailViewModel`が呼ぶ
/// `GET /speeches/{id}`(api-design.md §14.5)に実データが無い:
/// - `summary`は出典に基づく事実の「要約」であり、発言の一字一句そのままの
///   引用ではないため、「」で囲った引用としては表示しない。
/// - 要人発言には`EventDetailResponse.majorFxReactions`(イベント専用の
///   `GET /events/{id}`のフィールド、api-design.md v1.17)に相当するものが
///   存在しない(DBマイグレーション`20261005000003_speeches.sql`のコメント
///   「SpeechPriceReaction は引き続き対象外」)。
/// そのため値動きの表は常に、`EventDetailCards`の「値動きのデータは
/// まだありません」と同じ空状態で表示する(実在しない数値を捏造しない)。
struct SpeechDetailCards: View {
    let response: SpeechDetailResponse

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            statementCard
            reactionTable
        }
        .frame(width: 214)
    }

    // MARK: - 話者のカード

    private var header: some View {
        let speaker = response.speaker
        return HStack(alignment: .top, spacing: 8) {
            CountryFlagView(countryCode: speaker.countryCode, diameter: 28)
            VStack(alignment: .leading, spacing: 3) {
                NotoText.text("\(speaker.name)　\(speaker.title)", size: 10.5)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                NotoText.text("\(CountryFlag.japaneseName(forCountry: speaker.countryCode))　|　\(speaker.organization)", size: 8.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 5) {
                NotoText.text("\(AppPreferences.shared.dateString(response.statementDatetime)) \(AppPreferences.shared.timeString(response.statementDatetime))", size: 7)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .fixedSize()
                let colors = HomeView.importanceBadgeColors(response.importance)
                NotoText.text(response.importance.rawValue, size: 7)
                    .tracking(-0.3)
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 15)
                    .background(colors.fill, in: Capsule())
                    .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
            }
        }
        .padding(10)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
    }

    // MARK: - 発言内容

    @ViewBuilder private var statementCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            NotoText.text("発言の要約", size: 8.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            if response.status == .scheduled {
                NotoText.text("この発言はまだ行われていません。", size: 9).foregroundStyle(SettingsCardStyle.subtitleColor)
            } else if response.status == .cancelled {
                NotoText.text("この発言は中止されました。", size: 9).foregroundStyle(SettingsCardStyle.subtitleColor)
            } else if let summary = response.summary {
                NotoText.text(summary, size: 9.5).foregroundStyle(.white)
            } else {
                NotoText.text("要約はまだ用意されていません。", size: 9).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .padding(10)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
    }

    // MARK: - 通貨ペア別の値動き(pips)

    /// `EventDetailCards.reactionTable`と同じ枠組み(見出し行・列ヘッダー・
    /// 空状態メッセージ)。要人発言にはデータがまだ無いため、常に空状態。
    private var reactionTable: some View {
        VStack(spacing: 0) {
            NotoText.text("通貨ペア別の値動き（pips）", size: 10.5)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
                .frame(height: 24)
                .overlay(alignment: .bottom) { Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5) }
            HStack(spacing: 0) {
                cell(width: Self.pairColumnWidth) { Color.clear }
                ForEach(["1分", "5分", "15分"], id: \.self) { label in
                    cell(width: Self.valueColumnWidth) {
                        NotoText.text(label, size: 9.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                }
            }
            .frame(height: Self.headerHeight)
            .background(Self.headerFill)
            NotoText.text("値動きのデータはまだありません。", size: 8.5)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .frame(width: 214, height: 34)
                .overlay(Rectangle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.5))
        }
        .frame(width: 214)
        .background(Self.bodyGradient)
        .clipShape(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius))
        .overlay(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    private static let headerFill = Color(red: 0.04, green: 0.18, blue: 0.36)
    private static let bodyGradient = LinearGradient(
        colors: [SettingsCardStyle.cardFill, Color(red: 0.03, green: 0.14, blue: 0.27)],
        startPoint: .top, endPoint: .bottom
    )

    private static let pairColumnWidth: CGFloat = 80
    private static let valueColumnWidth: CGFloat = (214 - 80) / 3
    private static let headerHeight: CGFloat = 22

    private func cell(width: CGFloat, alignment: Alignment = .center, @ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: width, alignment: alignment)
            .frame(maxHeight: .infinity)
            .overlay(Rectangle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.5))
    }
}
