import SwiftUI

/// SCR-007 イベント詳細の本体(HQ指示 2026-10-09の参考画像)。上から、指標の
/// カード(国旗・名前・国|通貨・発表日時・重要度)、結果/予想/前回のカード、
/// 「主要通貨ペアの値動き(pips)」の表(1分・5分・15分)、通貨ペアを選んで
/// SCR-008 相場反応詳細へ進む。HQ指示(2026-10-09)で、ボタンをなくして表の各行
/// (`NavigationLink(value:)`)から直接進む形にした。
struct EventDetailCards: View {
    let response: EventDetailResponse
    /// この指標の次回発表予定(呼び出し側で読む)。無ければ表示しない。
    var nextRelease: Date? = nil

    /// HQ指示(2026-10-09)の表: 発表前は結果「未発表」、値動き「発表後に表示」、分析「発表後に分析」。
    var isReleased: Bool { response.event.status == .released }

    static let timeframes = ["1m", "5m", "15m"]

    var body: some View {
        // HQ指示(2026-10-12)「結果予想などをもう少し上に上げて」「各カードの
        // 間隔が詰まりすぎ」: header→resultsだけ詰め、それ以降のカード間は
        // 元の8に戻した(8→4の一律縮小だと他のカードまで詰まりすぎていた)。
        // HQ再指摘(2026-10-12、2回目)「まだ上に上げて」でさらに0まで詰めた。
        // HQ再指摘(2026-10-12、6回目)「結果、予想、前回の枠を少し下げて」:
        // 詰めすぎていたため0→4に戻した。
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                header
                results
            }
            // HQ指示(2026-10-09)の2枚目の参考画像: 見出しは表のカードの中、その下に
            // 「相場反応詳細」「過去イベント比較」のボタンと次回発表予定。分析の欄はなくした。
            reactionTable
            comparisonLink
            nextReleaseFooter
        }
        .frame(width: 214)
    }

    // MARK: - 指標のカード

    /// HQ指示(2026-10-12)「CPIの部分は折り返さないで。折り返す条件は
    /// （）の途中が1行で入り切らない場合に（）を2行目にすること」:
    /// 名前と日付+バッジを同じ行で横に並べると、「消費者物価指数(CPI)」の
    /// ような長めの名前が確実に収まるだけの横幅を保証できない(要人発言の
    /// 名前と同じ理由で3回試行錯誤した末の結論、`SpeechDetailCards.header`
    /// 参照)。名前の行と日付+バッジの行を分け、名前側が1行全体の横幅を
    /// 使えるようにした。
    private var header: some View {
        let event = response.event
        // HQ指示(2026-10-12)「タイトルが前回言ったことが治っていない
        // CPIの件」: ここだけ`IndicatorDetailCard.splitName`(国名接頭辞を
        // 残したまま括弧で割るだけ)を使っていたため「米国CPI」が消えて
        // いなかった。Home/検索と同じ`CountryFlag.indicatorDisplayName`
        // (国名接頭辞を取り除く)に揃えた。
        let display = CountryFlag.indicatorDisplayName(event.indicatorName, countryCode: event.countryCode, displayName: event.displayName)
        let combinedName = CountryFlag.indicatorDisplayText(event.indicatorName, countryCode: event.countryCode, displayName: event.displayName)
        // HQ指示(2026-10-13、2回目)「米国|USDの位置が指標名の下になるように」:
        // 国旗(34pt)と同じHStackの兄弟として2行目を置くと、国旗の高さ分
        // 2行目の位置が名前の直下からずれる。国旗はカラムとして分離し、
        // 名前+2行目(国|通貨+日時)を1つのVStackにまとめることで、国旗の
        // 高さに関係なく2行目が常に名前テキストの直下に来るようにした
        // (`SpeechDetailCards.header`と同じ構成)。
        return HStack(alignment: .top, spacing: 8) {
            CountryFlagView(countryCode: event.countryCode, diameter: 34)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top, spacing: 6) {
                    // 1行に収まる場合はそのまま、収まらない場合だけ
                    // 名前本体と(略称)を2行に分ける。
                    // HQ指示(2026-10-13、2回目)「消費者物価指数の文字サイズは
                    // 11にして」: 10.5→11。
                    ViewThatFits(in: .horizontal) {
                        NotoText.text(combinedName, size: 11).lineLimit(1)
                        VStack(alignment: .leading, spacing: 1) {
                            NotoText.text(display.main, size: 11).lineLimit(1).minimumScaleFactor(0.8)
                            if let abbreviation = display.abbreviation {
                                NotoText.text("（\(abbreviation)）", size: 11).lineLimit(1).minimumScaleFactor(0.8)
                            }
                        }
                    }
                    .foregroundStyle(.white)
                    Spacer(minLength: 4)
                    let colors = HomeView.importanceBadgeColors(event.importance)
                    NotoText.text(event.importance.rawValue, size: 7)
                        .tracking(-0.3)
                        .foregroundStyle(.white)
                        .frame(width: 34, height: 15)
                        .background(colors.fill, in: Capsule())
                        .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
                        // HQ指示(2026-10-12、6回目)「HIGHの位置を少し下げて」。
                        .padding(.top, 2)
                }
                HStack(spacing: 6) {
                    NotoText.text("\(CountryFlag.japaneseName(forCountry: event.countryCode))　|　\(event.currencyCode)", size: 8.5)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                    Spacer(minLength: 4)
                    // HQ指示(2026-10-12、6回目)「日時の文字サイズを0.5下げて」:
                    // 8.5→8。
                    // HQ指示(2026-10-14)「日時の文字色を米国｜USDと同じ色に」(要人発言詳細と同じ)。
                    NotoText.text("\(AppPreferences.shared.dateString(event.releaseDatetime)) \(AppPreferences.shared.timeString(event.releaseDatetime))", size: 8)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .lineLimit(1)
                }
            }
        }
        .padding(.leading, 10)
        .padding(.top, 10)
        // HQ指示(2026-10-12)「結果予想前回の枠をまだ上に上げて」:
        // 下側のパディングを縮め、resultsカードとの間隔をさらに詰めた。
        .padding(.bottom, 4)
        // HQ指示(2026-10-12)「HIGHと日時をもう少し右側に」: 右側だけ
        // パディングを縮め、カード右端に寄せた。
        .padding(.trailing, 4)
        .frame(width: 214, alignment: .leading)
    }

    // MARK: - 結果・予想・前回

    /// HQ指示(2026-10-25)「前年比を記載してください。また前月比の枠の大きさは
    /// 前年比と同じ大きさにしてください。1画面で収まるようにしてください」:
    /// 当初は結果/予想/前回のカードと前月比のカードを別々の2枚で出していたが、
    /// (1) 前年比側に見出しが無く2枚の見た目が揃わない、(2) カード2枚分の
    /// 背景・余白が重なって縦に伸び、1画面に収まらなくなる、という指摘を
    /// 受けた。1枚のカードの中に「前年比」「前月比」の2段(同じ3列構成)を
    /// 持たせる形にまとめ、見た目を揃えつつ余白を抑えた。副指標(前月比)が
    /// 無い指標(米国CPI以外、2026-10-25時点で全て)は1段のみ、見出しも出さない
    /// (従来1指標しか値が無い画面で「前年比」とだけ表示すると、YoY%が本来の
    /// 値ではない指標(NFP等)では誤った説明になるため)。
    private var results: some View {
        let snapshot = response.snapshot
        let unit = snapshot?.unit
        let released = response.event.status == .released
        let actual = released ? snapshot?.actual : nil
        let secondaryActual = released ? snapshot?.secondaryActual : nil
        let secondaryLabel = Self.secondaryLabel(snapshot?.secondaryValueKind)
        let primaryLabel = Self.primaryLabel(forSecondary: snapshot?.secondaryValueKind)

        return VStack(alignment: .leading, spacing: 3) {
            resultsRow(
                label: primaryLabel,
                actual: actual,
                forecast: snapshot?.forecast,
                previous: snapshot?.previous,
                unit: unit,
                released: released
            )
            if let secondaryLabel {
                Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.5)).frame(height: 0.5)
                resultsRow(
                    label: secondaryLabel,
                    actual: secondaryActual,
                    forecast: snapshot?.secondaryForecast,
                    previous: snapshot?.secondaryPrevious,
                    unit: unit,
                    released: released
                )
            }
        }
        // HQ指示(2026-10-12、4回目、参考画像)「結果予想の縦幅の違い」:
        // 8→6に詰めてカードの高さを参考画像に合わせた。
        // HQ指示(2026-10-13)「要人発言の発言枠が広すぎるから縦幅をもう
        // 少し小さくして」: 6→4→2にさらに詰め、`summaryCardMinHeight`も
        // 合わせて下げた(このカードの内容自体は新しいminHeightより
        // わずかに低いだけなので、この縮小をしないと従来どおり
        // `results`側だけ元の高さのまま残り、`statementCard`との位置が
        // また揃わなくなる)。
        .padding(.vertical, 2)
        // HQ指示(2026-10-12、8回目)「要人発言の通貨ペアはイベント詳細と
        // 同じ位置にして」: 要人発言側の`statementCard`(発言内容)はこの
        // `results`より内容が短く縦幅が小さいため、値動き表の開始位置が
        // 画面間でずれていた。両方に同じ`summaryCardMinHeight`を与え、
        // ヘッダーの下のカードの高さを揃えることで値動き表の位置も揃えた
        // (`SpeechDetailCards.statementCard`と対になる変更)。
        // `width:`(固定)と`minHeight:`(可変)は`frame`の別のオーバーロード
        // であり同じ呼び出しに混在できないため、`.frame`を2回に分けた。
        .frame(minHeight: Self.summaryCardMinHeight)
        .frame(width: 214)
        .background(GradientCardBackground())
    }

    private func resultsRow(label: String?, actual: Double?, forecast: Double?, previous: Double?, unit: String?, released: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let label {
                NotoText.text(label, size: 8)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .padding(.leading, 6)
            }
            HStack(spacing: 0) {
                resultColumn("結果", value: actual, unit: unit, note: nil, placeholder: released ? "--" : "未発表")
                divider
                resultColumn("予想", value: forecast, unit: unit, note: nil)
                divider
                resultColumn("前回", value: previous, unit: unit, note: Self.changeFromPrevious(actual: actual, previous: previous, unit: unit))
            }
        }
    }

    /// 副指標(前月比・前年比等)の見出し。`ingestion/types.ts`の`ValueKind`と同じ値。
    static func secondaryLabel(_ valueKind: String?) -> String? {
        switch valueKind {
        case "MOM_PCT": return "前月比"
        case "YOY_PCT": return "前年比"
        default: return nil
        }
    }

    /// 副指標があるときだけ、本来の値(`結果/予想/前回`)の見出しを出す。
    /// 現状の組み合わせは米国CPI(本来の値がYoY%、副指標がMoM%)のみだが、
    /// 逆の組み合わせ(本来の値がMoM%、副指標がYoY%)にも対応できるよう
    /// `secondaryLabel`と対になる組み合わせで判定する(api-design v1.35には
    /// 本来の値の種類を示すフィールドが無いため)。
    static func primaryLabel(forSecondary valueKind: String?) -> String? {
        switch valueKind {
        case "MOM_PCT": return "前年比"
        case "YOY_PCT": return "前月比"
        default: return nil
        }
    }

    /// `results`(イベント詳細)と`SpeechDetailCards.statementCard`(要人発言)
    /// の両方に使う共通の最低高さ。内容の短い方(通常は`statementCard`)を
    /// 底上げし、後に続く値動き表の開始位置を画面間で揃える。別ファイルの
    /// `SpeechDetailCards`から参照するため`private`にしない。
    static let summaryCardMinHeight: CGFloat = 50

    /// HQ指示(2026-10-25)で1枚のカードに前年比/前月比の2段を持たせるように
    /// なったため、固定の高さ(50)ではなく`maxHeight: .infinity`で行の実際の
    /// 高さに自動で合わせる(`resultsRow`のHStack内で使われる)。
    private var divider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 0.5).frame(maxHeight: .infinity)
    }

    private func resultColumn(_ title: String, value: Double?, unit: String?, note: String?, placeholder: String = "--") -> some View {
        // HQ指示(2026-10-09)「結果、予想、前回と数字、前回比を大きく中央に」。
        VStack(alignment: .center, spacing: 3) {
            NotoText.text(title, size: 9.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            Text(value.map { ValueFormat.withUnit($0, unit: unit) } ?? placeholder)
                .font(.system(size: 17, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            NotoText.text(note ?? " ", size: 8)
                .foregroundStyle(SettingsListLayout.sectionTitleColor)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, alignment: .center)
    }

    /// 「(前回比 -0.2%)」。結果と前回がそろっているときだけ。
    static func changeFromPrevious(actual: Double?, previous: Double?, unit: String?) -> String? {
        guard let actual, let previous else { return nil }
        let diff = actual - previous
        let text = ValueFormat.withUnit(abs(diff), unit: unit)
        let sign = diff > 0 ? "+" : diff < 0 ? "-" : "±"
        return "(前回比 \(sign)\(text))"
    }

    // MARK: - 主要通貨ペアの値動き

    /// 表に出す通貨ペア。Backendの`major_fx_reactions`(v1.17)を使い、無い古いBackendでは
    /// 関連通貨ペアの5分の値だけで作る。
    var pairs: [EventMajorFxReaction] {
        if let major = response.majorFxReactions, !major.isEmpty { return major }
        return response.relatedFxPairs.map { EventMajorFxReaction(fxPairId: $0.fxPairId, symbol: $0.symbol, reactions: [$0.reaction]) }
    }

    /// HQ指示(2026-10-09)「縦線と横線を交わらせたきれいな表に」: どのマスも同じ幅・
    /// 高さの枠で囲み、隣どうしの線を重ねて1本の罫線にする(経済カレンダーと同じ作り)。
    private var reactionTable: some View {
        // HQ指示(2026-10-12、7回目)「文字部分に背景色がある/枠があるので
        // 消して」: 見出しを表の枠(角丸カード)の外に出し、下線も外した
        // プレーンな見出しテキストに戻した。表(見出し行〜各通貨ペアの行)
        // 側のクリップ用背景(`AccountCardBackground`)は見出しの外に
        // あるため、見出し自体には色も枠も付かない。
        VStack(alignment: .leading, spacing: 6) {
            V5JPFont.text("主要通貨ペアの値動き（pips）", size: 10, weight: .semibold)
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
            ForEach(pairs) { pair in
                if isReleased {
                NavigationLink(value: AppRoute.movementDetail(
                    eventId: response.event.id,
                    indicatorId: response.event.indicatorId,
                    fxPairId: pair.fxPairId,
                    symbol: pair.symbol,
                    indicatorName: response.event.indicatorName,
                    releaseDatetime: response.event.releaseDatetime
                )) {
                HStack(spacing: 0) {
                    cell(width: Self.pairColumnWidth, alignment: .leading) { pairLabel(pair) }
                    ForEach(Self.timeframes, id: \.self) { timeframe in
                        cell(width: Self.valueColumnWidth) { pipsText(pair.reaction(for: timeframe)) }
                    }
                }
                .frame(height: Self.rowHeight)
                .contentShape(Rectangle())
                }
                .buttonStyle(SettingsRowPressStyle())
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(FXPairSymbol.displayName(pair.symbol))の相場反応を見る")
                .accessibilityAddTraits(.isButton)
                } else {
                    HStack(spacing: 0) {
                        cell(width: Self.pairColumnWidth, alignment: .leading) { pairLabel(pair) }
                        cell(width: Self.valueColumnWidth * 3) {
                            NotoText.text("発表後に表示", size: 8.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                        }
                    }
                    .frame(height: Self.rowHeight)
                }
            }
            if pairs.isEmpty {
                NotoText.text("値動きのデータはまだありません。", size: 8.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(width: 214, height: 34)
                    .overlay(Rectangle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.5))
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
        // クリップし、角丸をきちんと見えるようにした。
        .background(GradientCardBackground())
        .clipShape(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius))
    }

    /// 見出しの行: 本文と見分けがつく、少し明るい青(HQ指示 2026-10-09「もう少し明るく」)。
    private static let headerFill = Color(red: 0.04, green: 0.18, blue: 0.36)

    private func pairLabel(_ pair: EventMajorFxReaction) -> some View {
        HStack(spacing: 5) {
            // HQ指示(2026-10-12)「USD/JPYの国旗は2ついると思う、重なるように
            // 表示して」: 基軸通貨1つだけでなく、両方の通貨の国旗を重ねる。
            OverlappingPairFlags(symbol: pair.symbol, diameter: 13)
            NotoText.text(FXPairSymbol.displayName(pair.symbol), size: 9.5)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.leading, 7)
    }

    // MARK: - 過去イベント比較・次回発表予定

    /// HQ指示(2026-10-12、4回目、参考画像)「相場反応詳細の外枠のグラデー
    /// ション」: 他カードと同じ単色の枠線(`AccountCardBackground`)ではなく、
    /// `V5Button`と同じ青→シアンのグラデーションを枠線に使う。`comparisonLink`
    /// (過去イベント比較)が使う。相場反応詳細自体へのリンクは、HQ指示
    /// (2026-10-24)「相場反応枠はいらない。行タップで済む」により、値動き表の
    /// 各行のNavigationLinkのみに一本化した(別枠のボタンは削除)。
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

    /// HQ指示(2026-10-09)「イベント詳細には過去イベント比較ボタンを」。
    @ViewBuilder private var comparisonLink: some View {
        let symbol = response.relatedFxPairs.first?.symbol ?? pairs.first?.symbol
        let pairId = response.relatedFxPairs.first?.fxPairId ?? pairs.first?.fxPairId
        if let symbol, let pairId {
            NavigationLink(value: AppRoute.historicalComparison(
                indicatorId: response.event.indicatorId,
                indicatorName: response.event.indicatorName,
                fxPairId: pairId,
                fxPairSymbol: symbol
            )) {
                linkCard(icon: "clock.arrow.circlepath", title: "過去イベント比較")
            }
            .buttonStyle(SettingsRowPressStyle())
        }
    }

    @ViewBuilder private var nextReleaseFooter: some View {
        if let nextRelease {
            HStack(spacing: 6) {
                Image(systemName: "calendar")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(V5P.cyan)
                NotoText.text("次回発表予定", size: 8).foregroundStyle(SettingsCardStyle.subtitleColor)
                NotoText.text(IndicatorDetailCard.releaseLabel(nextRelease), size: 8.5).foregroundStyle(.white)
                Spacer()
            }
            .padding(.horizontal, 10)
            .frame(width: 214, height: 26)
            .background(GradientCardBackground())
        }
    }

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

    /// HQ指示(2026-10-12、6回目)「イベント詳細画面もプラスなら赤文字、
    /// マイナスなら緑で表現して」: `SpeechDetailCards.pipsText`(`HomeView.
    /// speechRow`の色分けに合わせた仮データ表)と同じ配色に揃えた。
    @ViewBuilder private func pipsText(_ reaction: EventReactionSummary?) -> some View {
        if let reaction, reaction.analysisStatus == .ready, let pips = reaction.pips {
            // HQ指示(2026-10-13、2回目)「-5.2の文字間隔をもう少し詰めて」。
            Text(ValueFormat.number(pips, fractionDigits: 1, signed: true))
                .font(.system(size: 10, weight: .semibold))
                .monospacedDigit()
                .tracking(-0.3)
                .foregroundStyle(pips >= 0 ? HomeView.changeUpColor : HomeView.changeDownColor)
        } else {
            Text("--")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(SettingsCardStyle.subtitleColor)
        }
    }
}
