import Foundation

/// Pro イベント別トレード戦略分析(api-design v1.48 `GET /events/{id}/strategy-analysis`、HQ指示 2026-11-06)。
/// 値はすべて Backend が保存済みの値動き・スナップショットから数えたもの。判定できない項目は nil(端末で作らない)。
struct StrategyAnalysisResponse: Decodable, Equatable {
    let eventId: String
    /// false = Pro の機能(`requiredEntitlement`)を持っていない。分析は返らない(ロック表示)。
    let available: Bool
    let requiredEntitlement: String?
    let fxPair: StrategyFxPair?
    /// nil = 比べる通貨ペアが無い(available が true のとき)。
    let analysis: StrategyAnalysis?

    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"
        case available
        case requiredEntitlement = "required_entitlement"
        case fxPair = "fx_pair"
        case analysis
    }
}

struct StrategyFxPair: Decodable, Equatable {
    let fxPairId: String
    let symbol: String

    enum CodingKeys: String, CodingKey {
        case fxPairId = "fx_pair_id"
        case symbol
    }
}

struct StrategyAnalysis: Decodable, Equatable {
    /// "READY" = 1分後の値動きを比べられた発表が `minimumSamples` 回以上。"DATA_PREPARING" = 足りない。
    let status: String
    let sampleWindow: Int
    let minimumSamples: Int
    let releases: [StrategyRelease]
    let summary: StrategySummary

    var isReady: Bool { status == "READY" }

    enum CodingKeys: String, CodingKey {
        case status
        case sampleWindow = "sample_window"
        case minimumSamples = "minimum_samples"
        case releases
        case summary
    }
}

struct StrategyRelease: Decodable, Equatable, Identifiable {
    let eventId: String
    let releaseDatetime: Date
    let forecast: Double?
    let actual: Double?
    let surprise: Double?
    let surpriseDirection: String?
    /// "UP" / "DOWN" / "FLAT"(1分後の pips の符号)。
    let direction1m: String?
    let pips1m: Double?
    let pips15m: Double?
    /// "CONTINUATION" / "REVERSAL"。
    let pattern15m: String?
    let highBreak15m: Bool?
    let lowBreak15m: Bool?
    let highBreak60m: Bool?
    let lowBreak60m: Bool?
    let sellTheFact: Bool?

    var id: String { eventId }

    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"
        case releaseDatetime = "release_datetime"
        case forecast
        case actual
        case surprise
        case surpriseDirection = "surprise_direction"
        case direction1m = "direction_1m"
        case pips1m = "pips_1m"
        case pips15m = "pips_15m"
        case pattern15m = "pattern_15m"
        case highBreak15m = "high_break_15m"
        case lowBreak15m = "low_break_15m"
        case highBreak60m = "high_break_60m"
        case lowBreak60m = "low_break_60m"
        case sellTheFact = "sell_the_fact"
    }
}

/// 項目ごとの件数。判定できた発表が `minimumSamples` 回未満の項目は nil(「分析データ準備中」。傾向を断定しない)。
struct StrategySummary: Decodable, Equatable {
    let direction1m: StrategyDirectionSummary?
    let breaks15m: StrategyBreakSummary?
    let breaks60m: StrategyBreakSummary?
    let pattern15m: StrategyPatternSummary?
    let sellTheFact: StrategySellTheFactSummary?

    enum CodingKeys: String, CodingKey {
        case direction1m = "direction_1m"
        case breaks15m = "breaks_15m"
        case breaks60m = "breaks_60m"
        case pattern15m = "pattern_15m"
        case sellTheFact = "sell_the_fact"
    }
}

struct StrategyDirectionSummary: Decodable, Equatable {
    let up: Int
    let down: Int
    let flat: Int
    let samples: Int
}

/// `high`・`low` はそれぞれ「上に抜けた回数」「下に抜けた回数」の合計で、両方抜けた回(`both`)を両方に含む
/// (HQ指示 2026-11-07「高値・安値ブレイクの表示」)。そのため `high + low` は `samples` を超えることがある
/// (`StrategyAnalysisText.breakOverlapNote` でその旨を示す)。`both`・`neither`(どちらも抜けていない)を
/// 足せば、高値のみ(`high - both`)・安値のみ(`low - both`)・両方・どちらもなしの4分類で `samples` に一致する。
struct StrategyBreakSummary: Decodable, Equatable {
    let high: Int
    let low: Int
    let both: Int
    let neither: Int
    let samples: Int
}

struct StrategyPatternSummary: Decodable, Equatable {
    let continuation: Int
    let reversal: Int
    let samples: Int
}

struct StrategySellTheFactSummary: Decodable, Equatable {
    let occurred: Int
    let samples: Int
}

/// 画面に出す文言(件数をそのまま書くだけ。傾向を言い切らない・売買を勧めない)。
enum StrategyAnalysisText {
    static let preparing = "分析データ準備中"

    /// 画面上部に出す注意書き(HQ指示 2026-11-07「イベント別トレード戦略分析の完成・統合」、画面上部に表示)。
    /// 既存の詳しい定義・注意事項(`notes`、画面下部)とは別に、常に最初に見える位置に置く。
    static let topDisclaimer = "過去の値動きの統計です。1分足の欠損などにより判定できない場合があります。売買推奨ではありません。"

