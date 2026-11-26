import Foundation

/// `GET /api/v1/fx-pairs/{fx_pair_id}/technical` の応答(テクニカル分析)。
/// 指標の配列はローソク足と同じ長さ・同じ並び(null=ウォームアップ中で描かない)。
/// 日時(`t`、足の開始時刻のUTC)は`URLSessionAPIClient`の`BackendDate`で読む。
struct TechnicalResponse: Decodable, Equatable {
    let data: TechnicalData
}

struct TechnicalData: Decodable, Equatable {
    let fxPairId: String?
    let symbol: String?
    let timeframe: String?
    let candles: [TechnicalCandle]
    let indicators: TechnicalIndicators?
    let keyZones: [TechnicalKeyZone]?
    let meta: TechnicalMeta?

    enum CodingKeys: String, CodingKey {
        case fxPairId = "fx_pair_id"
        case symbol
        case timeframe
        case candles
        case indicators
        case keyZones = "key_zones"
        case meta
    }
}

struct TechnicalCandle: Decodable, Equatable {
    let time: Date
    let open: Double
    let high: Double
    let low: Double
    let close: Double

    enum CodingKeys: String, CodingKey {
        case time = "t"
        case open = "o"
        case high = "h"
        case low = "l"
        case close = "c"
    }
}

struct TechnicalIndicators: Decodable, Equatable {
    var sma20: [Double?]?
    var ema50: [Double?]?
    var rsi14: [Double?]?
    var atr14: [Double?]?
    var macd: TechnicalMACD?
    var bollinger: TechnicalBollinger?
    var stoch: TechnicalStoch?
}

struct TechnicalMACD: Decodable, Equatable {
    var macd: [Double?]?
    var signal: [Double?]?
    var histogram: [Double?]?
}

struct TechnicalBollinger: Decodable, Equatable {
    var middle: [Double?]?
    var upper: [Double?]?
    var lower: [Double?]?
}

struct TechnicalStoch: Decodable, Equatable {
    var k: [Double?]?
    var d: [Double?]?
}

struct TechnicalKeyZone: Decodable, Equatable {
    /// "support" / "resistance" / "at_price"(知らない値も読めるよう文字列のまま)。
    let kind: String
    let lower: Double
    let upper: Double
    let center: Double?
    let touches: Int?
    let highTouches: Int?
    let lowTouches: Int?
    let firstT: Date?
    let lastT: Date?

    enum CodingKeys: String, CodingKey {
        case kind
        case lower
        case upper
        case center
        case touches
        case highTouches = "high_touches"
        case lowTouches = "low_touches"
        case firstT = "first_t"
        case lastT = "last_t"
    }
}

struct TechnicalRightsLedger: Decodable, Equatable {
    let entryId: String?
    let status: String?
    let features: [String]?
    let evidenceUrls: [String]?

    enum CodingKeys: String, CodingKey {
        case entryId = "entry_id"
        case status
        case features
        case evidenceUrls = "evidence_urls"
    }
}

struct TechnicalMeta: Decodable, Equatable {
    let timeframe: String?
    let convention: String?
    let barCount: Int?
    let requestedLimit: Int?
    let appliedLimit: Int?
    let sourceRowCapHit: Bool?
    let sourceBarCount: Int?
    let expectedSourceBars: Int?
    let hasGaps: Bool?
    let partialLast: Bool?
    let dataSource: String?
    let rightsLedger: TechnicalRightsLedger?

    enum CodingKeys: String, CodingKey {
        case timeframe
        case convention
        case barCount = "bar_count"
        case requestedLimit = "requested_limit"
        case appliedLimit = "applied_limit"
        case sourceRowCapHit = "source_row_cap_hit"
        case sourceBarCount = "source_bar_count"
        case expectedSourceBars = "expected_source_bars"
        case hasGaps = "has_gaps"
        case partialLast = "partial_last"
        case dataSource = "data_source"
        case rightsLedger = "rights_ledger"
    }
}

/// 時間足(APIの`timeframe`の値と表示名)。
enum TechnicalTimeframe: String, CaseIterable, Equatable {
    case m5 = "5m"
    case m15 = "15m"
    case m30 = "30m"
    case h1 = "60m"
    case h4 = "4h"
    case d1 = "1d"

    static let initial: TechnicalTimeframe = .h1

    var label: String {
        switch self {
        case .m5: return "5分"
        case .m15: return "15分"
        case .m30: return "30分"
        case .h1: return "1時間"
        case .h4: return "4時間"
        case .d1: return "日足"
        }
    }

    /// 日足は日付だけ、それ以外は日付+時刻で目盛りを出す。
    var isDaily: Bool { self == .d1 }
}

/// 下のパネルに出す指標。
enum TechnicalLowerPanel: String, CaseIterable, Equatable {
    case none
    case rsi
    case macd
    case stoch

    var label: String {
        switch self {
        case .none: return "なし"
        case .rsi: return "RSI"
        case .macd: return "MACD"
        case .stoch: return "ストキャス"
        }
    }
}

