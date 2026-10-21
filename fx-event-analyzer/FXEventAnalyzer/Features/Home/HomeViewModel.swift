import Combine
import Foundation

enum HomeState: Equatable {
    case loading
    /// No Backend base URL configured yet — distinct from a real failure.
    case backendNotConfigured
    case loaded(events: [HomeEventSummary], majorFx: [MajorFxSummary])
    case error(String)
    /// HQ決定(2026-10-21「起動の遅れの改善A1」): 前回保存したホームの内容を、
    /// `/home`の取得が終わるまでの間だけ鮮度表示付きで先に出す状態。
    /// `refreshFailed`は`/home`の取得が失敗した(かつ前回の内容を表示中の)
    /// ことを示す — その場合も前回の内容は消さず、帯の文言と再試行導線だけ
    /// 切り替える(`HomeSnapshotStore`のドキュメントコメント参照)。
    case showingSnapshot(HomeSnapshot, refreshFailed: Bool)
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
// HQ指示(2026-10-21)「要人発言一覧の初回表示改善」: `AppRoute.speechList`が
// このプレビュー配列を関連値として持つため(`Navigation/AppRoute.swift`
// 参照)、`AppRoute: Hashable`の自動合成に必要な分だけ`Hashable`を追加した。
// HQ決定(2026-10-21「起動の遅れの改善A1」): `HomeSnapshotStore`での保存に
// `Encodable`が必要なため追加(`Decodable`→`Codable`)。
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

    private let apiClient: APIClient
    private let favoritesStore: FavoritesStore
    private let snapshotStore: HomeSnapshotStore
    /// セッションからログイン中の利用者IDを取るためだけに使う(認証状態の
    /// 管理・取得自体はこれまで通り`AuthServicing`実装側が行う)。`nil`なら
    /// 前回データの先行表示は行わない(利用者を特定できないため)。
    private let authService: AuthServicing?
    private var cancellables = Set<AnyCancellable>()
    /// 起動後、前回データの先行表示を試みたか(1回の起動につき1回だけ)。
    /// タブ復帰等での再度の`load()`呼び出しでは、前回データへは戻さない
    /// (`load()`のドキュメントコメント参照)。
    private var hasAttemptedSnapshot = false

    init(apiClient: APIClient, favoritesStore: FavoritesStore = .shared, snapshotStore: HomeSnapshotStore = .shared, authService: AuthServicing? = nil) {
        self.apiClient = apiClient
        self.favoritesStore = favoritesStore
        self.snapshotStore = snapshotStore
        self.authService = authService
        favoritesStore.$entries
            .sink { [weak self] entries in
                Task { await self?.loadFavorites(entries) }
            }
            .store(in: &cancellables)
    }

    var upcomingEvents: [HomeEventSummary] {
        events(scheduledOnly: true)
    }

    var recentEvents: [HomeEventSummary] {
        events(scheduledOnly: false)
    }

    private func events(scheduledOnly: Bool) -> [HomeEventSummary] {
        let all: [HomeEventSummary]
        switch state {
        case .loaded(let events, _): all = events
        case .showingSnapshot(let snapshot, _): all = snapshot.events
        default: return []
        }
        return all.filter { scheduledOnly ? $0.status == .scheduled : $0.status == .released }
    }

    /// 前回データを表示中なら、その取得時刻(鮮度帯の表示に使う)。
    var snapshotFetchedAt: Date? {
        guard case .showingSnapshot(let snapshot, _) = state else { return nil }
        return snapshot.fetchedAt
    }

    /// 前回データを表示中かどうかと、取得の再試行が失敗したかどうか。
    var snapshotRefreshFailed: Bool {
        guard case .showingSnapshot(_, let refreshFailed) = state else { return false }
        return refreshFailed
    }

    /// `.task`からの初回呼び出しと、ホーム自身の`NavigationStack`へ戻った
    /// 際の再呼び出し(`HomeView`の`.onChange(of: path.count)`)の両方で
    /// 使われる。前回データの先行表示は**起動後最初の1回だけ**試みる —
    /// 2回目以降(詳細画面からの復帰等)でまで前回データに戻すと、既に
    /// 表示していた最新のデータを一時的に古いデータへ後退させてしまう
    /// ため(A1の対象はあくまで「起動直後」)。
    func load() {
        Task { await performLoad() }
    }

    private func performLoad() async {
        if !hasAttemptedSnapshot {
            hasAttemptedSnapshot = true
            await showSnapshotIfUsable()
        }
        // 前回データを表示中の間だけ、取得中もその表示を維持する
        // (`SpeechListViewModel.load()`の`.loadingWithPreview`と同じ考え方、
        // 再試行フラグだけ下ろす)。それ以外(`.loaded`を含む)は従来通り
        // 無条件に`.loading`へ戻す — `load()`は詳細画面からの復帰時にも
        // 呼ばれるため、この部分の挙動は変えていない。
        switch state {
        case .showingSnapshot(let snapshot, _):
            state = .showingSnapshot(snapshot, refreshFailed: false)
        default:
            state = .loading
        }
        await fetch()
    }

    /// 前回データが使える条件を満たせば`state`に反映する。使えない場合は
    /// 何もしない(通常の`.loading`のまま)。判定結果は起動診断にも記録する
    /// (「使った」理由も含め、HQ指示により失敗があっても断定せず記録のみ)。
    private func showSnapshotIfUsable() async {
        guard let authService, let userID = try? await authService.currentSession()?.userID.uuidString else {
            DiagnosticsStore.shared.recordHomeSnapshotOutcome(HomeSnapshotLoadResult.Outcome.userIDUnavailable.rawValue, ageSeconds: nil)
            return
        }
        let today = Self.isoDateFormatter.string(from: Date())
        let timezone = TimeZone.current.identifier
        let result = snapshotStore.load(userID: userID, requestedDate: today, requestedTimezone: timezone)
        DiagnosticsStore.shared.recordHomeSnapshotOutcome(result.outcome.rawValue, ageSeconds: result.ageSeconds)
        guard case .usable(let snapshot) = result else { return }
        state = .showingSnapshot(snapshot, refreshFailed: false)
        recentSpeeches = snapshot.speeches
        DiagnosticsStore.shared.recordHomeSnapshotShown()
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
            // HQ決定(2026-10-21「起動の遅れの改善A1」): 取得に成功したときだけ保存する。
            if let authService, let userID = try? await authService.currentSession()?.userID.uuidString {
                snapshotStore.save(HomeSnapshot(
                    events: response.events,
                    majorFx: response.majorFx,
                    speeches: response.speeches ?? [],
                    fetchedAt: Date(),
                    requestedDate: today,
                    requestedTimezone: timezone,
                    userID: userID
                ))
            }
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch {
            // 前回データを表示中の取得失敗は、既存のエラー画面ではなく
            // 「取得できなかった」帯+再試行に切り替える(前回データは消さない)。
            if case .showingSnapshot(let snapshot, _) = state {
                state = .showingSnapshot(snapshot, refreshFailed: true)
            } else {
                state = .error("イベント情報の取得に失敗しました。")
            }
        }
    }

    private func loadFavorites(_ entries: [FavoritesStore.Entry]) async {
        // ホームには先頭3件だけ。全件はお気に入り一覧(`FavoritesListView`)で出す。
        favoriteItems = await FavoriteItemLoader(apiClient: apiClient).load(Array(entries.prefix(3)))
    }

    private static let isoDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        return formatter
    }()
}
