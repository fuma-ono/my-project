import Combine
import Foundation

enum HomeState: Equatable {
    case loading
    /// No Backend base URL configured yet — distinct from a real failure.
    case backendNotConfigured
    case loaded(events: [HomeEventSummary], majorFx: [MajorFxSummary])
    case error(String)
}

/// 表示中のデータが最新ではないことの案内(HQ承認 2026-11-02「ホーム画面のキャッシュ表示改善」)。
/// nil = 最新のデータ(何も出さない)。
enum HomeRefreshNotice: Equatable {
    /// 前回の情報(`savedAt`時点、端末のキャッシュ)を出して、更新中。
    case showingCache(savedAt: Date)
    /// 更新に失敗した。出しているデータの時点(キャッシュの保存時刻、または前回取得できた時刻)。
    case refreshFailed(savedAt: Date?)
}

/// HQ指示(2026-10-02)「お気に入り」セクション用の軽量表示モデル。指標と
/// イベントは別々のAPIレスポンス形状を持つが、Homeのお気に入り行は両方とも
/// 同じコンパクトな見た目(国旗/通貨/名称/重要度バッジ)で表示するため、
/// 共通の最小限のフィールドだけを抜き出している。
enum HomeFavoriteItem: Identifiable, Equatable, Codable {
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
// HQ指示(2026-10-21)「要人発言一覧の初回表示改善」: `AppRoute.speechList`が
// このプレビュー配列を関連値として持つため(`Navigation/AppRoute.swift`
// 参照)、`AppRoute: Hashable`の自動合成に必要な分だけ`Hashable`を追加した。
struct HomeSpeechSummary: Codable, Identifiable, Equatable, Hashable {
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
    /// 要人の公式写真のURL(FRB理事のみ、api-design v1.25)。無ければ頭文字で表示する。
    var speakerPhotoURL: String? = nil

    enum CodingKeys: String, CodingKey {
        case speakerPhotoURL = "speaker_photo_url"
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
    /// GET /home `speeches_status`(v1.34)。古いサーバーでは nil。`recentSpeeches` が空のときの文言にだけ使う。
    @Published private(set) var speechesStatus: HomeSpeechesStatus?
    /// キャッシュの表示中・更新の失敗の案内。nil = 最新のデータ。
    @Published private(set) var refreshNotice: HomeRefreshNotice?
    /// `GET /home`の最新のデータを反映するたびに増える(起動診断の「ホームの表示」を、キャッシュの
    /// 表示ではなく最新のデータの表示で記録するため、`HomeView`が見る)。
    @Published private(set) var freshDataVersion = 0

    private let apiClient: APIClient
    private let favoritesStore: FavoritesStore
    /// 認証済みの今のユーザー。nilならキャッシュを読まず・保存しない。
    private let userID: UUID?
    private let cacheStore: HomeCacheStore
    private let planStore: PlanStore
    private let now: () -> Date
    private var cancellables = Set<AnyCancellable>()
    /// 表示中のデータがキャッシュならその保存時刻。最新のデータならnil。
    private var displayedCacheSavedAt: Date?
    /// 最後に`GET /home`の最新のデータを反映した時刻。
    private var lastFreshAt: Date?
    /// お気に入りの中身をこの起動で取得できたか(取得できたらキャッシュのお気に入りで上書きしない)。
    private var hasFreshFavorites = false
    /// `GET /home`の取得中か(キャッシュを取り下げたとき、取得が終わっていれば取り直すため)。
    private var isFetching = false
    /// 最後の`GET /home`が失敗したか(プランを確かめた後にキャッシュを出すとき、案内を「更新できませんでした」にする)。
    private var lastFetchFailed = false

    /// 表示中のデータが端末のキャッシュか。
    var isShowingCache: Bool { displayedCacheSavedAt != nil }

