import Foundation

/// SCR-008「値動きの分析」の文(HQ指示 2026-10-09)。AIは使わず、実際の値動きの数値と
/// 発表の結果・予想だけから、決まった型で文を作る。値動きの理由(金利見通しなど)は
/// 数値から確かめられないので書かない(要件定義書12章「推測による説明は表示しない」)。
enum MovementAnalysisText {
    /// 例:「結果は予想を0.1%下回った。発表後1分で8.2pips下落した。その後も下落が続き、
    /// 15分後には41.3pips下落、60分後には52pips下落した。…」(HQ指示 2026-10-09で
    /// 敬語ではなく「〜した」の形に)。データが足りなければnil(欄ごと出さない)。
    static func build(
        reactions: [ReactionTimeframeEntry],
        actual: Double?,
        forecast: Double?,
        unit: String?
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
            }
        }

        let firstLabel = label(first.timeframe)
        sentences.append("発表後\(firstLabel)で\(pips(abs(firstPips)))\(direction(firstPips))した。")

        let later = ["15m", "60m"].compactMap(ready).filter { $0.timeframe != first.timeframe }
        // 15分後より60分後のほうが動きが小さい(戻した)ときは、そう書き分ける。
        if later.count == 2, let mid = later[0].pips, let end = later[1].pips,
           mid != 0, end != 0, (mid > 0) == (end > 0), (firstPips > 0) == (mid > 0), abs(end) < abs(mid), abs(mid) > abs(firstPips) {
            sentences.append("その後も\(direction(firstPips))が続き、15分後には\(pips(abs(mid)))\(direction(mid))したが、60分後には\(pips(abs(end)))まで戻した。")
        } else if let last = later.last, let lastPips = last.pips {
            let parts = later.compactMap { entry -> String? in
                guard let value = entry.pips else { return nil }
                return "\(label(entry.timeframe))後には\(pips(abs(value)))\(direction(value))"
            }
            let flow: String
            if firstPips == 0 || lastPips == 0 || (firstPips > 0) != (lastPips > 0) {
                flow = "その後は反対の方向に動き、"
            } else if abs(lastPips) > abs(firstPips) {
                flow = "その後も\(direction(firstPips))が続き、"
            } else {
                flow = "その後は動きが小さくなり、"
            }
            sentences.append(flow + parts.joined(separator: "、") + "した。")
        }

        let widest = ready("60m") ?? later.last ?? first
        if let up = widest.maxUpwardPips, let down = widest.maxDownwardPips {
            sentences.append("\(label(widest.timeframe))間の最大の上昇幅は\(signedPips(up))、最大の下落幅は\(signedPips(-abs(down)))だった。")
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

    private static func signedPips(_ value: Double) -> String {
        "\(ValueFormat.number(value, fractionDigits: 1, signed: true))pips"
    }
}
