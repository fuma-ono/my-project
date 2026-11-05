import Foundation

/// SCR-008「値動きの分析」の文(HQ指示 2026-10-09)。AIは使わず、実際の値動きの数値と
/// 発表の結果・予想、指標ごとに人が書いた「一般的な見方」だけから、決まった型で作る。
/// 今回の値動きの理由を断定する文は作らない(要件定義書12章)。HQ指示で敬語ではなく
/// 「〜した」の形、同日の「分析が長い」で3文までに短くした。
enum MovementAnalysisText {
    /// HQ指示(2026-10-09)「文章だけでなく要点を分けて」: 事実(数値)の行と、解釈(一般的な見方)。
    struct Summary: Equatable {
        struct Row: Equatable {
            let label: String
            let value: String
            /// 正なら上昇(緑)、負なら下落(赤)、nilは白。
            let sign: Double?
        }

        let facts: [Row]
        let interpretation: String?
    }

    /// 例: 発表結果「予想を0.1ポイント下回る」/ 初動(1分)「-8.2 pips」/ 15分後「-41.3 pips」と、
    /// 解釈「米国CPIが予想を下回ると、…ドルが売られやすいとされる。」。データが足りなければnil。
    static func summary(
        reactions: [ReactionTimeframeEntry],
        actual: Double?,
        forecast: Double?,
        unit: String?,
        valueDecimals: Int? = nil,
        marketViewAbove: String? = nil,
        marketViewBelow: String? = nil
    ) -> Summary? {
        func ready(_ timeframe: String) -> ReactionTimeframeEntry? {
            reactions.first { $0.timeframe == timeframe && $0.analysisStatus == .ready && $0.pips != nil }
        }
        guard let first = ready("1m") ?? ready("5m"), let firstPips = first.pips else { return nil }
        var facts: [Summary.Row] = []
        var interpretation: String?
        if let actual, let forecast {
            // api-design v1.46: `valueDecimals`があれば、表示の桁に丸めた結果と予想どうしの差(イベント詳細の前回比と同じ)。
            let diff = ValueFormat.displayDifference(actual, forecast, decimals: valueDecimals)
            if diff == 0 {
                facts.append(.init(label: "発表結果", value: "予想どおり", sign: nil))
            } else {
                // 「%」の指標の差はポイントで書く(3.1%と3.2%の差は0.1ポイント)。
                let amount = unit == "%"
                    ? "\(ValueFormat.indicatorNumber(abs(diff), decimals: valueDecimals))ポイント"
                    : ValueFormat.withUnit(abs(diff), unit: unit, decimals: valueDecimals)
                facts.append(.init(label: "発表結果", value: "予想を\(amount)\(diff > 0 ? "上回る" : "下回る")", sign: nil))
                interpretation = diff > 0 ? marketViewAbove : marketViewBelow
            }
        }
        facts.append(.init(label: "初動（\(label(first.timeframe))）", value: signedPips(firstPips), sign: firstPips))
        // HQ指示(2026-11-04): 5分後もあれば並べる(初動が5分のときは重ねない)。
        if let middle = ready("5m"), middle.timeframe != first.timeframe, let middlePips = middle.pips {
            facts.append(.init(label: "5分後", value: signedPips(middlePips), sign: middlePips))
        }
        if let later = ready("15m"), later.timeframe != first.timeframe, let laterPips = later.pips {
            facts.append(.init(label: "15分後", value: signedPips(laterPips), sign: laterPips))
        }
        return Summary(facts: facts, interpretation: interpretation?.isEmpty == false ? interpretation : nil)
    }

    private static func signedPips(_ value: Double) -> String {
        "\(ValueFormat.number(value, fractionDigits: 1, signed: true)) pips"
    }

