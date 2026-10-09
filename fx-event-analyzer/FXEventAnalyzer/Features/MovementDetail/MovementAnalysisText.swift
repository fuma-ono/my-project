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
            let diff = actual - forecast
            if diff == 0 {
                facts.append(.init(label: "発表結果", value: "予想どおり", sign: nil))
            } else {
                // 「%」の指標の差はポイントで書く(3.1%と3.2%の差は0.1ポイント)。
                let amount = unit == "%" ? "\(ValueFormat.number(abs(diff)))ポイント" : ValueFormat.withUnit(abs(diff), unit: unit)
                facts.append(.init(label: "発表結果", value: "予想を\(amount)\(diff > 0 ? "上回る" : "下回る")", sign: nil))
                interpretation = diff > 0 ? marketViewAbove : marketViewBelow
            }
        }
        facts.append(.init(label: "初動（\(label(first.timeframe))）", value: signedPips(firstPips), sign: firstPips))
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
        marketViewAbove: String? = nil,
        marketViewBelow: String? = nil,
        subject: String? = nil
    ) -> String? {
        func ready(_ timeframe: String) -> ReactionTimeframeEntry? {
            reactions.first { $0.timeframe == timeframe && $0.analysisStatus == .ready && $0.pips != nil }
        }
        guard let first = ready("1m") ?? ready("5m"), let firstPips = first.pips else { return nil }

        var sentences: [String] = []
        if let actual, let forecast {
            let diff = actual - forecast
            if diff == 0 {
                sentences.append("結果は予想どおりだった。")
            } else {
                let amount = ValueFormat.withUnit(abs(diff), unit: unit)
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
                sentences.append("\(lead)発表後\(firstLabel)で\(pips(abs(firstPips)))、15分で\(pips(abs(laterPips)))\(direction(firstPips))した。")
            } else {
                sentences.append("\(lead)発表後\(firstLabel)で\(pips(abs(firstPips)))\(direction(firstPips))したが、15分後には\(pips(abs(laterPips)))\(direction(laterPips))した。")
            }
        } else {
            sentences.append("\(lead)発表後\(firstLabel)で\(pips(abs(firstPips)))\(direction(firstPips))した。")
        }
        return sentences.joined()
    }

    static func label(_ timeframe: String) -> String {
        timeframe.hasSuffix("m") ? "\(timeframe.dropLast())分" : timeframe
    }

    private static func direction(_ value: Double) -> String {
        value > 0 ? "上昇" : value < 0 ? "下落" : "横ばい"
    }

    private static func pips(_ value: Double) -> String {
        "\(ValueFormat.number(value, fractionDigits: 1))pips"
    }
}
