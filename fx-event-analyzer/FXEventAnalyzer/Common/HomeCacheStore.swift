import Foundation

/// 前回取得したホームの表示データ(HQ承認 2026-11-02「ホーム画面のキャッシュ表示改善」)。
/// Render Freeの休止からの復帰を待つ間(実測で約20秒)も、前回の内容を先に出すために
/// 端末内(UserDefaults、1件・数KB)に保存する。
///
/// 保存するのはホームに出す表示データだけ(イベント・通貨ペア・要人発言・お気に入り)。
/// 未読数・通知の予約は保存しない(通知は今までどおり`LocalNotificationScheduler`の取得だけで決める)。
struct HomeCacheSnapshot: Codable, Equatable {
    /// 保存の形式の版。項目の意味を変えたら上げる(古い版は読まずに捨てる)。
    static let currentFormatVersion = 1

    var formatVersion: Int
    /// 保存したときのログイン中のユーザー。違うユーザーには決して出さない。
    var userID: UUID
    /// `GET /home`の`date`(端末のタイムゾーンでのyyyy-MM-dd)と`timezone`。
    var date: String
    var timezone: String
    /// 保存したときに確定していたプラン(`EntitlementsResponse.Plan`の値)。未確定ならnil。
    var plan: String?
    var savedAt: Date
    var events: [HomeEventSummary]
    var majorFx: [MajorFxSummary]
    var speeches: [HomeSpeechSummary]
    var speechesStatus: HomeSpeechesStatus?
    /// ホームのお気に入り(先頭3件の中身)。お気に入りの登録そのものは`FavoritesStore`。
    var favorites: [HomeFavoriteItem]
}

/// ホームのキャッシュを出してよいかを決める条件(呼び出し側が今の値を渡す)。
struct HomeCacheContext: Equatable {
    /// 認証済みの今のユーザー。nil(認証前・不明)なら決して出さない。
    var userID: UUID?
    var date: String
    var timezone: String
    /// 今のプラン。`PlanStore`がこの起動でまだ確かめていなければnil(未確定 → キャッシュを出さない)。
    var confirmedPlan: String?
}

@MainActor
final class HomeCacheStore {
    static let shared = HomeCacheStore()

    /// 保存の時刻から、この時間を過ぎた通貨ペアの価格は「--」にする(古い価格を今の価格に見せない)。
    static let priceMaxAge: TimeInterval = 30 * 60

    private let defaults: UserDefaults
    private static let storageKey = "com.fumaono.fxeventanalyzer.homeCache"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// 条件に合うキャッシュだけを返す。合わないもの(ユーザー不明・不一致、日付・タイムゾーン・
    /// 形式の版の不一致、読めない)は捨てる。
    ///
    /// プラン(HQ指示 2026-11-02「ホームキャッシュのプラン安全性修正」、2026-11-09実機診断
    /// フォローアップで以下に変更): ホームのイベントの値・ロックはプランで変わるため、保存時の
    /// プランが分からない(`snapshot.plan == nil`)ときは決して出さない。保存時のプランが分かって
    /// いれば、`/entitlements`で今のプランをまだ確かめていなくても(`context.confirmedPlan == nil`)
    /// 保存時のプランを信用して先に出す — Renderのコールドスタート時は`/entitlements`自体も
    /// `/home`と同程度に遅れることが実機診断で確認でき、確認待ちにするとキャッシュが「無いのと
    /// ほぼ同じタイミングでしか出ない」(実機で実データ到着の1.4秒前)という本来の狙いに反する
    /// 結果になっていた。確認が済んだ時点で保存時のプランと違えば`discardIfPlanDiffers`が即座に
    /// 捨て、`HomeViewModel.planConfirmed()`が表示中のキャッシュを取り下げる(安全網は変更なし) —
    /// 違えば出し続けない、を保証したまま、分かっているプランまで待たせないようにした。
    func load(for context: HomeCacheContext) -> HomeCacheSnapshot? {
        guard let snapshot = stored() else { return nil }
        guard let userID = context.userID,
              snapshot.userID == userID,
              snapshot.formatVersion == HomeCacheSnapshot.currentFormatVersion,
              snapshot.date == context.date,
              snapshot.timezone == context.timezone
        else {
            clear()
            return nil
        }
        guard let savedPlan = snapshot.plan else {
            // 保存時のプランが分からない(`/entitlements`が一度も確定する前に`/home`が成功して
            // 保存された場合)。今のプランが分かっているなら比べようがないので捨てる。未確認
            // ならこのまま保持し、`discardIfPlanDiffers`が確定時に埋めるか捨てるかを決める。
            if context.confirmedPlan != nil { clear() }
            return nil
        }
        if let confirmedPlan = context.confirmedPlan, savedPlan != confirmedPlan {
            clear()
            return nil
        }
        return snapshot
    }

