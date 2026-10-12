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
/// HQ指示(2026-10-11)「値動きは仮のデータでいいから表示させて」: 上記の
/// 事情を説明した上で、実データが無くても参考画像どおりの見た目を仮の値で
/// 表示する方針に確定。`placeholderReactions`はこのファイル内に閉じた表示
/// 専用の固定値で、APIレスポンス(`SpeechDetailResponse`)には含まれない
/// ——Backendからの実データであるかのようには見せない。
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
                // 名前+役職が1行に収まらない場合だけ2行に分ける
                // (Home/検索の指標名と同じ`ViewThatFits`の考え方) —
                // 固定の`minimumScaleFactor`だけでは長い名前(「クリスト
                // ファー・ウォラー」等)が省略記号で切れてしまっていた。
                ViewThatFits(in: .horizontal) {
                    NotoText.text("\(speaker.name)　\(speaker.title)", size: 10.5)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    VStack(alignment: .leading, spacing: 1) {
                        NotoText.text(speaker.name, size: 10.5)
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        NotoText.text(speaker.title, size: 8.5)
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                }
                NotoText.text("\(CountryFlag.japaneseName(forCountry: speaker.countryCode))　|　\(speaker.organization)", size: 8.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            Spacer(minLength: 4)
            // 日時+重要度バッジの列に固定幅を確保し、名前側の2行フォール
            // バックが伸びても日時側(「2026/10/12 0:00」)が省略されない
            // ようにする(前回の`.layoutPriority`方式は逆に日時側が切れた)。
            VStack(alignment: .trailing, spacing: 5) {
                NotoText.text("\(AppPreferences.shared.dateString(response.statementDatetime)) \(AppPreferences.shared.timeString(response.statementDatetime))", size: 7)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                let colors = HomeView.importanceBadgeColors(response.importance)
                NotoText.text(response.importance.rawValue, size: 7)
                    .tracking(-0.3)
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 15)
                    .background(colors.fill, in: Capsule())
                    .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
            }
            .frame(minWidth: 72, alignment: .trailing)
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

    /// 表示専用の仮データ(上部のドキュメントコメント参照)。4大通貨ペア×
    /// 1分/5分/15分。
    private struct PlaceholderReaction: Identifiable {
        let symbol: String
        let oneMinute: Double
        let fiveMinute: Double
        let fifteenMinute: Double
        var id: String { symbol }
    }

    private static let placeholderReactions: [PlaceholderReaction] = [
        PlaceholderReaction(symbol: "USD/JPY", oneMinute: -5.2, fiveMinute: -18.4, fifteenMinute: -32.7),
        PlaceholderReaction(symbol: "EUR/USD", oneMinute: 2.1, fiveMinute: 8.6, fifteenMinute: 14.2),
        PlaceholderReaction(symbol: "GBP/USD", oneMinute: 1.4, fiveMinute: 6.2, fifteenMinute: 11.8),
        PlaceholderReaction(symbol: "AUD/USD", oneMinute: 0.8, fiveMinute: 4.3, fifteenMinute: 7.6),
    ]

    /// `EventDetailCards.reactionTable`と同じ枠組み(見出し行・列ヘッダー・
    /// 行の罫線)。
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
            ForEach(Self.placeholderReactions) { reaction in
                HStack(spacing: 0) {
                    cell(width: Self.pairColumnWidth, alignment: .leading) { pairLabel(reaction.symbol) }
                    cell(width: Self.valueColumnWidth) { pipsText(reaction.oneMinute) }
                    cell(width: Self.valueColumnWidth) { pipsText(reaction.fiveMinute) }
                    cell(width: Self.valueColumnWidth) { pipsText(reaction.fifteenMinute) }
                }
                .frame(height: Self.rowHeight)
            }
        }
        .frame(width: 214)
        .background(Self.bodyGradient)
        .clipShape(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius))
        .overlay(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    private func pairLabel(_ symbol: String) -> some View {
        HStack(spacing: 5) {
            CountryFlagView(currencyCode: String(symbol.prefix(3)), diameter: 13)
            NotoText.text(FXPairSymbol.displayName(symbol), size: 9.5)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.leading, 7)
    }

    /// `HomeView.speechRow`の`reactionPips`と同じ色分け(pips >= 0は
    /// `changeUpColor`、負は`changeDownColor`)に揃える。
    private func pipsText(_ pips: Double) -> some View {
        Text(ValueFormat.number(pips, fractionDigits: 1, signed: true))
            .font(.system(size: 10, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(pips >= 0 ? HomeView.changeUpColor : HomeView.changeDownColor)
    }

    private static let headerFill = Color(red: 0.04, green: 0.18, blue: 0.36)
    private static let bodyGradient = LinearGradient(
        colors: [SettingsCardStyle.cardFill, Color(red: 0.03, green: 0.14, blue: 0.27)],
        startPoint: .top, endPoint: .bottom
    )

    private static let pairColumnWidth: CGFloat = 80
    private static let valueColumnWidth: CGFloat = (214 - 80) / 3
    private static let headerHeight: CGFloat = 22
    private static let rowHeight: CGFloat = 28

    private func cell(width: CGFloat, alignment: Alignment = .center, @ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: width, alignment: alignment)
            .frame(maxHeight: .infinity)
            .overlay(Rectangle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.5))
    }
}