    /// 例:「結果は予想を0.1%下回った。米国CPIが予想を下回ると、…ドルが売られやすいとされる。
    /// 発表後1分で8.2pips、15分で41.3pips下落した。」データが足りなければnil(欄ごと出さない)。
    static func build(
        reactions: [ReactionTimeframeEntry],
        actual: Double?,
        forecast: Double?,
        unit: String?,
        valueDecimals: Int? = nil,
        marketViewAbove: String? = nil,
        marketViewBelow: String? = nil,
        subject: String? = nil,
        noun: String = "発表"
    ) -> String? {
        func ready(_ timeframe: String) -> ReactionTimeframeEntry? {
            reactions.first { $0.timeframe == timeframe && $0.analysisStatus == .ready && $0.pips != nil }
        }
        guard let first = ready("1m") ?? ready("5m"), let firstPips = first.pips else { return nil }

        var sentences: [String] = []
        if let actual, let forecast {
            let diff = ValueFormat.displayDifference(actual, forecast, decimals: valueDecimals)
            if diff == 0 {
                sentences.append("結果は予想どおりだった。")
            } else {
                let amount = ValueFormat.withUnit(abs(diff), unit: unit, decimals: valueDecimals)
                sentences.append("結果は予想を\(amount)\(diff > 0 ? "上回った" : "下回った")。")
                // HQ指示(2026-10-09)「なぜ下落したのかを表示したい」: 指標ごとに人が書いた
                // 「一般的な見方」を、上振れ・下振れに合わせて添える。
                if let view = diff > 0 ? marketViewAbove : marketViewBelow, !view.isEmpty {
                    sentences.append(view.hasSuffix("。") ? view : view + "。")
                }
            }
        }

        let firstLabel = label(first.timeframe)
        // イベント詳細では「USD/JPYは発表後…」と、どの通貨ペアの値動きかを書く。
        let lead = subject.map { "\($0)は" } ?? ""
        if let later = ready("15m"), later.timeframe != first.timeframe, let laterPips = later.pips {
            if laterPips != 0, (laterPips > 0) == (firstPips > 0) {
                sentences.append("\(lead)\(noun)後\(firstLabel)で\(pips(abs(firstPips)))、15分で\(pips(abs(laterPips)))\(direction(firstPips))した。")
            } else {
                sentences.append("\(lead)\(noun)後\(firstLabel)で\(pips(abs(firstPips)))\(direction(firstPips))したが、15分後には\(pips(abs(laterPips)))\(direction(laterPips))した。")
            }
        } else {
            sentences.append("\(lead)\(noun)後\(firstLabel)で\(pips(abs(firstPips)))\(direction(firstPips))した。")
        }
        return sentences.joined()
    }

    // MARK: - 相場反応の分析(HQ指示 2026-11-04「相場反応詳細画面の分析が表示されない問題を修正」)

    /// 「相場反応の分析」の文。実際の値動き(各時間の pips・最大の上下の幅)と、指標なら発表の結果・予想・前回
    /// だけから、決まった型で作る(AIは使わない)。今回の値動きの理由は断定しない。理由の根拠になるデータが無いときは
    /// `reasonUnavailable`を true にする(画面は「値動きの理由: 分析データ不足」)。
    struct ReactionAnalysis: Equatable {
        /// レベル1(値動きの事実)と、指標なら結果・予想・前回の関係。
        let sentences: [String]
        let reasonUnavailable: Bool
        /// レベル2: 過去の同じ発表・同じ要人の発言との比較。nilは比べられるデータが足りない(過去が3回未満など)。
        var comparison: [String]? = nil
        /// 要人発言の要約(発言の内容を知るため。値動きの原因とは結びつけない)。
        var statementSummary: String? = nil
    }

    /// 過去の同じ発表(または同じ要人の発言)の値動き。`surprise`は結果 − 予想(指標だけ。無ければnil)。
    struct PastReaction: Equatable {
        let id: String
        let pips: [String: Double]
        let surprise: Double?
    }

    /// 過去との比較に使う最小の回数。これより少なければ比較の文を出さない(HQ指示: 過去データが少ない場合は出さない)。
    static let minimumPastSamples = 3