    static func directionLine(_ summary: StrategyDirectionSummary?) -> String {
        guard let summary else { return preparing }
        var parts = ["上昇 \(summary.up)回", "下落 \(summary.down)回"]
        if summary.flat > 0 { parts.append("横ばい \(summary.flat)回") }
        return parts.joined(separator: "・") + "（\(summary.samples)回中）"
    }

    static func breakLine(_ summary: StrategyBreakSummary?) -> String {
        guard let summary else { return preparing }
        return "高値ブレイク \(summary.high)回・安値ブレイク \(summary.low)回（\(summary.samples)回中）"
    }

    /// HQ指示(2026-11-07)「件数の合計が対象イベント数を超える場合があることをUI上で誤解させない」: `breakLine`の
    /// 高値・安値の件数は両方抜けた回を両方に含むため、両方抜けた回数・どちらも抜けていない回数を添えて、
    /// 合計が発表数を超えうることを明示する。両方抜けた回が無い(誤解の余地が無い)ときは注記しない。
    static func breakOverlapNote(_ summary: StrategyBreakSummary?) -> String? {
        guard let summary else { return nil }
        guard summary.both > 0 else { return nil }
        return "うち両方抜けた回 \(summary.both)回・どちらも抜けていない回 \(summary.neither)回（高値・安値ブレイクの回数の合計が発表数を超えることがあります）"
    }

    static func patternLine(_ summary: StrategyPatternSummary?) -> String {
        guard let summary else { return preparing }
        return "続いた \(summary.continuation)回・反転 \(summary.reversal)回（\(summary.samples)回中）"
    }

    static func sellTheFactLine(_ summary: StrategySellTheFactSummary?) -> String {
        guard let summary else { return "\(preparing)（予想と結果がそろった発表が足りません）" }
        return "\(summary.occurred)回（結果が良かった\(summary.samples)回中）"
    }

    /// 1分後: "↑ +5.0" / "↓ -3.0" / "→ 0.0" / "--"。
    static func direction(_ release: StrategyRelease) -> String {
        guard let pips = release.pips1m else { return "--" }
        let arrow = pips > 0 ? "↑" : pips < 0 ? "↓" : "→"
        return "\(arrow) \(ValueFormat.number(pips, fractionDigits: 1, minimumFractionDigits: 1, signed: true))"
    }

    /// 1分の高値・安値を、その後に抜けたか: "高値・安値"(両方) / "高値"(高値のみ) / "安値"(安値のみ) /
    /// "なし"(どちらもなし) / "--"(判定できない)。HQ指示(2026-11-07)の5分類に対応する。
    static func breaks(high: Bool?, low: Bool?) -> String {
        guard let high, let low else { return "--" }
        switch (high, low) {
        case (true, true): return "高値・安値"
        case (true, false): return "高値"
        case (false, true): return "安値"
        case (false, false): return "なし"
        }
    }

    static func pattern(_ release: StrategyRelease) -> String {
        switch release.pattern15m {
        case "CONTINUATION": return "続いた"
        case "REVERSAL": return "反転"
        default: return "--"
        }
    }

    /// 結果 − 予想。予想が無い発表は "予想なし"(作らない)。
    static func surprise(_ release: StrategyRelease) -> String {
        guard let surprise = release.surprise else { return "予想なし" }
        return "予想比 \(ValueFormat.number(surprise, fractionDigits: 2, signed: true))"
    }

    static func sellTheFact(_ release: StrategyRelease) -> String {
        switch release.sellTheFact {
        case .some(true): return "該当"
        case .some(false): return "非該当"
        case .none: return "--"
        }
    }

    /// 件数の割合(例: "50.0%")。新しい画面デザイン(HQ指示 2026-11-07「画面デザインの変更」)の
    /// 色分けした件数タイルに添える。`samples`が0のときは作らない("--")。
    static func percentOfSamples(_ count: Int, _ samples: Int) -> String {
        guard samples > 0 else { return "--" }
        return ValueFormat.percent(Double(count) / Double(samples) * 100, fractionDigits: 1)
    }

    /// 発表ごとの実績の表で、高値・安値ブレイクを個別に出すためのセル文言("あり"/"なし"/"--")。
    static func breakCell(_ value: Bool?) -> String {
        guard let value else { return "--" }
        return value ? "あり" : "なし"
    }

    static let notes: [String] = [
        "過去の同じ指標の発表(この発表より前の直近5回)の値動きの回数を数えたもので、今後の値動きや売買の結果を示すものではありません。売買の推奨ではありません。",
        "高値・安値ブレイク: 発表後の最初の1分の高値・安値を、その後15分(60分)以内に上・下に抜けたかどうか。どちらが先に起きたかは判定していません。1分足が欠けている・検証できていない場合は判定していません(「--」)。",
        "反応: 1分後と15分後の値動きの向きが同じなら「続いた」、逆なら「反転」。",
        "Sell the Fact: 結果がその通貨にとって良かった(予想を良い方向に上回った)のに、15分後にその通貨が売られた方向に動いた回数。",
        "比べられた発表が3回未満の項目は、傾向を出さずに「分析データ準備中」としています。",
    ]
}
