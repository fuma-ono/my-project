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
        // HQ指示(2026-10-12、2回目)「発言部分の枠もまだ上に上げて」:
        // header→statementCardだけ詰め、それ以降は通常の間隔(8)のまま。
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                header
                statementCard
            }
            reactionTable
            movementLink
            comparisonLink
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
            // HQ指示(2026-10-12、6回目)「経済指標や要人発言の位置を国旗
            // マークの下にして」: 日時の行にあった`categoryBadge`を、
            // アイコンの下に移した。`.overlay`で重ねる案も試したが、
            // `.overlay`は親のレイアウト上の高さに算入されないため、バッジが
            // 発言カードと縦に重なってしまった(CI screenshotで発覚、
            // `EventDetailCards.header`と同じ問題)。兄弟として並べる今の形に
            // 戻し、高さがきちんと確保されるようにした。
            VStack(spacing: 4) {
                Image(systemName: "person.crop.circle.fill")
                    .resizable()
                    .foregroundStyle(V5P.cyan)
                    .frame(width: 28, height: 28)
                categoryBadge
            }
            VStack(alignment: .leading, spacing: 4) {
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
                        // HQ指示(2026-10-12、6回目)「HIGHの位置を少し下げて」。
                        .padding(.top, 2)
                }
                HStack(spacing: 6) {
                    NotoText.text("\(CountryFlag.japaneseName(forCountry: speaker.countryCode))　|　\(speaker.organization)", size: 8.5)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                    Spacer(minLength: 4)
                    // HQ指示(2026-10-12、6回目)「日時の文字サイズを0.5下げて」:
                    // 8.5→8。
                    NotoText.text("\(AppPreferences.shared.dateString(response.statementDatetime)) \(AppPreferences.shared.timeString(response.statementDatetime))", size: 8)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }
            }
        }
        .padding(.leading, 10)
        .padding(.top, 10)
        // HQ指示(2026-10-12)「発言部分の枠もまだ上に上げて」: 下側の
        // パディングを縮め、発言カードとの間隔をさらに詰めた。
        .padding(.bottom, 4)
        // HQ指示(2026-10-12)「HIGHと日時をもう少し右側に」: 右側だけ
        // パディングを縮め、カード右端に寄せた。
        .padding(.trailing, 4)
        .frame(width: 214, alignment: .leading)
    }

    /// `NotificationListView`の要人発言の色(紫)・アイコン(`person.fill`)に
    /// 合わせた(`EventDetailCards.categoryBadge`の「経済指標」と対になる
    /// 要人発言の種別バッジ)。
    private var categoryBadge: some View {
        HStack(spacing: 3) {
            Image(systemName: "person.fill").font(.system(size: 6.5, weight: .semibold))
            NotoText.text("要人発言", size: 7).tracking(-0.3)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 5)
        .padding(.vertical, 2.5)
        .background(Self.categoryBadgeColor, in: Capsule())
    }

    private static let categoryBadgeColor = Color(red: 0.42, green: 0.30, blue: 0.92)

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
                // HQ指示(2026-10-12)「発言の部分の文字サイズを相場反応詳細の
                // 文字サイズと同じに」: `linkCard`のタイトル(10)に合わせた。
                NotoText.text("「\(summary)」", size: 10).foregroundStyle(.white)
            } else {
                NotoText.text("要約はまだ用意されていません。", size: 9).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        // HQ指示(2026-10-12、7回目)「発言の枠をもう少し大きくして」:
        // パディングを10→14に広げた。
        .padding(14)
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
            // HQ指示(2026-10-12、5回目、参考画像)「文字がデカすぎる、2くらい
            // 下げて」: 前回12にしたのは大きすぎたため10に戻した。
            V5JPFont.text("通貨ペア別の値動き（pips）", size: 10, weight: .semibold)
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
            // HQ指示(2026-10-12、2回目)「1分5分とかの見出しの色は戻して」:
            // 前回この見出し行の色を消したのは誤りだったため戻した。
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
        // HQ指示(2026-10-12、2回目)「主要通貨ペアの値動きの部分が色付け
        // されてる、そこを無くして」: 表全体のグラデーション塗り
        // (`bodyGradient`)を外し、カード背景にそのまま溶け込ませた
        // (マス目の罫線・見出し行の色は残す)。
        // HQ指示(2026-10-12、6回目)「だから表の角を丸くしてと言っている」:
        // タイトル行には塗りが無いため、`.clipShape`だけでは切り取る対象が
        // 無く丸みが見えていなかった。他のカードと同じ中立なカード背景
        // (`AccountCardBackground`、以前消したのは特別な青いグラデーション
        // (`bodyGradient`)であってこの中立な背景ではない)を敷いた上で
        // クリップし、角丸をきちんと見えるようにした
        // (`EventDetailCards.reactionTable`と同じ変更)。
        .background(AccountCardBackground())
        .clipShape(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius))
    }

    // MARK: - 相場反応詳細・過去イベント比較

    /// HQ指示(2026-10-12)「要人発言にも相場反応と過去イベントをつけて
    /// 遷移させるように」。`EventDetailCards`と違い、要人発言には遷移先が
    /// 必要とする本物の`eventId`/`indicatorId`/`fxPairId`が存在しない
    /// (上部のドキュメントコメント参照、pipsと同じ理由)。存在しないIDを
    /// 捏造して実在するかのように見せるより、`speechId`(実在はするが
    /// 別の種類のリソース)を代わりに渡し、遷移先のBackend呼び出しが正直に
    /// 「見つかりません」(各画面が既に持つ空状態)になる方を選んだ。
    /// HQ指示(2026-10-12、4回目、参考画像)「相場反応詳細の外枠のグラデー
    /// ション」: 他カードと同じ単色の枠線(`AccountCardBackground`)ではなく、
    /// `V5Button`と同じ青→シアンのグラデーションを枠線に使う
    /// (`EventDetailCards.linkCard`と同じ変更)。
    private func linkCard(icon: String, title: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(V5P.cyan)
                .frame(width: 18)
            NotoText.text(title, size: 10).foregroundStyle(.white)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 8, weight: .semibold))
                .foregroundStyle(V5P.cyan)
        }
        .padding(.horizontal, 10)
        .frame(width: 214, height: 32)
        .background(SettingsCardStyle.cardFill, in: RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
                .stroke(LinearGradient(colors: [V5P.cyan, V5P.blue.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 0.9)
        )
        .contentShape(Rectangle())
    }

    private var movementLink: some View {
        let pair = Self.placeholderReactions[0]
        return NavigationLink(value: AppRoute.movementDetail(
            eventId: response.speechId,
            indicatorId: response.speechId,
            fxPairId: response.speechId,
            symbol: pair.symbol,
            indicatorName: response.title,
            releaseDatetime: response.statementDatetime
        )) {
            linkCard(icon: "chart.bar.xaxis", title: "相場反応詳細")
        }
        .buttonStyle(SettingsRowPressStyle())
    }

    private var comparisonLink: some View {
        let pair = Self.placeholderReactions[0]
        return NavigationLink(value: AppRoute.historicalComparison(
            indicatorId: response.speechId,
            indicatorName: response.title,
            fxPairId: response.speechId,
            fxPairSymbol: pair.symbol
        )) {
            linkCard(icon: "clock.arrow.circlepath", title: "過去イベント比較")
        }
        .buttonStyle(SettingsRowPressStyle())
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

    /// 見出しの行: 本文と見分けがつく、少し明るい青(HQ指示 2026-10-09「もう少し明るく」)。
    private static let headerFill = Color(red: 0.04, green: 0.18, blue: 0.36)

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
