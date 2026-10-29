import Foundation

/// `GET /api/v1/speeches/{speech_id}` (api-design.md §14.5) — SCR-013の
/// 唯一のAPI呼び出し。応答はSpeechSummary(§14.4と同じ形)そのもの。
struct SpeechDetailResponse: Decodable, Equatable {
    let speechId: String
    let speaker: SpeechSpeaker
    let title: String
    /// 出典に基づく事実の要約。発言の一字一句そのままの引用ではない
    /// (api-design.md §14.4)。未発言・未作成は`nil`。
    let summary: String?
    let statementDatetime: Date
    let importance: Importance
    let status: SpeechStatus
    /// 発言前後の実際の価格から計算した値動き(api-design v1.28)。発言済みのときだけ入る。古いBackendではnil。
    var reactions: [SpeechReaction]? = nil
    /// 発言時刻の精度(api-design v1.41)。`.exact`(発言の予定の時刻、従来の全件)か
    /// `.publicationTime`(ECB週間予定のポッドキャスト等、公開の時刻しか分からない)。
    /// `statementDatetime`はいずれの場合も入るが、`.publicationTime`のときは公開時刻であり、
    /// 実際の発言時刻そのものではないため、画面はそれを発言時刻として断定表示しない。
    /// 古いBackendでは項目自体が無いので`.exact`として扱う。
    var statementTimePrecision: StatementTimePrecision = .exact

    enum CodingKeys: String, CodingKey {
        case reactions
        case speechId = "speech_id"
        case speaker
        case title
        case summary
        case statementDatetime = "statement_datetime"
        case importance
        case status
        case statementTimePrecision = "statement_time_precision"
    }
}

/// api-design v1.41。
enum StatementTimePrecision: String, Decodable, Equatable {
    case exact = "EXACT"
    /// 公開の時刻しか分からない(ECB週間予定のポッドキャスト等)。相場反応は計算されず
    /// (`reactions`は空)、要人ごとの過去比較・発言前の通知の対象にもならない(バックエンド側)。
    case publicationTime = "PUBLICATION_TIME"
}

struct SpeechSpeaker: Decodable, Equatable {
    let speakerId: String
    let name: String
    let title: String
    let organization: String
    let countryCode: String
    let currencyCode: String
    /// 公式写真のURL(FRB理事のみ、api-design v1.24)。無ければ頭文字と機関の色で表示する。
    var photoURL: String? = nil

    enum CodingKeys: String, CodingKey {
        case photoURL = "photo_url"
        case speakerId = "speaker_id"
        case name
        case title
        case organization
        case countryCode = "country_code"
        case currencyCode = "currency_code"
    }
}

/// api-design.md §14.4 — `EventStatus`(SCHEDULED/RELEASED/CANCELLED)とは
/// 別の語彙(発言はRELEASEDではなくDELIVERED)。
enum SpeechStatus: String, Decodable, Equatable {
    case scheduled = "SCHEDULED"
    case delivered = "DELIVERED"
    case cancelled = "CANCELLED"
}

/// `GET /speeches/{id}`の`reactions`の1件(api-design v1.28)。pipsのキーは"1m"/"5m"/"15m"、値が無ければnil。
struct SpeechReaction: Decodable, Equatable, Identifiable {
    let fxPairId: String
    let symbol: String
    let preStatementPrice: Double?
    let pips: [String: Double?]

    var id: String { fxPairId }

    enum CodingKeys: String, CodingKey {
        case fxPairId = "fx_pair_id"
        case symbol
        case preStatementPrice = "pre_statement_price"
        case pips
    }
}
