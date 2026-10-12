import SwiftUI

/// SCR-013 要人発言詳細の本体。SCR-007 イベント詳細(`EventDetailCards`)と
/// 同じカード構成(話者のカード、発言内容のカード、通貨ペア別の値動き
/// (pips)の表)で統一する(HQ指示: 「イベント詳細画面とデザインは統一
/// して」)。HQ指示(2026-10-12)「タイトルの部分の枠はいらない」により、
/// 話者のカードだけ`AccountCardBackground`を持たない(発言内容のカードは
/// 引き続き持つ)。
///
/// `summary`(`GET /speeches/{id}`、api-design.md §14.5)は出典に基づく
/// 事実の「要約」であり発言の一字一句そのままの引用ではないが、HQ指示
/// (2026-10-12)「要人発言の構成は参考画像通りにして」により見た目は
/// 参考画像どおり「」で囲んで表示する。
///
/// 値動き(pips)については、要人発言には`EventDetailResponse.
/// majorFxReactions`(イベント専用の`GET /events/{id}`のフィールド、
/// api-design.md v1.17)に相当するものが存在しない(DBマイグレーション
/// `20261005000003_speeches.sql`のコメント「SpeechPriceReaction は
/// 引き続き対象外」)。HQ指示(2026-10-11)「値動きは仮のデータでいいから
/// 表示させて」により、実データが無くても参考画像どおりの見た目を仮の値
/// で表示する方針に確定。`placeholderReactions`はこのファイル内に閉じた
/// 表示専用の固定値で、APIレスポンス(`SpeechDetailResponse`)には含まれ
/// ない——Backendからの実データであるかのようには見せない。
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

    /// HQ指示(2026-10-12)の参考画像どおりの構成に作り直した:
    /// 1行目=名前+役職(左)・重要度バッジ(右)、2行目=国|組織(左)・日時(右)
    /// ——「HIGHの下に日時がある」の並びに合わせた。
    private var header: some View {
        let speaker = response.speaker
        return HStack(alignment: .top, spacing: 8) {
            // HQ指示(2026-10-12)「要人発言者は国旗マークでいいのか？」:
            // 国旗は国を表すもので話者本人を表すものではないため、人物を
            // 表す汎用アイコンに変更した。実在の写真データは無く、捏造も
            // しないため、国情報は下の「国|組織」の行にテキストで残す。
            Image(systemName: "person.crop.circle.fill")
                .resizable()
                .foregroundStyle(V5P.cyan)
                .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .top, spacing: 6) {
                    // 長い実名(「クリストファー・ウォラー」等)でも省略
                    // されないよう、1行に収まらなければ自然に2行へ折り返す。
                    NotoText.text("\(speaker.name)　\(speaker.title)", size: 10.5)
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    Spacer(minLength: 4)
                    let colors = HomeView.importanceBadgeColors(response.importance)
                    NotoText.text(response.importance.rawValue, size: 7)
                        .tracking(-0.3)
                        .foregroundStyle(.white)
                        .frame(width: 34, height: 15)
                        .background(colors.fill, in: Capsule())
                        .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
                }
                HStack(spacing: 6) {
                    NotoText.text("\(CountryFlag.japaneseName(forCountry: speaker.countryCode))　|　\(speaker.organization)", size: 8.5)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                    Spacer(minLength: 4)
                    NotoText.text("\(AppPreferences.shared.dateString(response.statementDatetime)) \(AppPreferences.shared.timeString(response.statementDatetime))", size: 7)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .lineLimit(1)
                }
            }
        }
        .padding(10)
        .frame(width: 214, alignment: .leading)
    }

    // MARK: - 発言内容

    /// HQ指示(2026-10-12)「発言の要約とかない」: 見出しラベルを外し、参考
    /// 画像どおり「」で囲んだ発言として表示する(`summary`は出典に基づく
    /// 要約であり一字一句そのままの引用ではないが、見た目は参考画像に
    /// 合わせる)。発言前・中止・要約未整備はラベルなしの状態文のみ。
    @ViewBuilder private var statementCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            if response.status == .scheduled {
                NotoText.text("この発言はまだ行われていません。", size: 9).foregroundStyle(SettingsCardStyle.subtitleColor)
            } else if response.status == .cancelled {
                NotoText.text("この発言は中止されました。", size: 9).foregroundStyle(SettingsCardStyle.subtitleColor)
            } else if let summary = response.summary {
                NotoText.text("「\(summary)」", size: 9.5).foregroundStyle(.white)
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
        // HQ指示(2026-10-12)「値動き部分の外枠はいらないから外して」:
        // 外周の角丸ストロークのみ削除。表内のマス目の罫線(`cell`)・
        // 背景の塗りはそのまま残す。
        .clipShape(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius))
    }

    private func pairLabel(_ symbol: String) -> some View {
        HStack(spacing: 5) {
            // HQ指示(2026-10-12)「USD/JPYの国旗は2ついると思う、重なるように
            // 表示して」。
            OverlappingPairFlags(symbol: symbol, diameter: 13)
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
