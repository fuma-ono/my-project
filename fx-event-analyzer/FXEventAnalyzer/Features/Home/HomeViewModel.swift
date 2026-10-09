import Combine
import Foundation

enum HomeState: Equatable {
    case loading
    /// No Backend base URL configured yet — distinct from a real failure.
    case backendNotConfigured
    case loaded(events: [HomeEventSummary], majorFx: [MajorFxSummary])
    case error(String)
}

/// HQ指示(2026-10-02)「お気に入り」セクション用の軽量表示モデル。指標と
/// イベントは別々のAPIレスポンス形状を持つが、Homeのお気に入り行は両方とも
/// 同じコンパクトな見た目(国旗/通貨/名称/重要度バッジ)で表示するため、
/// 共通の最小限のフィールドだけを抜き出している。
enum HomeFavoriteItem: Identifiable, Equatable {
    /// HQ指摘(2026-10-03、6回目、新しい参考画像)「お気に入り」の小カードは
    /// 日付も表示する(例:「10/13 21:30」)ため、`releaseDatetime`を追加した
    /// — `EventDetailResponse.event.releaseDatetime`で既に取得済みの値を
    /// そのまま使うだけで、追加のAPI呼び出しは不要。
    ///
    /// `.indicator`の`nextReleaseDatetime`はHQ指示(2026-10-06)「お気に入り
    /// 欄の米国CPIの下にカレンダーアイコン 10/13 21:30みたいに書いて」で
    /// 追加。当初(2026-10-03)は「次回発表予定」に別APIコール
    /// (`/indicators/{id}/events`)が必要なため見送っていたが、
    /// `IndicatorDetailViewModel`が全く同じ目的で既に叩いている
    /// `/indicators/{id}/events?status=SCHEDULED&limit=1`をそのまま
    /// `fetchFavoriteIndicator`からも呼ぶようにした(新規エンドポイントは
    /// 追加していない)。該当イベントが無ければnilのままで、架空の日時は
    /// 表示しない。
    case event(id: String, countryCode: String, currencyCode: String, name: String, importance: Importance, releaseDatetime: Date)
    case indicator(id: String, countryCode: String, currencyCode: String, name: String, importance: Importance, nextReleaseDatetime: Date?)
    /// `FavoritesStore.ItemType.fxPair`と同じ理由で、まだ実際には生成
    /// されない(通貨ペア単体取得APIも★も無い)が、型は先に揃えてある。
    case fxPair(id: String, symbol: String, price: String, change: String, isUp: Bool)

    var id: String {
        switch self {
        case .event(let id, _, _, _, _, _): return "event:\(id)"
        case .indicator(let id, _, _, _, _, _): return "indicator:\(id)"
        case .fxPair(let id, _, _, _, _): return "fxPair:\(id)"
        }
    }
}

/// HQ指示(2026-10-02)「直近の要人発言: すでに発生した要人発言と、その後の
/// 値動き」。バックエンドに要人発言/中央銀行声明そのものを表すAPIが無い
/// (SCR-012/013は仮画面のみ、`api-design.md`にも該当エンドポイントなし、
/// `SpeechEvent`はdb-design.md/features.mdでP2指定)ため、実際の本番
/// バックエンドは`HomeResponse.speeches`を返さず、`recentSpeeches`は
/// 空配列のままになる(空状態表示)。
///
/// HQ指示(2026-10-06)「何か表示されるようにして」に伴い`Decodable`を追加
/// — CIのUIスクリーンショット用モックサーバーのみがこのフィールドを含む
/// 応答を返し、HomeのCIキャプチャで見た目を確認できるようにした。本番
/// バックエンドの挙動・データモデルは変更していない。
/// HQ指摘(2026-10-06、2回目、参考画像をピクセル単位で再確認)「発言前と
/// 現在それぞれの数字を付けて」「07:29ではなく10/2 07:29 | FRBのように」:
/// 1回目の実装時(上のコメント参照)は「存在しないデータを捏造しない」
/// 原則から`organization`/発言前後の実価格を省いていたが、この要人発言
/// セクション自体がCIのUIスクリーンショット用モックサーバーにのみ値を
/// 返させる方針(本番は常に空)である以上、他のフィールドと同列にモック
/// データとして追加しても原則には反しない(本番バックエンドの挙動・
/// データモデルは変わらない)。`reactionChangePercent`は発言前後の実価格
/// (`reactionPriceBefore`/`reactionPriceAfter`)と、Backendが計算済みの値
/// をそのまま表示する既存の`pips`系フィールド群(`EventDetailModels.swift`
/// 等)と同じ考え方の`reactionPips`に置き換えた — pipsをクライアント側で
/// 価格差から再計算しない(`Formatting.swift`冒頭コメント「iOS側でこれらを
/// 再計算して表示することを前提としない」に合わせた)。
struct HomeSpeechSummary: Decodable, Identifiable, Equatable {
    let id: String
    let countryCode: String
    let speakerName: String
    let statementDatetime: Date
    let headline: String
    let organization: String?
    let reactionFxSymbol: String?
    let reactionPriceBefore: Double?
    let reactionPriceAfter: Double?
    let reactionPips: Double?

    enum CodingKeys: String, CodingKey {
        case id = "speech_id"
        case countryCode = "country_code"
        case speakerName = "speaker_name"
        case statementDatetime = "statement_datetime"
        case headline
        case organization
        case reactionFxSymbol = "reaction_fx_symbol"
        case reactionPriceBefore = "reaction_price_before"
        case reactionPriceAfter = "reaction_price_after"
        case reactionPips = "reaction_pips"
    }
}

