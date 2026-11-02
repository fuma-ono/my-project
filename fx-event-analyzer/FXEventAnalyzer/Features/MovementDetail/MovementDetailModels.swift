import Foundation

/// `GET /api/v1/events/{event_id}/reaction?timeframe=all` (api-design.md
/// §18.1) — `pre_release_price` is common across timeframes and sits at
/// the top level; each timeframe's own values live in `reactions`.
struct ReactionAllTimeframesResponse: Decodable, Equatable {
    let eventId: String
    let fxPairId: String
    let preReleasePrice: Double?
    let reactions: [ReactionTimeframeEntry]
    /// api-design v1.45: 反応の起点(発表の時刻)の精度。古いBackend・null・知らない値はnil。
    var releaseDatetimePrecision: ReleaseDatetimePrecision? = nil

    enum CodingKeys: String, CodingKey {
        case eventId = "event_id"
        case fxPairId = "fx_pair_id"
        case preReleasePrice = "pre_release_price"
        case reactions
        case releaseDatetimePrecision = "release_datetime_precision"
    }
}

extension ReactionAllTimeframesResponse {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        eventId = try container.decode(String.self, forKey: .eventId)
        fxPairId = try container.decode(String.self, forKey: .fxPairId)
        preReleasePrice = try container.decodeIfPresent(Double.self, forKey: .preReleasePrice)
        reactions = try container.decode([ReactionTimeframeEntry].self, forKey: .reactions)
        releaseDatetimePrecision = ReleaseDatetimePrecision.lenient(from: container, forKey: .releaseDatetimePrecision)
    }
}

struct ReactionTimeframeEntry: Decodable, Equatable, Identifiable {
    let timeframe: String
    let postReleasePrice: Double?
    let movement: Double?
    let pips: Double?
    let changePercent: Double?
    let maxUpward: Double?
    let maxDownward: Double?
    let maxUpwardPips: Double?
    let maxDownwardPips: Double?
    let analysisStatus: DataQualityStatus
    /// api-design v1.44。古いBackend・知らない値ではnil。
    var reactionState: ReactionState? = nil

    var id: String { timeframe }

    enum CodingKeys: String, CodingKey {
        case timeframe
        case postReleasePrice = "post_release_price"
        case movement
        case pips
        case changePercent = "change_percent"
        case maxUpward = "max_upward"
        case maxDownward = "max_downward"
        case maxUpwardPips = "max_upward_pips"
        case maxDownwardPips = "max_downward_pips"
        case analysisStatus = "analysis_status"
        case reactionState = "reaction_state"
    }
}

extension ReactionTimeframeEntry {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        timeframe = try container.decode(String.self, forKey: .timeframe)
        postReleasePrice = try container.decodeIfPresent(Double.self, forKey: .postReleasePrice)
        movement = try container.decodeIfPresent(Double.self, forKey: .movement)
        pips = try container.decodeIfPresent(Double.self, forKey: .pips)
        changePercent = try container.decodeIfPresent(Double.self, forKey: .changePercent)
        maxUpward = try container.decodeIfPresent(Double.self, forKey: .maxUpward)
        maxDownward = try container.decodeIfPresent(Double.self, forKey: .maxDownward)
        maxUpwardPips = try container.decodeIfPresent(Double.self, forKey: .maxUpwardPips)
        maxDownwardPips = try container.decodeIfPresent(Double.self, forKey: .maxDownwardPips)
        analysisStatus = try container.decode(DataQualityStatus.self, forKey: .analysisStatus)
        reactionState = ReactionState.decode(from: container, forKey: .reactionState)
    }
}

/// `GET /api/v1/events/{event_id}/reaction/chart` (api-design.md §19) — a
/// single timeframe's OHLC candles for the Release -30min/+60min window.
struct ChartResponse: Decodable, Equatable {
    let eventId: String
    let fxPairId: String
    let timeframe: String
    let releaseDatetime: Date
    let prices: [ChartPricePoint]
    /// 表示範囲(api-design v1.19)。古いBackendではnil(端末で同じ規則を計算する)。
    var windowFrom: Date? = nil
    var windowTo: Date? = nil
    /// api-design v1.45: `releaseDatetime`の精度。APPROXIMATEなら発表の印に「約」を付ける。古いBackend・null・知らない値はnil。
    var releaseDatetimePrecision: ReleaseDatetimePrecision? = nil

    enum CodingKeys: String, CodingKey {
        case windowFrom = "window_from"
        case windowTo = "window_to"
        case eventId = "event_id"
        case fxPairId = "fx_pair_id"
        case timeframe
        case releaseDatetime = "release_datetime"
        case prices
        case releaseDatetimePrecision = "release_datetime_precision"
    }
}

extension ChartResponse {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        eventId = try container.decode(String.self, forKey: .eventId)
        fxPairId = try container.decode(String.self, forKey: .fxPairId)
        timeframe = try container.decode(String.self, forKey: .timeframe)
        releaseDatetime = try container.decode(Date.self, forKey: .releaseDatetime)
        prices = try container.decode([ChartPricePoint].self, forKey: .prices)
        windowFrom = try container.decodeIfPresent(Date.self, forKey: .windowFrom)
        windowTo = try container.decodeIfPresent(Date.self, forKey: .windowTo)
        releaseDatetimePrecision = ReleaseDatetimePrecision.lenient(from: container, forKey: .releaseDatetimePrecision)
    }
}

/// api-design v1.45: APPROXIMATEの発表の値動きの詳細に出す注記(HQ指示 2026-11-02)。
/// EXACT・nil(古いBackend)・知らない値・DATE_ONLY・UNKNOWNではnil(注記を出さない)。
enum ReactionTimingNotice {
    static func text(precision: ReleaseDatetimePrecision?, releaseTimeLabel: String) -> String? {
        guard precision == .approximate else { return nil }
        return "発表の時刻は概算（\(releaseTimeLabel)）です。値動きは概算の時刻を起点に計算しています。"
    }
}

struct ChartPricePoint: Decodable, Equatable, Identifiable {
    let timestamp: Date
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let volume: Double?

    var id: Date { timestamp }
}
