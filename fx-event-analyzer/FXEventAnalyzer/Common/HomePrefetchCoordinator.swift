import Foundation

/// Splashの認証復元直後に`/home`・`/entitlements`を先行して取得し、`HomeViewModel`・
/// `PlanStore`がその結果を一度だけ再利用できるようにする(HQ指示 2026-11-05
/// 「Splash先行通信・Home Cache起動高速化」)。
///
/// ユーザーIDごとに1組のTaskだけを保持する。`consumeHome`/`consumeEntitlements`は、
/// 未消費のTaskがあれば返して消費済みにする(以後は`nil`)。呼び出し元
/// (`HomeViewModel.fetch()`・`PlanStore.load()`)は、`nil`が返れば従来どおり自分で
/// `apiClient.send(...)`を呼ぶ — 先行取得が無い・既に消費済み・ユーザーが違う、の
/// いずれでも安全にフォールバックする(認証復元前・未ログイン・先行取得を使わない
/// 既存の呼び出し元は、このコーディネーターに一切触れないため影響を受けない)。
///
/// Taskそのものはコーディネーターが保持し続ける。消費された後も、Splashが表示時間の
/// 上限(4秒)に達して先に進んだ場合でも、Taskはバックグラウンドで完了まで走り続け、
/// `HomeViewModel`・`PlanStore`が後から結果を受け取れる(この関数自体はTaskを
/// キャンセルしない)。
///
/// `FavoritesStore`/`PlanStore`/`HomeCacheStore`と同じ、`.shared`シングルトン+素の
/// `init()`(テストでは個別インスタンスを作って使う)というこのコードベースの既存
/// パターンに合わせる。
@MainActor
final class HomePrefetchCoordinator {
    static let shared = HomePrefetchCoordinator()

    private struct Prefetch {
        let userID: UUID
        /// `/home`の先行取得に使った`date`・`timezone`(`consumeHome`で、受け取る側の値と比べる)。
        let homeDate: String
        let homeTimezone: String
        let homeTask: Task<HomeResponse, Error>
        let entitlementsTask: Task<EntitlementsResponse, Error>
        var homeConsumed = false
        var entitlementsConsumed = false
    }

    private var prefetch: Prefetch?

    init() {}

    /// Splashの`authService.currentSession()`が成功して`userID`が分かった直後に呼ぶ
    /// (fire-and-forget — 呼び出し元は返り値の`Task`を、早期終了の判定にだけ使い、
    /// 結果そのものは待たない)。
    ///
    /// 同じユーザーIDで既に開始済みなら、新しいTaskは作らずその既存のTaskを返す
    /// (`SplashViewModel.retry()`からの再呼び出しに対する冪等性 — 二重に`/home`・
    /// `/entitlements`を叩かない)。別のユーザーID(ログイン切り替え)なら、古い
    /// Task・結果への参照は破棄して新しく始める — 前のユーザーの結果を新しい
    /// ユーザーに渡さない(古いTask自体はキャンセルしない。参照を手放すだけ)。
    @discardableResult
    func start(userID: UUID, apiClient: APIClient, now: () -> Date = Date.init) -> Task<HomeResponse, Error> {
        if let prefetch, prefetch.userID == userID {
            return prefetch.homeTask
        }
        DiagnosticsStore.shared.recordPrefetchStarted()
        let homeDate = Self.isoDateFormatter.string(from: now())
        let homeTimezone = TimeZone.current.identifier
        let endpoint = Self.homeEndpoint(date: homeDate, timezone: homeTimezone)
        let homeTask = Task<HomeResponse, Error> {
            // `HomeViewModel.fetch()`と同じ起動診断フックを、実際に通信を始める
            // この時点で呼ぶ — `HomeViewModel`側が後から消費したときに呼び直すと、
            // 通信開始時刻がSplash中の実際の時点ではなく消費時点にずれてしまう。
            await DiagnosticsStore.shared.beginHomeRequest()
            return try await apiClient.send(endpoint)
        }
        let entitlementsTask = Task<EntitlementsResponse, Error> {
            try await EntitlementsService(apiClient: apiClient).fetchEntitlements(timezone: TimeZone.current.identifier)
        }
        prefetch = Prefetch(
            userID: userID, homeDate: homeDate, homeTimezone: homeTimezone,
            homeTask: homeTask, entitlementsTask: entitlementsTask
        )
        return homeTask
    }

    /// `/home`の先行取得結果を一度だけ返す。2回目以降・別ユーザー・未開始なら`nil`
    /// (呼び出し元は従来どおり自分で取得する)。
    ///
    /// `date`・`timezone`は、呼び出し元がこれから表示・保存に使う値。先行取得に使った値と
    /// 違えば(Splash中に日付が変わった・バックグラウンドから翌日に戻った・端末のタイム
    /// ゾーンが変わった)、別の日の`/home`を今日の最新として出さないよう`nil`を返し、
    /// 先行取得は消費済みにする。
    func consumeHome(for userID: UUID, date: String, timezone: String) -> Task<HomeResponse, Error>? {
        guard var current = prefetch, current.userID == userID, !current.homeConsumed else { return nil }
        current.homeConsumed = true
        prefetch = current
        guard current.homeDate == date, current.homeTimezone == timezone else { return nil }
        return current.homeTask
    }

    /// `/entitlements`の先行取得結果を一度だけ返す。2回目以降・別ユーザー・未開始
    /// なら`nil`。
    func consumeEntitlements(for userID: UUID) -> Task<EntitlementsResponse, Error>? {
        guard var current = prefetch, current.userID == userID, !current.entitlementsConsumed else { return nil }
        current.entitlementsConsumed = true
        prefetch = current
        return current.entitlementsTask
    }

    /// テスト用・ログアウト時用: 保持している内容を消す(以後`start`は新規として扱う)。
    func reset() {
        prefetch = nil
    }

    /// HQ指示(2026-11-09「Build 25実機確認後の修正」): `HomeViewModel.fetch()`と同じ`days`
    /// (`HomeViewModel.weeklyEventsWindowDays`)を付ける。ここで付け忘れると、先行取得が
    /// 消費されたとき(通常経路)だけ「今日の重要イベント」相当の1日分が返り、Splashを経由しない
    /// 再取得時だけ週7日分になる、という経路依存の不整合が起きるため。
    private static func homeEndpoint(date: String, timezone: String) -> Endpoint {
        Endpoint(
            path: "home",
            queryItems: [
                URLQueryItem(name: "date", value: date),
                URLQueryItem(name: "timezone", value: timezone),
                URLQueryItem(name: "days", value: String(HomeViewModel.weeklyEventsWindowDays)),
            ]
        )
    }

    private static let isoDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        return formatter
    }()
}
