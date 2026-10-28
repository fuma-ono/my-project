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
        // HQ指示(2026-10-13)「要人発言バッジはいらない、その分米国と
        // FRBと時刻を上にあげて」: categoryBadgeを削除し、2行目は国|組織
        // +日時だけにした。
        // HQ指示(2026-10-13、2回目)「米国|FRBの位置が指標名の下になる
        // ように」: アイコン(34pt)と同じHStackの兄弟として2行目を置くと、
        // アイコンの高さ分2行目の位置が名前の直下からずれる。アイコンは
        // カラムとして分離し、名前+2行目(国|組織+日時)を1つのVStackに
        // まとめることで、アイコンの高さに関係なく2行目が常に名前テキスト
        // の直下に来るようにした(`EventDetailCards.header`と同じ構成)。
        return HStack(alignment: .top, spacing: 8) {
            // HQ指示(2026-10-12)「要人発言者は国旗マークでいいのか？」:
            // 国旗は国を表すもので話者本人を表すものではないため、
            // 人物を表す汎用アイコンに変更した。実在の写真データは無く、
            // 捏造もしないため、国情報は下の「国|組織」の行にテキストで
            // 残す。人物アイコンの大きさは指標詳細のヘッダー国旗と
            // 同じ34ptに揃えた(HQ指示 2026-10-13)。
            // HQ指示(2026-10-13)「FRBは公式写真で、そのほかは頭文字と機関の色で」。
            SpeakerAvatar(name: speaker.name, organization: speaker.organization, countryCode: speaker.countryCode, photoURL: speaker.photoURL, size: 34)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top, spacing: 6) {
                    // 長い実名(「クリストファー・ウォラー」等)でも省略
                    // されないよう、1行に収まらなければ自然に2行へ折り返す。
                    // HQ指示(2026-10-13、2回目)「消費者物価指数の文字サイズは
                    // 11にして」(イベント詳細と同じサイズに揃える): 10.5→11。
                    // HQ指示(2026-10-15)「入りきらないときは姓だけに」(要人発言一覧と同じ):
                    // 名前の途中で2行に分かれないよう、フルネームが1行に入らなければ姓+肩書き。
                    ViewThatFits(in: .horizontal) {
                        NotoText.text("\(speaker.name)　\(speaker.title)", size: 11)
                            .lineLimit(1)
                            .fixedSize()
                        NotoText.text("\(SpeechListView.familyName(speaker.name))　\(speaker.title)", size: 11)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(.white)
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
                    // HQ指示(2026-10-14)「日時の文字色を米国｜FRBと同じ色に」。
                    NotoText.text("\(AppPreferences.shared.dateString(response.statementDatetime)) \(AppPreferences.shared.timeString(response.statementDatetime))", size: 8)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
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

    // MARK: - 発言内容

    /// HQ指示(2026-10-12)「発言の要約とかない」: 見出しラベルを外し、参考
    /// 画像どおり「」で囲んだ発言として表示する(`summary`は出典に基づく
    /// 要約であり一字一句そのままの引用ではないが、見た目は参考画像に
    /// 合わせる)。発言前・中止・要約未整備はラベルなしの状態文のみ。
    @ViewBuilder private var statementCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            if response.status == .scheduled {
                NotoText.text("この発言はまだ行われていません。", size: 10.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            } else if response.status == .cancelled {
                NotoText.text("この発言は中止されました。", size: 10.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            } else if let summary = response.summary {
                // HQ指示(2026-10-13、2回目)「発言の文字サイズは通貨ペアの
                // 値動き表記(pipsText、10)より0.5大きくして」: 10→10.5。
                NotoText.text("「\(summary)」", size: 10.5).foregroundStyle(.white)
            } else {
                NotoText.text("要約はまだ用意されていません。", size: 10.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        // HQ指示(2026-10-12、7回目)「発言の枠をもう少し大きくして」:
        // パディングを10→14に広げた。
        // HQ指示(2026-10-13、2回目)「発言の枠がまだ大きいから縦幅を
        // 小さくして。枠は2行入る想定の高さにして」: 14→10に縮め、
        // `summaryCardMinHeight`を2行分の高さを想定した値に下げた
        // (`results`側の縦パディングも合わせて詰め、両カードが同じ
        // 高さになるようにしている)。
        .padding(10)
        // HQ指示(2026-10-12、8回目)「要人発言の通貨ペアはイベント詳細と
        // 同じ位置にして」: この`statementCard`(発言内容、特に「この発言は
        // まだ行われていません。」のような1行の状態文)は`EventDetailCards.
        // results`(結果/予想/前回カード)より内容が短く縦幅が小さいため、
        // 値動き表の開始位置が画面間でずれていた。`EventDetailCards.
        // summaryCardMinHeight`と同じ最低高さを与えて揃えた。
        // `width:`(固定)と`minHeight:`(可変)は`frame`の別のオーバーロード
        // であり同じ呼び出しに混在できないため、`.frame`を2回に分けた。
        // HQ指示(2026-10-14)「1行しかないときは上下の中心に、文字を大きくして余白を目立たせない」:
        // 状態文を9→10.5(要約と同じ)にし、枠の中で上下の中心に置く。2行以上はそのまま枠いっぱいに並ぶ。
        .frame(minHeight: EventDetailCards.summaryCardMinHeight, alignment: .leading)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }

    // MARK: - 通貨ペア別の値動き(pips)

    /// 表示専用の仮データ(上部のドキュメントコメント参照)。4大通貨ペア×
    /// 1分/5分/15分。
    /// HQ指示(2026-10-15)「本番データを使用して機能を作成」: 発言前後の実際の価格から計算した値動き。
    private var reactions: [SpeechReaction] { response.reactions ?? [] }

    private var reactionTable: some View {
        // HQ指示(2026-10-12、7回目)「文字部分に背景色がある/枠があるので
        // 消して」: 見出しを表の枠(角丸カード)の外に出し、下線も外した
        // プレーンな見出しテキストに戻した(`EventDetailCards.reactionTable`
        // と同じ構成、「要人発言の通貨ペアはイベント詳細と同じ位置にして」
        // にも合わせて揃えた)。
        VStack(alignment: .leading, spacing: 6) {
            V5JPFont.text("通貨ペア別の値動き（pips）", size: 10, weight: .semibold)
                .foregroundStyle(.white)
            grid
        }
        .frame(width: 214, alignment: .leading)
    }

    private var grid: some View {
        VStack(spacing: 0) {
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
            if reactions.isEmpty {
                NotoText.text(response.status == .scheduled ? "発言後に値動きを表示します。" : "値動きのデータがありません。", size: 8.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(maxWidth: .infinity, minHeight: Self.rowHeight)
            }
            // HQ指示(2026-10-28)「要人発言詳細も相場反応詳細ボタンを消して。
            // 通貨を押したらその通貨の相場反応詳細に行くようにして」:
            // 別枠の「相場反応詳細」ボタン(常に先頭の通貨ペアだけに固定)を
            // 削除し、`EventDetailCards.grid`と同じく各行自体を
            // `NavigationLink`にして、押した通貨ペアの相場反応詳細に進む
            // ようにした。
            ForEach(reactions) { reaction in
                NavigationLink(value: AppRoute.speechMovementDetail(
                    speechId: response.speechId,
                    fxPairId: reaction.fxPairId,
                    symbol: reaction.symbol,
                    title: "\(response.speaker.name) \(response.title)",
                    statementDatetime: response.statementDatetime
                )) {
                    HStack(spacing: 0) {
                        cell(width: Self.pairColumnWidth, alignment: .leading) { pairLabel(reaction.symbol) }
                        cell(width: Self.valueColumnWidth) { pipsText(reaction.pips["1m"] ?? nil) }
                        cell(width: Self.valueColumnWidth) { pipsText(reaction.pips["5m"] ?? nil) }
                        cell(width: Self.valueColumnWidth) { pipsText(reaction.pips["15m"] ?? nil) }
                    }
                    .frame(height: Self.rowHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(SettingsRowPressStyle())
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(FXPairSymbol.displayName(reaction.symbol))の相場反応を見る")
                .accessibilityAddTraits(.isButton)
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
        .background(GradientCardBackground())
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
            // HQ指示(2026-10-13)「＞は10.5pt」。ボタンの枠に合わせて色は水色のまま。
            Image(systemName: "chevron.right")
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(V5P.cyan)
        }
        .padding(.horizontal, 10)
        .frame(width: 214, height: 32)
        .background(V5CardGradient.fill, in: RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
                .stroke(LinearGradient(colors: [V5P.cyan, V5P.blue.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 0.9)
        )
        .contentShape(Rectangle())
    }

    /// 値動きの表の先頭の通貨ペア(発言者の通貨のペア)。まだ値動きが無いとき(発言前)はnil。
    /// HQ指示(2026-10-28)で「相場反応詳細」の個別ボタン(`movementLink`、
    /// 常に先頭の通貨ペア固定)は削除し、表の各行から押した通貨ペアの
    /// 相場反応詳細に進むようにした(`grid`参照)。このプロパティ自体は
    /// `comparisonLink`の既定の通貨ペア(表の先頭、無ければサーバーが決める)
    /// として引き続き使う。
    private var firstReaction: SpeechReaction? { reactions.first }

    /// 過去イベント比較: 同じ要人の過去の発言と比べる(本番データ)。通貨ペアは表の先頭、無ければサーバーが決める。
    private var comparisonLink: some View {
        NavigationLink(value: AppRoute.speakerComparison(
            speakerId: response.speaker.speakerId,
            fxPairId: firstReaction?.fxPairId,
            symbol: firstReaction?.symbol
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
    private func pipsText(_ pips: Double?) -> some View {
        // HQ指示(2026-10-13、2回目)「-5.2の文字間隔をもう少し詰めて」。
        Text(pips.map { ValueFormat.number($0, fractionDigits: 1, signed: true) } ?? "--")
            .font(.system(size: 10, weight: .semibold))
            .monospacedDigit()
            .tracking(-0.3)
            .foregroundStyle(pips.map { $0 >= 0 ? HomeView.changeUpColor : HomeView.changeDownColor } ?? SettingsCardStyle.subtitleColor)
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
