import Foundation

/// 前回取得したホームの表示データ(HQ承認 2026-11-02「ホーム画面のキャッシュ表示改善」)。
/// Render Freeの休止からの復帰を待つ間(実測で約20秒)も、前回の内容を先に出すために
/// 端末内(UserDefaults、1件・数KB)に保存する。
///
/// 保存するのはホームに出す表示データだけ(イベント・通貨ペア・要人発言・お気に入り)。
/// 未読数・通知の予約は保存しない(通知は今までどおり`LocalNotificationScheduler`の取得だけで決める)。
struct HomeCacheSnapshot: Codable, Equatable {
    /// 保存の形式の版。項目の意味を変えたら上げる(古い版は読まずに捨てる)。
    /// 2(HQ承認 2026-11-04「プラン確認前表示」): `planIndependent`を足した。
    static let currentFormatVersion = 2

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
    /// プランで内容が変わらないキャッシュか(HQ承認 2026-11-04「プラン確認前表示」)。保存したときに決める
    /// (`HomeCacheSnapshot.isPlanIndependent`)。trueで、イベントにロックが1件も無いときだけ、`/entitlements`で
    /// プランを確かめる前にも出す。
    var planIndependent: Bool

    /// 保存したときの「プランで変わらない」の判定。
    ///
    /// `/home`で FREE と PRO が違うのは、過去の発表を隠す仕組み(Backend `domain/pastReleaseAccess.ts`)だけ:
    /// 指標ごとに新しい順で`past_releases_max`件(FREE は3)を見せ、それより古い RELEASED を`locked`、
    /// その件数目の「前回」を`previous_locked`にする。アプリが求めるのは今日のホームだけで、今日の RELEASED は
    /// その指標の一番新しい発表(順番の0番目)なので、FREE の件数が2以上なら、どちらにも当たらない。
    /// - イベントに`locked`・`previous_locked`が1件でもあれば false(プランで内容が違う)。
    /// - 保存したときのプランが分からなければ false。
    /// - FREE の件数(`freePastReleasesMax`)が分からない・2未満なら false(FREE で保存しても同じ確認をする)。
    /// Backend の結合テスト(`home-plan-independence.test.ts`)が、今日の /home が FREE と PRO で同じことを見張る。
    static func isPlanIndependent(events: [HomeEventSummary], plan: String?, freePastReleasesMax: Int?) -> Bool {
        guard plan != nil, let freeMax = freePastReleasesMax, freeMax >= 2 else { return false }
        return !events.contains { $0.isLocked || $0.isPreviousLocked }
    }

    /// プランを確かめる前に出してよいか: 保存したときの印があり、今もイベントにロックが1件も無い。
    var canShowBeforePlanConfirmation: Bool {
        planIndependent && !events.contains { $0.isLocked || $0.isPreviousLocked }
    }
}

/// ホームのキャッシュを出してよいかを決める条件(呼び出し側が今の値を渡す)。
struct HomeCacheContext: Equatable {
    /// 認証済みの今のユーザー。nil(認証前・不明)なら決して出さない。
    var userID: UUID?
    var date: String
    var timezone: String
    /// 今のプラン。`PlanStore`がこの起動でまだ確かめていなければnil(未確定 → プランで変わらないキャッシュだけ出す)。
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
    /// プラン(HQ指示 2026-11-02「ホームキャッシュのプラン安全性修正」): ホームのイベントの値・ロックは
    /// プランで変わるため、`/entitlements`で今のプランを確かめるまでは出さない(未確認ならnilを返すが、
    /// 確認を待つので捨てない)。確かめたプランが保存時のプランと違う・保存時のプランが分からない
    /// ときは捨てる。確認に失敗したまま(`confirmedPlan`がnilのまま)なら、出さないまま。
    ///
    /// ただし(HQ承認 2026-11-04「プラン確認前表示」)、プランで内容が変わらないキャッシュ
    /// (`canShowBeforePlanConfirmation`)は、確かめる前にも出す。確かめた後は上と同じく比べ直す。
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
        guard let confirmedPlan = context.confirmedPlan else {
            return snapshot.canShowBeforePlanConfirmation ? snapshot : nil
        }
        guard let savedPlan = snapshot.plan, savedPlan == confirmedPlan else {
            clear()
            return nil
        }
        return snapshot
    }

    /// `GET /home`の成功時。`date`・`timezone`は要求に使った値。同じユーザーのお気に入りの中身は
    /// 引き継ぐ(お気に入りは別に取得するため)。`freePastReleasesMax`は FREE の過去の発表の件数
    /// (`planIndependent`の判定に使う。nilなら印を付けない)。
    func save(
        response: HomeResponse, date: String, timezone: String, userID: UUID, plan: String?, savedAt: Date,
        freePastReleasesMax: Int? = nil
    ) {
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
            favorites: favorites,
            planIndependent: HomeCacheSnapshot.isPlanIndependent(
                events: response.events, plan: plan, freePastReleasesMax: freePastReleasesMax
            )
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
    /// 保存したときのプランが未確定だったときは、ここで`planIndependent`も決める。
    @discardableResult
    func discardIfPlanDiffers(confirmedPlan: String, userID: UUID?, freePastReleasesMax: Int? = nil) -> Bool {
        guard var snapshot = stored() else { return false }
        guard let userID, snapshot.userID == userID else {
            clear()
            return true
        }
        if snapshot.plan == nil {
            snapshot.plan = confirmedPlan
            snapshot.planIndependent = HomeCacheSnapshot.isPlanIndependent(
                events: snapshot.events, plan: confirmedPlan, freePastReleasesMax: freePastReleasesMax
            )
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