    init(
        apiClient: APIClient,
        favoritesStore: FavoritesStore = .shared,
        userID: UUID? = nil,
        cacheStore: HomeCacheStore = .shared,
        planStore: PlanStore = .shared,
        now: @escaping () -> Date = Date.init
    ) {
        self.apiClient = apiClient
        self.favoritesStore = favoritesStore
        self.userID = userID
        self.cacheStore = cacheStore
        self.planStore = planStore
        self.now = now
        favoritesStore.$entries
            .sink { [weak self] entries in
                Task { await self?.loadFavorites(entries) }
            }
            .store(in: &cancellables)
        // プランが確かめられた・変わったら、キャッシュのプランと比べる(HQ指示 2026-11-02「プラン安全性修正」)。
        // 一致すれば、まだ最新のデータが無いときにキャッシュを出す。違えば捨て、表示中なら取り下げる。
        // (`@Published`は値が変わる前に流れるので、今の値はTaskの中で読む。)
        planStore.$isConfirmed.combineLatest(planStore.$plan)
            .sink { [weak self] _ in
                Task { @MainActor in self?.planConfirmed() }
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

    /// 表示中のデータがあれば消さずに更新する(通貨ペア編集から戻ったときなど)。無ければ、条件に合う
    /// キャッシュを先に出し、それも無ければ読み込み中にする。プランをまだ確かめていなければキャッシュは
    /// 出さず、確かめた時点(`planConfirmed`)で改めて出すかを決める。
    func load() {
        if case .loaded = state {
            // 表示を残したまま更新する。
        } else if let snapshot = cacheStore.load(for: cacheContext()) {
            applyCache(snapshot)
        } else {
            state = .loading
        }
        Task { await fetch() }
    }

    private func applyCache(_ snapshot: HomeCacheSnapshot, refreshFailed: Bool = false) {
        let current = now()
        state = .loaded(events: snapshot.displayEvents(now: current), majorFx: snapshot.displayMajorFx(now: current))
        recentSpeeches = snapshot.speeches
        speechesStatus = snapshot.speechesStatus
        if !hasFreshFavorites {
            favoriteItems = snapshot.displayFavorites(entries: favoritesStore.entries)
        }
        displayedCacheSavedAt = snapshot.savedAt
        refreshNotice = refreshFailed ? .refreshFailed(savedAt: snapshot.savedAt) : .showingCache(savedAt: snapshot.savedAt)
        // 起動診断: キャッシュの表示は、/homeの反映・ホームの表示の記録とは別に残す(既存の計測の意味を変えない)。
        DiagnosticsStore.shared.recordHomeCacheShown()
    }

    private func planConfirmed() {
        guard let userID, let plan = planStore.confirmedPlan else { return }
        let discarded = cacheStore.discardIfPlanDiffers(
            confirmedPlan: plan, userID: userID, freePastReleasesMax: freePastReleasesMax
        )
        if discarded {
            guard isShowingCache else { return }
            // 前のプランのときの内容は出さない。最新のデータが届くまで読み込み中にする
            // (取得がもう終わっていれば、取り直す)。
            displayedCacheSavedAt = nil
            refreshNotice = nil
            state = .loading
            if !hasFreshFavorites { favoriteItems = [] }
            if !isFetching { Task { await fetch() } }
            return
        }
        // プランが一致した: まだ何も出せていない(読み込み中・取得の失敗)ときだけ、キャッシュを出す。
        switch state {
        case .loading, .error:
            if let snapshot = cacheStore.load(for: cacheContext()) {
                applyCache(snapshot, refreshFailed: lastFetchFailed && !isFetching)
            }
        case .loaded, .backendNotConfigured:
            break
        }
    }

    /// FREE の過去の発表の件数(キャッシュの`planIndependent`の判定に使う)。FREE を確かめていれば
    /// `/entitlements`の値、そうでなければ(PRO・未確認)端末の FREE の決まり(`PlanLimits.free()`、Backend と同じ3)。
    private var freePastReleasesMax: Int? {
        if planStore.confirmedPlan == EntitlementsResponse.Plan.free.rawValue {
            return planStore.limits.pastReleasesMax
        }
        return PlanLimits.free().pastReleasesMax
    }

    private func cacheContext() -> HomeCacheContext {
        HomeCacheContext(
            userID: userID,
            date: Self.isoDateFormatter.string(from: now()),
            timezone: TimeZone.current.identifier,
            confirmedPlan: planStore.confirmedPlan
        )
    }

    private func fetch() async {
        isFetching = true
        defer { isFetching = false }
        let today = Self.isoDateFormatter.string(from: now())
        let timezone = TimeZone.current.identifier
        let endpoint = Endpoint(
            path: "home",
            queryItems: [
                URLQueryItem(name: "date", value: today),
                URLQueryItem(name: "timezone", value: timezone),
            ]
        )
        // HQ指示(2026-10-20)「起動診断画面」: この/home取得が何回目かを
        // `DiagnosticsStore`に伝える。APIClient.send()内の認証・通信・
        // デコードの計測は、1回目の取得中かどうかを`DiagnosticsStore`自身が
        // 判定して記録を受け付ける(2回目の修正、`DiagnosticsStore.swift`
        // 冒頭のコメント参照)。
        DiagnosticsStore.shared.beginHomeRequest()
        do {
            let response: HomeResponse = try await apiClient.send(endpoint)
            state = .loaded(events: response.events, majorFx: response.majorFx)
            DiagnosticsStore.shared.recordHomeStateApplied()
            recentSpeeches = response.speeches ?? []
            speechesStatus = response.speechesStatus
            let fetchedAt = now()
            lastFetchFailed = false
            displayedCacheSavedAt = nil
            lastFreshAt = fetchedAt
            refreshNotice = nil
            freshDataVersion += 1
            if let userID {
                cacheStore.save(
                    response: response, date: today, timezone: timezone,
                    userID: userID, plan: planStore.confirmedPlan, savedAt: fetchedAt,
                    freePastReleasesMax: freePastReleasesMax
                )
            }
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
            displayedCacheSavedAt = nil
            refreshNotice = nil
        } catch {
            lastFetchFailed = true
            if case .loaded = state {
                // キャッシュ・前回のデータを出したまま、更新できなかったことだけ知らせる。
                refreshNotice = .refreshFailed(savedAt: displayedCacheSavedAt ?? lastFreshAt)
            } else {
                state = .error("イベント情報の取得に失敗しました。")
            }
        }
    }

    private func loadFavorites(_ entries: [FavoritesStore.Entry]) async {
        // ホームには先頭3件だけ。全件はお気に入り一覧(`FavoritesListView`)で出す。
        let items = await FavoriteItemLoader(apiClient: apiClient).load(Array(entries.prefix(3)))
        // 取得に失敗した項目は静かに除外されるため、キャッシュを出している間に1件も取れなかったとき
        // (休止からの復帰待ち・圏外など)は、キャッシュのお気に入りを消さない。
        if items.isEmpty, !entries.isEmpty, isShowingCache { return }
        favoriteItems = items
        hasFreshFavorites = true
        if let userID { cacheStore.saveFavorites(items, userID: userID) }
    }

    private static let isoDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        return formatter
    }()
}
