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
    /// 出典と告知(api-design v1.38)。取得元の規約が出典の表示・告知を求める要人(ECB・FRB)だけ付く。
    /// ECBは`notice`に規約が求める告知文、FRBは出典のみ(`notice`はnil)、それ以外・古いBackendはnil。
    var attribution: SpeechAttribution? = nil
    /// 発言時刻の精度(api-design v1.41)。`.exact`(発言の予定の時刻、従来の全件)か
    /// `.publicationTime`(ECB週間予定のポッドキャスト等、公開の時刻しか分からない)。
    /// `statementDatetime`はいずれの場合も入るが、`.publicationTime`のときは公開時刻であり、
    /// 実際の発言時刻そのものではないため、画面はそれを発言時刻として断定表示しない。
    /// 古いBackendでは項目自体が無いので`.exact`として扱う。
    var statementTimePrecision: StatementTimePrecision = .exact
    /// HQ決定(2026-11-10「要人発言の要約機能改善」)でB担当が設計する`summary_status`。
    /// 未作成(`summary`がnull)が「要約が無い」のか「作成中」「作成に失敗」なのか
    /// 区別できなかった問題への対応。B側はまだ設計中のため、項目自体が無い応答
    /// (現行Backend)では`nil`のまま(`SpeechDetailCards.summaryDisplay`が、
    /// 無いときは従来どおり`summary`の有無だけで判定する)。
    var summaryStatus: SpeechSummaryStatus? = nil

    enum CodingKeys: String, CodingKey {
        case reactions
        case speechId = "speech_id"
        case speaker
        case title
        case summary
        case statementDatetime = "statement_datetime"
        case importance
        case status
        case attribution
        case statementTimePrecision = "statement_time_precision"
        case summaryStatus = "summary_status"
    }

    // 合成される`init(from:)`は非Optionalの`statementTimePrecision`について、デフォルト値
    // ではなく`decode`(必須)を使ってしまい、項目自体が無い古いBackendの応答で
    // keyNotFoundになる。デフォルト値を実際に使うため手動で実装する。
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        speechId = try container.decode(String.self, forKey: .speechId)
        speaker = try container.decode(SpeechSpeaker.self, forKey: .speaker)
        title = try container.decode(String.self, forKey: .title)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        statementDatetime = try container.decode(Date.self, forKey: .statementDatetime)
        importance = try container.decode(Importance.self, forKey: .importance)
        status = try container.decode(SpeechStatus.self, forKey: .status)
        reactions = try container.decodeIfPresent([SpeechReaction].self, forKey: .reactions)
        attribution = try container.decodeIfPresent(SpeechAttribution.self, forKey: .attribution)
        statementTimePrecision = try container.decodeIfPresent(StatementTimePrecision.self, forKey: .statementTimePrecision) ?? .exact
        summaryStatus = try container.decodeIfPresent(SpeechSummaryStatus.self, forKey: .summaryStatus)
    }
}

/// HQ決定(2026-11-10「要人発言の要約機能改善」)。B担当が設計するAPIの`summary_status`。
/// 「要約が無い」を、未発言等の正当な状態(`NOT_AVAILABLE`)と、作成中(`GENERATING`)・
/// 作成に失敗(`FAILED`)とで区別できるようにする(現行は`summary: null`の1通りしかなく、
/// この3つが見分けられなかった)。`READY`は`summary`に実際の要約文字列が入る状態。
enum SpeechSummaryStatus: String, Decodable, Equatable {
    case notAvailable = "NOT_AVAILABLE"
    case generating = "GENERATING"
    case ready = "READY"
    case failed = "FAILED"
}

/// api-design v1.38(`domain/attribution.ts`のAttribution)。
struct SpeechAttribution: Decodable, Equatable {
    let source: String
    let sourceUrl: String
    /// 取得元の規約が求める告知文。nil = 告知の義務なし(出典の表示だけ)。
    let notice: String?

    enum CodingKeys: String, CodingKey {
        case source
        case sourceUrl = "source_url"
        case notice
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