    /// データが足りなければnil(画面は「分析データ不足」)。`selectedTimeframe`は画面で選んでいる時間
    /// (1分・5分・15分)で、その時間の最大の上下の幅の文が切り替わる。
    static func reactionAnalysis(
        reactions: [ReactionTimeframeEntry],
        selectedTimeframe: String,
        noun: String,
        actual: Double? = nil,
        forecast: Double? = nil,
        previous: Double? = nil,
        unit: String? = nil,
        valueDecimals: Int? = nil,
        hasGeneralView: Bool = false,
        past: [PastReaction]? = nil,
        statementSummary: String? = nil
    ) -> ReactionAnalysis? {
        func ready(_ timeframe: String) -> ReactionTimeframeEntry? {
            reactions.first { $0.timeframe == timeframe && $0.analysisStatus == .ready && $0.pips != nil }
        }
        var sentences: [String] = []

        // 1. 初動とその後の動きの関係(継続・反転・縮小・戻り)。
        if let first = ready("1m") ?? ready("5m"), let firstPips = first.pips,
           let later = [ready("15m"), ready("5m")].compactMap({ $0 }).first(where: { $0.timeframe != first.timeframe }),
           let laterPips = later.pips {
            let laterLabel = "\(label(later.timeframe))後"
            if firstPips == 0 {
                sentences.append(laterPips == 0
                    ? "初動・\(laterLabel)とも、ほぼ動かなかった。"
                    : "初動はほぼ動かず、\(laterLabel)に\(pips(abs(laterPips)))\(direction(laterPips))した。")
            } else if laterPips == 0 {
                sentences.append("初動は\(direction(firstPips))したが、\(laterLabel)には\(noun)前の水準に戻った。")
            } else if (laterPips > 0) != (firstPips > 0) {
                sentences.append("初動は\(direction(firstPips))だったが、\(laterLabel)には\(direction(laterPips))に転じた。")
            } else if abs(laterPips) >= abs(firstPips) * 1.5 {
                let ratio = ValueFormat.number(abs(laterPips) / abs(firstPips), fractionDigits: 1)
                sentences.append("初動の\(direction(firstPips))が続き、\(laterLabel)には初動の約\(ratio)倍の値幅になった。")
            } else if abs(laterPips) < abs(firstPips) {
                sentences.append("\(laterLabel)も初動と同じ\(direction(firstPips))だが、値幅は初動より小さくなった。")
            } else {
                sentences.append("初動の\(direction(firstPips))が\(laterLabel)まで続いた。")
            }
        }

        // 2. 選んでいる時間の値動きの特徴(最大の上下の幅と、終わりの位置)。
        if let entry = ready(selectedTimeframe), let close = entry.pips,
           let up = entry.maxUpwardPips, let down = entry.maxDownwardPips {
            let span = label(selectedTimeframe)
            sentences.append("\(span)の間に、最大で上に\(pips(max(up, 0)))、下に\(pips(abs(min(down, 0))))動いた。")
            if close < 0, down < 0, close <= down * 0.8 {
                sentences.append("\(span)後の価格は、この間の安値の近くだった。")
            } else if close > 0, up > 0, close >= up * 0.8 {
                sentences.append("\(span)後の価格は、この間の高値の近くだった。")
            }
        }
        guard !sentences.isEmpty else { return nil }

        // 3. 指標の発表なら、結果と予想・前回の関係(事実だけ。値動きの理由とは結びつけない)。
        if let actual {
            let versusForecast = forecast.map { forecast -> (continuing: String, ending: String) in
                let diff = ValueFormat.displayDifference(actual, forecast, decimals: valueDecimals)
                if diff == 0 { return ("予想どおりで", "予想どおりだった") }
                let amount = difference(abs(diff), unit: unit, decimals: valueDecimals)
                return diff > 0 ? ("予想を\(amount)上回り", "予想を\(amount)上回った") : ("予想を\(amount)下回り", "予想を\(amount)下回った")
            }
            let versusPrevious = previous.map { previous -> String in
                let diff = ValueFormat.displayDifference(actual, previous, decimals: valueDecimals)
                if diff == 0 { return "前回と同じだった" }
                return "前回より\(difference(abs(diff), unit: unit, decimals: valueDecimals))\(diff > 0 ? "高かった" : "低かった")"
            }
            switch (versusForecast, versusPrevious) {
            case let (forecastPart?, previousPart?): sentences.insert("結果は\(forecastPart.continuing)、\(previousPart)。", at: 0)
            case let (forecastPart?, nil): sentences.insert("結果は\(forecastPart.ending)。", at: 0)
            case let (nil, previousPart?): sentences.insert("結果は\(previousPart)。", at: 0)
            case (nil, nil): break
            }
        }

        // 4. 値動きの理由: 指標ごとに人が書いた一般的な見方(「主な要因」)が無ければ、根拠が無いので示さない。
        let currentSurprise: Double? = {
            guard let actual, let forecast else { return nil }
            return ValueFormat.displayDifference(actual, forecast, decimals: valueDecimals)
        }()
        return ReactionAnalysis(
            sentences: sentences,
            reasonUnavailable: !hasGeneralView,
            comparison: past.flatMap {
                pastComparison(reactions: reactions, selectedTimeframe: selectedTimeframe, past: $0, currentSurprise: currentSurprise)
            },
            statementSummary: statementSummary.flatMap { summary in
                let trimmed = summary.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return nil }
                return trimmed.count > 80 ? String(trimmed.prefix(80)) + "…" : trimmed
            }
        )
    }

    /// レベル2: 過去の同じ発表・発言との比較(HQ指示 2026-11-04「独自の相場分析」)。比べる時間は、選んでいる
    /// 1分・5分・15分(過去のデータがその3つだけのため。30分・60分を選んでいれば15分)。数えた回数だけを書き、
    /// 「だから今回動いた」とは書かない(相関と因果を分ける)。過去が`minimumPastSamples`回より少なければnil。
    static func pastComparison(
        reactions: [ReactionTimeframeEntry],
        selectedTimeframe: String,
        past: [PastReaction],
        currentSurprise: Double?
    ) -> [String]? {
        func ready(_ timeframe: String) -> Double? {
            reactions.first { $0.timeframe == timeframe && $0.analysisStatus == .ready }?.pips ?? nil
        }
        let timeframe = ["1m", "5m", "15m"].contains(selectedTimeframe) ? selectedTimeframe : "15m"
        guard let current = ready(timeframe) else { return nil }
        let samples = past.compactMap { $0.pips[timeframe] }
        guard samples.count >= minimumPastSamples else { return nil }
        let span = "\(label(timeframe))後"
        var lines: [String] = []

        // 値幅の大きさ: 今回と過去の平均(向きは問わず、値幅の絶対値)。
        let average = samples.map(abs).reduce(0, +) / Double(samples.count)
        if average > 0, let size = magnitudeLabel(current: current, average: average) {
            lines.append("今回の\(span)の値幅(\(pips(abs(current))))は、過去\(samples.count)回の平均(\(pips(average)))と比べて\(size)。")
        }
        // 向き: 過去に今回と同じ向きだった回数。
        if current != 0 {
            let same = samples.filter { $0 != 0 && ($0 > 0) == (current > 0) }.count
            lines.append("過去\(samples.count)回のうち、\(span)に今回と同じく\(direction(current))したのは\(same)回だった。")
        }
        // 反転の傾向: 初動(1分)と15分後の向きが逆になった回数と、今回。
        if let first = ready("1m"), let later = ready("15m"), first != 0, later != 0 {
            let pairs = past.compactMap { reaction -> (Double, Double)? in
                guard let a = reaction.pips["1m"], let b = reaction.pips["15m"], a != 0, b != 0 else { return nil }
                return (a, b)
            }
            if pairs.count >= minimumPastSamples {
                let reversed = pairs.filter { ($0.0 > 0) != ($0.1 > 0) }.count
                let now = (first > 0) != (later > 0) ? "反転した" : "反転しなかった"
                lines.append("過去\(pairs.count)回のうち、初動と15分後の向きが逆になった(反転した)のは\(reversed)回で、今回は\(now)。")
            }
        }
        // サプライズ別: 今回と同じ向きのサプライズ(予想を上回った・下回った)だった過去の回の値動き。
        if let surprise = currentSurprise, surprise != 0, current != 0 {
            let group = past.filter { ($0.surprise ?? 0) != 0 && (($0.surprise ?? 0) > 0) == (surprise > 0) }
                .compactMap { $0.pips[timeframe] }
            if group.count >= minimumPastSamples {
                let same = group.filter { $0 != 0 && ($0 > 0) == (current > 0) }.count
                let side = surprise > 0 ? "上回った" : "下回った"
                lines.append("過去に結果が予想を\(side)\(group.count)回のうち、\(span)に\(direction(current))したのは\(same)回だった。")
            }
        }
        guard !lines.isEmpty else { return nil }
        lines.append("(過去の回数を数えた結果で、今回の値動きの理由を示すものではない。)")
        return lines
    }

    private static func difference(_ value: Double, unit: String?, decimals: Int?) -> String {
        unit == "%"
            ? "\(ValueFormat.indicatorNumber(value, decimals: decimals))ポイント"
            : ValueFormat.withUnit(value, unit: unit, decimals: decimals)
    }

    static func label(_ timeframe: String) -> String {
        timeframe.hasSuffix("m") ? "\(timeframe.dropLast())分" : timeframe
    }

    /// HQ指示(2026-10-14)「過去の類似イベントとの比較」: 今回のpipsが過去の平均pipsに
    /// 対してどの程度かを、比率だけから決まった型で返す(AIは使わない)。平均が0なら
    /// 比較できないのでnil。
    static func magnitudeLabel(current: Double, average: Double) -> String? {
        guard average != 0 else { return nil }
        let ratio = abs(current) / abs(average)
        switch ratio {
        case ..<0.67: return "小さい"
        case 0.67..<0.87: return "やや小さい"
        case 0.87..<1.15: return "同程度"
        case 1.15..<1.5: return "やや大きい"
        default: return "大きい"
        }
    }

    private static func direction(_ value: Double) -> String {
        value > 0 ? "上昇" : value < 0 ? "下落" : "横ばい"
    }

    private static func pips(_ value: Double) -> String {
        "\(ValueFormat.number(value, fractionDigits: 1))pips"
    }
}