    /// `GET /home`の成功時。`date`・`timezone`は要求に使った値。同じユーザーのお気に入りの中身は
    /// 引き継ぐ(お気に入りは別に取得するため)。
    func save(response: HomeResponse, date: String, timezone: String, userID: UUID, plan: String?, savedAt: Date) {
        let previous = stored()
        let favorites = previous?.userID == userID ? previous?.favorites ?? [] : []
        write(HomeCacheSnapshot(
            formatVersion: HomeCacheSnapshot.currentFormatVersion,
            userID: userID,
            date: date,
            timezone: timezone,
            plan: plan,
            savedAt: savedAt,
            events: response.events,
            majorFx: response.majorFx,
            speeches: response.speeches ?? [],
            speechesStatus: response.speechesStatus,
            favorites: favorites
        ))
    }

    /// お気に入りの取得が終わったとき。同じユーザーのキャッシュがあるときだけ更新する。
    func saveFavorites(_ favorites: [HomeFavoriteItem], userID: UUID) {
        guard var snapshot = stored(), snapshot.userID == userID else { return }
        snapshot.favorites = favorites
        write(snapshot)
    }

    /// プランが確定したとき。保存時のプランが未確定なら確定した値を入れ、違えば捨てる。
    /// 捨てたらtrue(表示中のキャッシュも取り下げる)。
    @discardableResult
    func discardIfPlanDiffers(confirmedPlan: String, userID: UUID?) -> Bool {
        guard var snapshot = stored() else { return false }
        guard let userID, snapshot.userID == userID else {
            clear()
            return true
        }
        if snapshot.plan == nil {
            snapshot.plan = confirmedPlan
            write(snapshot)
            return false
        }
        if snapshot.plan != confirmedPlan {
            clear()
            return true
        }
        return false
    }

    /// ログアウト・アカウント削除・セッション切れ・ログイン画面への遷移で消す。
    func clear() {
        defaults.removeObject(forKey: Self.storageKey)
    }

    /// テスト用: 保存されているもの(条件を確かめずに)。
    func stored() -> HomeCacheSnapshot? {
        guard let data = defaults.data(forKey: Self.storageKey) else { return nil }
        return try? JSONDecoder().decode(HomeCacheSnapshot.self, from: data)
    }

    private func write(_ snapshot: HomeCacheSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }
}

extension HomeCacheSnapshot {
    /// キャッシュから出すイベント。発表の時刻を過ぎたSCHEDULEDは出さない(今の状態が分からないため)。
    func displayEvents(now: Date) -> [HomeEventSummary] {
        events.filter { !($0.status == .scheduled && $0.releaseDatetime <= now) }
    }

    /// キャッシュから出す通貨ペア。保存から`HomeCacheStore.priceMaxAge`を過ぎたら価格・変化を消す(表示は「--」)。
    func displayMajorFx(now: Date) -> [MajorFxSummary] {
        guard now.timeIntervalSince(savedAt) > HomeCacheStore.priceMaxAge else { return majorFx }
        return majorFx.map {
            MajorFxSummary(fxPairId: $0.fxPairId, symbol: $0.symbol, price: nil, change: nil, changePercent: nil, timestamp: $0.timestamp)
        }
    }

    /// キャッシュから出すお気に入り。今の登録(先頭3件)に残っているものだけ、登録の順で。
    func displayFavorites(entries: [FavoritesStore.Entry]) -> [HomeFavoriteItem] {
        let keys = entries.prefix(3).map { "\($0.type.rawValue):\($0.id)" }
        let byKey = Dictionary(favorites.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return keys.compactMap { byKey[$0] }
    }
}