/// SCR-004 ホーム画面. Phase 3 §4: real `GET /home` connection —
/// `HomeView → HomeViewModel → APIClient → Backend API → DTO → UI`, no
/// fake production data. Splits the single day-scoped `events` array into
/// "今日の注目イベント" (mainly SCHEDULED) and "最近のイベント" (RELEASED)
/// itself, per api-design.md §12's H-2 resolution — the Backend does not
/// provide a separate field/endpoint for this.
///
/// HQ指示(2026-10-02)「ホーム画面の構成」: お気に入りセクション追加に伴い、
/// `FavoritesStore`(端末ローカル、`Common/FavoritesStore.swift`)の登録順
/// (新しい順)を購読し、変更があるたびに最大3件ぶんを`GET /events/{id}`・
/// `GET /indicators/{id}`で個別に解決する。お気に入りAPIは無いため、
/// 既存の単一アイテム取得APIを再利用している(新規エンドポイントは追加
/// していない)。取得に失敗した項目(削除済みなど)は静かに除外する。
@MainActor
final class HomeViewModel: ObservableObject {
    @Published private(set) var state: HomeState = .loading
    @Published private(set) var favoriteItems: [HomeFavoriteItem] = []
    /// `HomeResponse.speeches`のドキュメントコメント参照 — 本番バックエンドは
    /// このフィールドを返さないため、実際のユーザーには引き続き常に空配列
    /// (空状態表示)。CIのUIスクリーンショット用モックサーバーの応答にだけ
    /// 値が入っている。
    @Published private(set) var recentSpeeches: [HomeSpeechSummary] = []

    private let apiClient: APIClient
    private let favoritesStore: FavoritesStore
    private var cancellables = Set<AnyCancellable>()

    init(apiClient: APIClient, favoritesStore: FavoritesStore = .shared) {
        self.apiClient = apiClient
        self.favoritesStore = favoritesStore
        favoritesStore.$entries
            .sink { [weak self] entries in
                Task { await self?.loadFavorites(entries) }
            }
            .store(in: &cancellables)
    }

    var upcomingEvents: [HomeEventSummary] {
        guard case .loaded(let events, _) = state else { return [] }
        return events.filter { $0.status == .scheduled }
    }

    var recentEvents: [HomeEventSummary] {
        guard case .loaded(let events, _) = state else { return [] }
        return events.filter { $0.status == .released }
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    private func fetch() async {
        let today = Self.isoDateFormatter.string(from: Date())
        let timezone = TimeZone.current.identifier
        let endpoint = Endpoint(
            path: "home",
            queryItems: [
                URLQueryItem(name: "date", value: today),
                URLQueryItem(name: "timezone", value: timezone),
            ]
        )
        do {
            let response: HomeResponse = try await apiClient.send(endpoint)
            state = .loaded(events: response.events, majorFx: response.majorFx)
            recentSpeeches = response.speeches ?? []
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch {
            state = .error("イベント情報の取得に失敗しました。")
        }
    }

    private func loadFavorites(_ entries: [FavoritesStore.Entry]) async {
        var items: [HomeFavoriteItem] = []
        for entry in entries.prefix(3) {
            switch entry.type {
            case .event:
                if let item = await fetchFavoriteEvent(id: entry.id) {
                    items.append(item)
                }
            case .indicator:
                if let item = await fetchFavoriteIndicator(id: entry.id) {
                    items.append(item)
                }
            case .fxPair:
                // `FavoritesStore.ItemType.fxPair`のドキュメントコメント参照
                // — 単体取得APIも★も無いため、このtypeのエントリは実際には
                // 存在しない。来たとしても黙ってスキップする(捏造しない)。
                continue
            }
        }
        favoriteItems = items
    }

    private func fetchFavoriteEvent(id: String) async -> HomeFavoriteItem? {
        do {
            let response: EventDetailResponse = try await apiClient.send(Endpoint(path: "events/\(id)"))
            return .event(
                id: response.event.id,
                countryCode: response.event.countryCode,
                currencyCode: response.event.currencyCode,
                name: response.event.indicatorName,
                importance: response.event.importance,
                releaseDatetime: response.event.releaseDatetime
            )
        } catch {
            return nil
        }
    }

    private func fetchFavoriteIndicator(id: String) async -> HomeFavoriteItem? {
        do {
            async let detail: IndicatorDetailResponse = apiClient.send(Endpoint(path: "indicators/\(id)"))
            async let scheduled: IndicatorEventsListResponse = apiClient.send(
                Endpoint(
                    path: "indicators/\(id)/events",
                    queryItems: [
                        URLQueryItem(name: "status", value: "SCHEDULED"),
                        URLQueryItem(name: "limit", value: "1"),
                    ]
                )
            )
            let (response, scheduledResponse) = try await (detail, scheduled)
            return .indicator(
                id: response.indicator.id,
                countryCode: response.indicator.countryCode,
                currencyCode: response.indicator.currencyCode,
                name: response.indicator.name,
                importance: response.indicator.importance,
                nextReleaseDatetime: scheduledResponse.data.first?.releaseDatetime
            )
        } catch {
            return nil
        }
    }

    private static let isoDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        return formatter
    }()
}