/// 指標の配列(ローソク足と同じ並び)から取り出した、描く点(nullを除く)。
struct TechnicalPoint: Equatable, Identifiable {
    let index: Int
    let value: Double
    var id: Int { index }
}

enum TechnicalSeries {
    /// 1回の取得の既定の本数(描画の負荷を抑える)。
    static let defaultLimit = 120
    /// 画面に一度に出す足の本数(これより多い分は横にスクロール)。
    static let visibleCandles = 60

    /// nullを除いた点。`candleCount`を超える位置は捨てる(配列が長くても足の数に合わせる)。
    static func points(_ values: [Double?]?, candleCount: Int) -> [TechnicalPoint] {
        guard let values else { return [] }
        var result: [TechnicalPoint] = []
        var index = 0
        for value in values {
            if index >= candleCount { break }
            if let value, value.isFinite {
                result.append(TechnicalPoint(index: index, value: value))
            }
            index += 1
        }
        return result
    }

    /// 足の数に合わせた長さにそろえる(短いときはnilで埋め、長いときは切る)。
    static func aligned(_ values: [Double?]?, candleCount: Int) -> [Double?] {
        var result: [Double?] = Array(repeating: nil, count: max(candleCount, 0))
        guard let values else { return result }
        var index = 0
        for value in values {
            if index >= result.count { break }
            result[index] = value
            index += 1
        }
        return result
    }

    /// 縦軸の範囲(安値の最小〜高値の最大と、追加の系列の最小〜最大)。足が無ければnil。
    static func priceRange(candles: [TechnicalCandle], extra: [[TechnicalPoint]]) -> (low: Double, high: Double)? {
        guard !candles.isEmpty else { return nil }
        var low = candles[0].low
        var high = candles[0].high
        for candle in candles {
            if candle.low < low { low = candle.low }
            if candle.high > high { high = candle.high }
        }
        for series in extra {
            for point in series {
                if point.value < low { low = point.value }
                if point.value > high { high = point.value }
            }
        }
        return (low, high)
    }

    /// 系列の最小〜最大(前後に1割の余白)。点が無いときはnil。
    static func valueRange(_ series: [[TechnicalPoint]]) -> (low: Double, high: Double)? {
        var low: Double? = nil
        var high: Double? = nil
        for line in series {
            for point in line {
                if let currentLow = low {
                    if point.value < currentLow { low = point.value }
                } else {
                    low = point.value
                }
                if let currentHigh = high {
                    if point.value > currentHigh { high = point.value }
                } else {
                    high = point.value
                }
            }
        }
        guard let lowValue = low, let highValue = high else { return nil }
        let span: Double = highValue - lowValue
        let pad: Double = span > 0 ? span * 0.1 : 1
        return (lowValue - pad, highValue + pad)
    }

    /// 縦軸の範囲に重なる帯だけを、範囲に切り詰めて返す(範囲外の帯は描かない)。
    static func clampedZones(_ zones: [TechnicalKeyZone]?, low: Double, high: Double) -> [TechnicalKeyZone] {
        guard let zones else { return [] }
        var result: [TechnicalKeyZone] = []
        for zone in zones {
            if zone.upper < low || zone.lower > high { continue }
            let lower: Double = max(zone.lower, low)
            let upper: Double = min(zone.upper, high)
            if upper < lower { continue }
            let clamped = TechnicalKeyZone(
                kind: zone.kind,
                lower: lower,
                upper: upper,
                center: zone.center,
                touches: zone.touches,
                highTouches: zone.highTouches,
                lowTouches: zone.lowTouches,
                firstT: zone.firstT,
                lastT: zone.lastT
            )
            result.append(clamped)
        }
        return result
    }
}

/// 画面に出す固定の文言と、応答の`meta`から作る注記。
enum TechnicalText {
    static let disclaimer = "テクニカル指標は過去の価格から計算した参考情報で、将来の値動きを保証するものではありません。投資の判断はご自身で行ってください。"

    /// データ源の出典の1行。`data_source`が無いときはnil(行を出さない)。
    static func attribution(_ meta: TechnicalMeta?) -> String? {
        guard let source = meta?.dataSource, !source.isEmpty else { return nil }
        return "価格データの提供元: \(source)"
    }

    /// 欠損・最後の足が未確定・取得上限の注記。
    static func notes(_ meta: TechnicalMeta?) -> [String] {
        guard let meta else { return [] }
        var lines: [String] = []
        if meta.hasGaps == true {
            lines.append("価格データに欠けている区間があります。指標の値は欠けた部分を含めて計算されている場合があります。")
        }
        if meta.partialLast == true {
            lines.append("最後の足はまだ確定していません。")
        }
        if meta.sourceRowCapHit == true {
            lines.append("元データの取得件数が上限に達したため、古い期間が含まれていない場合があります。")
        }
        return lines
    }
}
