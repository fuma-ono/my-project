import XCTest
@testable import FXEventAnalyzer

/// HQ承認(2026-11-02)「ホーム画面のキャッシュ表示改善」: 前回のホームのデータを端末に保存し、次の起動で先に出す。
/// 出してよいのは、同じユーザー・同じ日付とタイムゾーン・同じ形式の版・同じプランのときだけ。
@MainActor
final class HomeCacheTests: XCTestCase {
    private let userA = UUID()
    private let userB = UUID()
    private let today = "2026-11-02"
    private let now = Date(timeIntervalSince1970: 1_793_600_000) // 2026-11-02 08:13:20Z
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "HomeCacheTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    // MARK: - HomeCacheStore

    func testRoundTripKeepsValueDecimalsAndLockState() throws {
        let store = HomeCacheStore(defaults: defaults)
        let event = Self.event(id: "e1", status: .released, at: now.addingTimeInterval(-3600), valueDecimals: 1, locked: true, previousLocked: true)
        store.save(response: response(events: [event]), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now)

        let loaded = try XCTUnwrap(store.load(for: context(userA, plan: "PRO")))
        XCTAssertEqual(loaded.events, [event])
        XCTAssertEqual(loaded.events.first?.valueDecimals, 1)
        XCTAssertEqual(loaded.events.first?.locked, true)
        XCTAssertEqual(loaded.events.first?.previousLocked, true)
        XCTAssertEqual(loaded.events.first?.requiredPlan, "PRO")
        XCTAssertEqual(loaded.majorFx, [Self.pair])
        XCTAssertEqual(loaded.speeches.map(\.id), ["s1"])
        XCTAssertEqual(loaded.speechesStatus, Self.speechesStatus)
        XCTAssertEqual(loaded.savedAt, now)
    }

    func testAnotherUserNeverSeesTheCacheAndItIsDiscarded() {
        let store = HomeCacheStore(defaults: defaults)
        store.save(response: response(), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now)

        XCTAssertNil(store.load(for: context(userB, plan: "PRO")))
        XCTAssertNil(store.stored(), "a cache of another user must be discarded")
    }

    func testUnknownUserNeverSeesTheCacheAndItIsDiscarded() {
        let store = HomeCacheStore(defaults: defaults)
        store.save(response: response(), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now)

        XCTAssertNil(store.load(for: context(nil, plan: "PRO")))
        XCTAssertNil(store.stored())
    }

    func testMismatchedDateTimezonePlanOrFormatVersionIsNotUsed() throws {
        let cases: [(String, (inout HomeCacheContext) -> Void, ((inout HomeCacheSnapshot) -> Void)?)] = [
            ("date", { $0.date = "2026-11-03" }, nil),
            ("timezone", { $0.timezone = "America/New_York" }, nil),
            ("plan", { $0.confirmedPlan = "FREE" }, nil),
            ("formatVersion", { _ in }, { $0.formatVersion = HomeCacheSnapshot.currentFormatVersion + 1 }),
            ("savedPlanUnknown", { _ in }, { $0.plan = nil }),
        ]
        for (name, changeContext, changeSnapshot) in cases {
            let store = HomeCacheStore(defaults: defaults)
            store.save(response: response(), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now)
            if let changeSnapshot {
                var snapshot = try XCTUnwrap(store.stored())
                changeSnapshot(&snapshot)
                defaults.set(try JSONEncoder().encode(snapshot), forKey: "com.fumaono.fxeventanalyzer.homeCache")
            }
            var ctx = context(userA, plan: "PRO")
            changeContext(&ctx)
            XCTAssertNil(store.load(for: ctx), "\(name) mismatch must not use the cache")
            XCTAssertNil(store.stored(), "\(name) mismatch must discard the cache")
        }
    }

    /// HQ指示(2026-11-09「Build 25実機確認フォローアップ、実機診断」): 2026-11-02時点では
    /// `/entitlements`確定前は一切出さなかったが、実機診断でRenderのコールドスタート時は
    /// `/entitlements`自体も`/home`と同程度に遅れることが分かり、「キャッシュがあればすぐ出す」
    /// という狙いが果たせていなかった。保存時のプランが分かっているなら、それを信用して確認前
    /// でも先に出す — 違えば`discardIfPlanDiffers`が確定後に捨てる(安全網は維持)。
    func testUnconfirmedPlanShowsTheCacheOptimisticallyAndCorrectsOnConfirmation() {
        let store = HomeCacheStore(defaults: defaults)
        store.save(response: response(), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now)

        // 起動直後(/entitlements の前)でも、保存時のプラン(PRO)を信用して出す。
        XCTAssertNotNil(store.load(for: context(userA, plan: nil)))
        XCTAssertNotNil(store.stored(), "an unconfirmed plan must not discard the cache")
        // 確かめたら: 同じなら出し続ける。違えば捨てる。
        XCTAssertNotNil(store.load(for: context(userA, plan: "PRO")))
        XCTAssertFalse(store.discardIfPlanDiffers(confirmedPlan: "PRO", userID: userA))
        XCTAssertTrue(store.discardIfPlanDiffers(confirmedPlan: "FREE", userID: userA))
        XCTAssertNil(store.stored())
    }

    func testPlanUnknownAtSaveTimeIsFilledInWhenConfirmed() throws {
        let store = HomeCacheStore(defaults: defaults)
        store.save(response: response(), date: today, timezone: tz, userID: userA, plan: nil, savedAt: now)

        XCTAssertFalse(store.discardIfPlanDiffers(confirmedPlan: "FREE", userID: userA))
        XCTAssertEqual(try XCTUnwrap(store.stored()).plan, "FREE")
    }

    func testPastScheduledEventsAreNotShownFromTheCache() {
        let past = Self.event(id: "past", status: .scheduled, at: now.addingTimeInterval(-60))
        let future = Self.event(id: "future", status: .scheduled, at: now.addingTimeInterval(3600))
        let released = Self.event(id: "released", status: .released, at: now.addingTimeInterval(-7200))
        let snapshot = snapshot(events: [past, future, released], savedAt: now.addingTimeInterval(-600))

        XCTAssertEqual(snapshot.displayEvents(now: now).map(\.id), ["future", "released"])
    }

    func testPricesOlderThan30MinutesAreBlanked() {
        let fresh = snapshot(savedAt: now.addingTimeInterval(-29 * 60))
        XCTAssertEqual(fresh.displayMajorFx(now: now), [Self.pair])

        let stale = snapshot(savedAt: now.addingTimeInterval(-31 * 60))
        let blanked = stale.displayMajorFx(now: now)
        XCTAssertEqual(blanked.map(\.symbol), ["USDJPY"])
        XCTAssertNil(blanked.first?.price)
        XCTAssertNil(blanked.first?.change)
        XCTAssertNil(blanked.first?.changePercent)
        XCTAssertEqual(ValueFormat.number(blanked.first?.price), "--") // ホームの価格の表示は「--」
    }

    func testCachedFavoritesFollowTheCurrentEntriesAndKeepTheMaxOfThree() {
        let favorites: [HomeFavoriteItem] = (1...4).map {
            .indicator(id: "i\($0)", countryCode: "US", currencyCode: "USD", name: "指標\($0)", importance: .high, nextReleaseDatetime: nil)
        }
        var cached = snapshot(savedAt: now)
        cached.favorites = favorites
        let entries: [FavoritesStore.Entry] = ["i4", "i2", "i9", "i1", "i3"].map { FavoritesStore.Entry(type: .indicator, id: $0) }

        // 今の登録の先頭3件(i4・i2・i9)のうち、キャッシュにあるものだけ、登録の順で。i9 は中身が無いので出さない。
        XCTAssertEqual(cached.displayFavorites(entries: entries).map(\.id), ["indicator:i4", "indicator:i2"])
    }

    // MARK: - HomeViewModel

    func testCacheIsShownFirstThenReplacedByTheFreshData() async throws {
        let cache = HomeCacheStore(defaults: defaults)
        let cachedEvent = Self.event(id: "cached", status: .scheduled, at: now.addingTimeInterval(3600))
        cache.save(response: response(events: [cachedEvent]), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now.addingTimeInterval(-300))
        let freshEvent = Self.event(id: "fresh", status: .scheduled, at: now.addingTimeInterval(7200))
        let api = MockAPIClient()
        api.results["home"] = .success(response(events: [freshEvent]))

        let viewModel = makeViewModel(api: api, cache: cache, userID: userA)
        viewModel.load()
        // キャッシュは load() の中ですぐ出る(通信を待たない)。
        XCTAssertEqual(viewModel.state, .loaded(events: [cachedEvent], majorFx: [Self.pair]))
        XCTAssertEqual(viewModel.refreshNotice, .showingCache(savedAt: now.addingTimeInterval(-300)))
        XCTAssertTrue(viewModel.isShowingCache)

        await waitUntil { viewModel.freshDataVersion == 1 }
        XCTAssertEqual(viewModel.state, .loaded(events: [freshEvent], majorFx: [Self.pair]))
        XCTAssertNil(viewModel.refreshNotice)
        XCTAssertFalse(viewModel.isShowingCache)
        XCTAssertEqual(try XCTUnwrap(cache.stored()).events, [freshEvent], "the fresh data replaces the cache")
    }

    func testFailureKeepsTheCacheAndShowsRefreshFailed() async {
        let cache = HomeCacheStore(defaults: defaults)
        let savedAt = now.addingTimeInterval(-300)
        cache.save(response: response(), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: savedAt)
        let api = MockAPIClient()
        api.results["home"] = .failure(APIError.transport("offline"))

        let viewModel = makeViewModel(api: api, cache: cache, userID: userA)
        viewModel.load()
        await waitUntil { viewModel.refreshNotice == .refreshFailed(savedAt: savedAt) }

        XCTAssertEqual(viewModel.refreshNotice, .refreshFailed(savedAt: savedAt))
        guard case .loaded = viewModel.state else { return XCTFail("the cached data must stay on screen, got \(viewModel.state)") }
        XCTAssertNotNil(cache.stored(), "a failed refresh must not delete the cache")
    }

    func testFirstLaunchWithoutCacheLoadsThenSaves() async throws {
        let cache = HomeCacheStore(defaults: defaults)
        let api = MockAPIClient()
        api.results["home"] = .success(response())

        let viewModel = makeViewModel(api: api, cache: cache, userID: userA)
        viewModel.load()
        XCTAssertEqual(viewModel.state, .loading)
        XCTAssertNil(viewModel.refreshNotice)

        await waitUntil { viewModel.freshDataVersion == 1 }
        XCTAssertNil(viewModel.refreshNotice)
        let saved = try XCTUnwrap(cache.stored())
        XCTAssertEqual(saved.userID, userA)
        XCTAssertEqual(saved.date, today)
        XCTAssertEqual(saved.plan, "PRO")
    }

    func testFirstLaunchFailureWithoutCacheShowsTheErrorAsBefore() async {
        let api = MockAPIClient()
        api.results["home"] = .failure(APIError.transport("offline"))

        let viewModel = makeViewModel(api: api, cache: HomeCacheStore(defaults: defaults), userID: userA)
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        guard case .error = viewModel.state else { return XCTFail("expected .error, got \(viewModel.state)") }
        XCTAssertNil(viewModel.refreshNotice)
    }

    func testReloadKeepsTheDisplayedDataWhileRefreshing() async {
        let api = MockAPIClient()
        api.results["home"] = .success(response())
        let viewModel = makeViewModel(api: api, cache: HomeCacheStore(defaults: defaults), userID: userA)
        viewModel.load()
        await waitUntil { viewModel.freshDataVersion == 1 }

        // 通貨ペア編集から戻ったときなど: 読み込み中の画面に戻さず、表示を残したまま取り直す。
        api.results["home"] = .failure(APIError.transport("offline"))
        viewModel.load()
        XCTAssertNotEqual(viewModel.state, .loading)
        await waitUntil { viewModel.refreshNotice != nil }
        XCTAssertEqual(viewModel.refreshNotice, .refreshFailed(savedAt: now))
        guard case .loaded = viewModel.state else { return XCTFail("the data must stay on screen") }
    }

    func testCacheOfUserAIsNotShownToUserB() {
        let cache = HomeCacheStore(defaults: defaults)
        cache.save(response: response(), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now)
        let api = MockAPIClient()
        api.results["home"] = .failure(APIError.transport("offline"))

        let viewModel = makeViewModel(api: api, cache: cache, userID: userB)
        viewModel.load()

        XCTAssertEqual(viewModel.state, .loading)
        XCTAssertNil(viewModel.refreshNotice)
        XCTAssertTrue(viewModel.favoriteItems.isEmpty)
        XCTAssertNil(cache.stored())
    }

    func testNoCacheIsShownOrSavedWithoutAnAuthenticatedUser() async {
        let cache = HomeCacheStore(defaults: defaults)
        cache.save(response: response(), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now)
        let api = MockAPIClient()
        api.results["home"] = .success(response())

        let viewModel = makeViewModel(api: api, cache: cache, userID: nil)
        viewModel.load()
        XCTAssertEqual(viewModel.state, .loading)
        await waitUntil { viewModel.freshDataVersion == 1 }
        XCTAssertNil(cache.stored(), "nothing is saved for an unknown user")
    }

    func testPlanChangeWhileShowingTheCacheWithdrawsIt() async {
        let cache = HomeCacheStore(defaults: defaults)
        cache.save(response: response(), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now)
        let plan = PlanStore()
        plan.set(plan: .pro, limits: .pro())
        let api = MockAPIClient()
        api.results["home"] = .failure(APIError.transport("still waking up"))

        let viewModel = makeViewModel(api: api, cache: cache, userID: userA, plan: plan)
        viewModel.load()
        XCTAssertTrue(viewModel.isShowingCache)

        // フォアグラウンドに戻ったときの /entitlements でプランが変わった(PRO → FREE)。
        plan.set(plan: .free, limits: .free())
        await waitUntil { !viewModel.isShowingCache }
        XCTAssertFalse(viewModel.isShowingCache)
        XCTAssertNil(cache.stored())
    }

    // MARK: - Splash先行取得の再利用(HQ指示 2026-11-05「Splash先行通信・Home Cache起動高速化」)

    /// Splash中に開始済みの`/home`があれば、`load()`はそれを再利用し、新規に
    /// `apiClient.send`を呼ばない(二重取得にしない)。
    func testFetchReusesThePrefetchedHomeAndDoesNotRequestAgain() async {
        let coordinator = HomePrefetchCoordinator()
        let api = MockAPIClient()
        let prefetchedEvent = Self.event(id: "prefetched", status: .scheduled, at: now.addingTimeInterval(3600))
        api.results["home"] = .success(response(events: [prefetchedEvent]))
        coordinator.start(userID: userA, apiClient: api, now: { self.now })

        let viewModel = makeViewModel(api: api, cache: HomeCacheStore(defaults: defaults), userID: userA, prefetch: coordinator)
        viewModel.load()
        await waitUntil { viewModel.freshDataVersion == 1 }

        XCTAssertEqual(viewModel.state, .loaded(events: [prefetchedEvent], majorFx: [Self.pair]))
        XCTAssertEqual(api.requestedPaths.filter { $0 == "home" }.count, 1, "load() must reuse the prefetch instead of sending its own /home request")
    }

    /// 先行取得が無ければ、従来どおり新規に取得する(フォールバック)。
    func testFetchWithoutAPrefetchFallsBackToANewRequest() async {
        let coordinator = HomePrefetchCoordinator() // startを呼んでいない=先行取得なし
        let api = MockAPIClient()
        api.results["home"] = .success(response())

        let viewModel = makeViewModel(api: api, cache: HomeCacheStore(defaults: defaults), userID: userA, prefetch: coordinator)
        viewModel.load()
        await waitUntil { viewModel.freshDataVersion == 1 }

        XCTAssertEqual(api.requestedPaths.filter { $0 == "home" }.count, 1)
    }

    /// ユーザーBの`HomeViewModel`は、ユーザーAの先行取得を使わず自分で取得する。
    func testFetchNeverUsesAnotherUsersPrefetch() async {
        let coordinator = HomePrefetchCoordinator()
        let apiForA = MockAPIClient()
        apiForA.results["home"] = .success(response())
        coordinator.start(userID: userA, apiClient: apiForA, now: { self.now })

        let apiForB = MockAPIClient()
        let bEvent = Self.event(id: "b-own", status: .scheduled, at: now.addingTimeInterval(3600))
        apiForB.results["home"] = .success(response(events: [bEvent]))

        let viewModel = makeViewModel(api: apiForB, cache: HomeCacheStore(defaults: defaults), userID: userB, prefetch: coordinator)
        viewModel.load()
        await waitUntil { viewModel.freshDataVersion == 1 }

        XCTAssertEqual(viewModel.state, .loaded(events: [bEvent], majorFx: [Self.pair]))
        XCTAssertEqual(apiForB.requestedPaths.filter { $0 == "home" }.count, 1)
        XCTAssertEqual(apiForA.requestedPaths.filter { $0 == "home" }.count, 1, "user A's own prefetch request must still have happened exactly once, untouched")
    }

    /// 再読み込み(タブの出入り等)は、1回目の先行取得を消費した後の2回目なので、
    /// 通常どおり新規に取得する(既存の「再取得は毎回走る」挙動を壊さない)。
    func testReloadAfterConsumingThePrefetchStillRefetches() async {
        let coordinator = HomePrefetchCoordinator()
        let api = MockAPIClient()
        api.results["home"] = .success(response())
        coordinator.start(userID: userA, apiClient: api, now: { self.now })

        let viewModel = makeViewModel(api: api, cache: HomeCacheStore(defaults: defaults), userID: userA, prefetch: coordinator)
        viewModel.load()
        await waitUntil { viewModel.freshDataVersion == 1 }
        viewModel.load()
        await waitUntil { viewModel.freshDataVersion == 2 }

        XCTAssertEqual(api.requestedPaths.filter { $0 == "home" }.count, 2, "the first load consumes the prefetch; the second must be a real request")
    }

    /// Splash中に日付が変わった・バックグラウンドから翌日に戻ったとき: 先行取得は前日の
    /// `date`で取ったものなので使わず、今日の`date`で自分で取得する(前日の内容を今日の
    /// 最新として出さない)。
    func testFetchIgnoresAPrefetchForThePreviousDateAndRequestsToday() async throws {
        let coordinator = HomePrefetchCoordinator()
        let apiForPrefetch = MockAPIClient()
        let staleEvent = Self.event(id: "previous-day", status: .scheduled, at: now.addingTimeInterval(3600))
        apiForPrefetch.results["home"] = .success(response(events: [staleEvent]))
        coordinator.start(userID: userA, apiClient: apiForPrefetch, now: { self.now.addingTimeInterval(-24 * 3600) })

        let api = MockAPIClient()
        let todayEvent = Self.event(id: "today", status: .scheduled, at: now.addingTimeInterval(3600))
        api.results["home"] = .success(response(events: [todayEvent]))
        let viewModel = makeViewModel(api: api, cache: HomeCacheStore(defaults: defaults), userID: userA, prefetch: coordinator)
        viewModel.load()
        await waitUntil { viewModel.freshDataVersion == 1 }

        XCTAssertEqual(viewModel.state, .loaded(events: [todayEvent], majorFx: [Self.pair]))
        XCTAssertEqual(api.requestedPaths.filter { $0 == "home" }.count, 1, "the view model must request today's /home itself")
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        let query = try XCTUnwrap(api.requestedEndpoints.first { $0.path == "home" }?.queryItems)
        XCTAssertEqual(query.first { $0.name == "date" }?.value, formatter.string(from: now))
    }

    // MARK: - プランの確認(HQ指示 2026-11-02「ホームキャッシュのプラン安全性修正」)

    /// HQ指示(2026-11-09「Build 25実機確認フォローアップ、実機診断」): 保存時のプラン(PRO)を
    /// 信用して、`/entitlements`確認前でも`load()`の中で即座に出す(以前は確認後まで一切出さな
    /// かった)。
    func testUnconfirmedPlanShowsTheCacheOptimisticallyThenMarksRefreshFailed() async {
        let cache = savedCache() // PRO で保存
        let api = MockAPIClient()
        api.results["home"] = .failure(APIError.transport("still waking up"))

        let viewModel = makeViewModel(api: api, cache: cache, userID: userA, plan: PlanStore())
        viewModel.load()
        XCTAssertTrue(viewModel.isShowingCache, "the saved plan must be trusted before /entitlements confirms")
        guard case .loaded = viewModel.state else { return XCTFail("expected the cached data, got \(viewModel.state)") }

        await waitUntil { viewModel.refreshNotice == .refreshFailed(savedAt: now) }
        XCTAssertTrue(viewModel.isShowingCache, "a failed /home refresh must keep showing the optimistic cache")
        XCTAssertNotNil(cache.stored(), "kept until the plan is confirmed")
    }

    /// 保存時と同じプランが後から確認されても、表示中の(楽観的に出していた)キャッシュは変わらず
    /// 出続ける(`discardIfPlanDiffers`が一致なので捨てない)。
    func testSamePlanConfirmedLaterKeepsShowingTheCache() async {
        let cache = savedCache() // PRO で保存
        let plan = PlanStore()
        let api = MockAPIClient()
        api.results["home"] = .failure(APIError.transport("still waking up"))

        let viewModel = makeViewModel(api: api, cache: cache, userID: userA, plan: plan)
        viewModel.load()
        XCTAssertTrue(viewModel.isShowingCache, "the cache must show immediately, trusting its saved plan")

        plan.set(plan: .pro, limits: .pro()) // /entitlements で PRO を確かめた(保存時と一致)
        await waitUntil { viewModel.refreshNotice == .refreshFailed(savedAt: now) }
        XCTAssertTrue(viewModel.isShowingCache, "a matching confirmation must not withdraw the cache")
        guard case .loaded = viewModel.state else { return XCTFail("expected the cached data, got \(viewModel.state)") }
    }

    /// 保存時と違うプランが後から確認されたら、楽観的に出していたキャッシュを取り下げる — これが
    /// 「信用して先に出す」ことの安全網(`discardIfPlanDiffers`、変更していない)。
    func testMismatchedPlanConfirmedLaterIsNotShownAndDiscarded() async {
        let cache = savedCache() // PRO で保存
        let plan = PlanStore()
        let api = MockAPIClient()
        api.results["home"] = .failure(APIError.transport("still waking up"))

        let viewModel = makeViewModel(api: api, cache: cache, userID: userA, plan: plan)
        viewModel.load()
        XCTAssertTrue(viewModel.isShowingCache, "shown optimistically until the plan is confirmed")

        plan.set(plan: .free, limits: .free()) // FREE だった(保存時のPROと食い違う)
        await waitUntil { cache.stored() == nil }
        XCTAssertNil(cache.stored())
        XCTAssertFalse(viewModel.isShowingCache, "a mismatched confirmation must withdraw the optimistically-shown cache")
        guard case .error = viewModel.state else { return XCTFail("the old plan's data must not appear, got \(viewModel.state)") }
    }

    /// `/entitlements`の確認自体が失敗しても(確定済みの値が手に入らない)、保存時のプランを
    /// 信用した表示は取り下げない — 「確認できない」ことと「違うプランだった」ことは別で、
    /// 違うと分かった時だけ`discardIfPlanDiffers`が捨てる。
    func testPlanConfirmationFailureKeepsShowingTheOptimisticCache() async {
        let cache = savedCache() // PRO で保存
        let plan = PlanStore()
        let failing = MockAPIClient()
        failing.result = .failure(APIError.transport("entitlements unavailable"))
        await plan.load(apiClient: failing) // /entitlements の確認に失敗
        XCTAssertFalse(plan.isConfirmed)
        let api = MockAPIClient()
        api.results["home"] = .failure(APIError.transport("still waking up"))

        let viewModel = makeViewModel(api: api, cache: cache, userID: userA, plan: plan)
        viewModel.load()
        XCTAssertTrue(viewModel.isShowingCache)

        await waitUntil { viewModel.refreshNotice == .refreshFailed(savedAt: now) }
        XCTAssertTrue(viewModel.isShowingCache)
        guard case .loaded = viewModel.state else { return XCTFail("expected the cached data, got \(viewModel.state)") }
    }

    func testCachedFavoritesAreShownUntilTheFreshOnesArrive() async {
        let cache = HomeCacheStore(defaults: defaults)
        cache.save(response: response(), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now)
        let item = HomeFavoriteItem.indicator(id: "i1", countryCode: "US", currencyCode: "USD", name: "米国CPI", importance: .high, nextReleaseDatetime: nil)
        cache.saveFavorites([item], userID: userA)
        let favorites = FavoritesStore(userDefaults: defaults)
        favorites.toggle(.indicator, id: "i1")
        let api = MockAPIClient()
        api.result = .failure(APIError.transport("offline"))

        let viewModel = makeViewModel(api: api, cache: cache, userID: userA, favorites: favorites)
        viewModel.load()

        XCTAssertEqual(viewModel.favoriteItems, [item])
        // お気に入りの取得が1件も取れなくても(復帰待ち・圏外)、キャッシュのお気に入りは消さない。
        try? await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(viewModel.favoriteItems, [item])
    }

    func testCacheDisplayDoesNotOverwriteTheHomeDiagnostics() async {
        let diagnostics = DiagnosticsStore.shared
        let appliedBefore = diagnostics.current.homeStateAppliedMs
        let readyBefore = diagnostics.current.homeReadyToDisplayMs
        let cache = HomeCacheStore(defaults: defaults)
        cache.save(response: response(), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now)
        let api = MockAPIClient()
        api.results["home"] = .failure(APIError.transport("offline"))

        let viewModel = makeViewModel(api: api, cache: cache, userID: userA)
        viewModel.load()
        await waitUntil { viewModel.refreshNotice != .showingCache(savedAt: self.now) }

        XCTAssertNotNil(diagnostics.current.homeCacheShownMs)
        XCTAssertEqual(diagnostics.current.homeStateAppliedMs, appliedBefore, "the cache must not count as /home applied")
        XCTAssertEqual(diagnostics.current.homeReadyToDisplayMs, readyBefore, "the cache must not count as home ready")
    }

    func testRecordHomeCacheShownIsSeparateFromHomeReady() {
        let store = DiagnosticsStore(defaults: defaults)
        store.recordHomeCacheShown()
        XCTAssertNotNil(store.current.homeCacheShownMs)
        XCTAssertNil(store.current.homeReadyToDisplayMs)
        XCTAssertNil(store.current.homeStateAppliedMs)
        XCTAssertTrue(store.current.reportText(appVersion: "1", buildNumber: "1").contains("前回の情報(キャッシュ)の表示: 起動から"))
    }

    func testNoticeText() {
        let format: (Date) -> String = { _ in "11/02 17:08" }
        XCTAssertEqual(HomeRefreshNoticeText.make(.showingCache(savedAt: now), formatDate: format), "前回の情報（11/02 17:08時点）を表示しています・更新中…")
        XCTAssertEqual(HomeRefreshNoticeText.make(.refreshFailed(savedAt: now), formatDate: format), "更新できませんでした（11/02 17:08時点の情報を表示中）")
        XCTAssertEqual(HomeRefreshNoticeText.make(.refreshFailed(savedAt: nil), formatDate: format), "更新できませんでした")
    }

    // MARK: - AppState(ログアウトなどで消す・ユーザーを持つ)

    func testLogoutClearsTheCache() {
        let (cache, appState) = loggedIn()
        appState.handleSignOut() // ログアウト・アカウント削除(同じ onSignOut)
        XCTAssertNil(cache.stored())
        XCTAssertNil(appState.currentUserID)
    }

    func testSessionExpiredAtLaunchClearsTheCache() {
        let cache = savedCache()
        let appState = AppState(authService: MockAuthService(isConfigured: false), homeCache: cache)
        appState.splashFinished(outcome: .sessionExpired)
        XCTAssertNil(cache.stored())
    }

    func testLoginScreenAtLaunchClearsTheCache() {
        let cache = savedCache()
        let appState = AppState(authService: MockAuthService(isConfigured: false), homeCache: cache)
        appState.splashFinished(outcome: .unauthenticated)
        XCTAssertNil(cache.stored())
        XCTAssertNil(appState.currentUserID)
    }

    func testSessionExpiryWhileLoggedInClearsTheCache() async {
        let cache = savedCache()
        let auth = MockAuthService(isConfigured: true)
        let appState = AppState(authService: auth, homeCache: cache)
        appState.splashFinished(outcome: .authenticated(session(userA)))
        XCTAssertEqual(appState.currentUserID, userA)
        XCTAssertNotNil(cache.stored())

        auth.emit(.signedOut)
        await waitUntil { appState.phase == .loggedOut(sessionExpired: true) }
        XCTAssertNil(cache.stored())
        XCTAssertNil(appState.currentUserID)
    }

    func testLoginSetsTheCurrentUser() {
        let appState = AppState(authService: MockAuthService(isConfigured: false), homeCache: HomeCacheStore(defaults: defaults))
        appState.splashFinished(outcome: .unauthenticated)
        appState.handleSuccessfulLogin(session(userB))
        XCTAssertEqual(appState.currentUserID, userB)
    }

    // MARK: - Helpers

    private var tz: String { TimeZone.current.identifier }

    private func context(_ user: UUID?, plan: String?) -> HomeCacheContext {
        HomeCacheContext(userID: user, date: today, timezone: tz, confirmedPlan: plan)
    }

    private func makeViewModel(
        api: MockAPIClient, cache: HomeCacheStore, userID: UUID?, plan: PlanStore? = nil, favorites: FavoritesStore? = nil,
        prefetch: HomePrefetchCoordinator? = nil
    ) -> HomeViewModel {
        let planStore = plan ?? {
            let store = PlanStore()
            store.set(plan: .pro, limits: .pro())
            return store
        }()
        let fixed = now
        return HomeViewModel(
            apiClient: api,
            favoritesStore: favorites ?? FavoritesStore(userDefaults: defaults),
            userID: userID,
            cacheStore: cache,
            planStore: planStore,
            // 個別のテストごとに独立したインスタンス(既定)にして、`.shared`を介した
            // テスト間の汚染を避ける(HQ指示 2026-11-05「Splash先行通信」)。
            prefetchCoordinator: prefetch ?? HomePrefetchCoordinator(),
            now: { fixed }
        )
    }

    private func savedCache() -> HomeCacheStore {
        let cache = HomeCacheStore(defaults: defaults)
        cache.save(response: response(), date: today, timezone: tz, userID: userA, plan: "PRO", savedAt: now)
        return cache
    }

    private func loggedIn() -> (HomeCacheStore, AppState) {
        let cache = savedCache()
        let appState = AppState(authService: MockAuthService(isConfigured: false), homeCache: cache)
        appState.handleSuccessfulLogin(session(userA))
        XCTAssertEqual(appState.currentUserID, userA)
        return (cache, appState)
    }

    private func session(_ user: UUID) -> UserSession {
        UserSession(userID: user, accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
    }

    /// 状態が変わるまで待つ(実時間で最大10秒、条件が満たされればすぐ返る)。混んだCIのrunnerでも
    /// 落ちないよう、回数ではなく時刻で上限を決める(SplashViewModelTestsと同じ、HQ指示 2026-11-04)。
    private func waitUntil(_ condition: @escaping () -> Bool) async {
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            if condition() { return }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
    }

    private func response(events: [HomeEventSummary]? = nil) -> HomeResponse {
        HomeResponse(
            date: today,
            timezone: tz,
            events: events ?? [Self.event(id: "e1", status: .scheduled, at: now.addingTimeInterval(3600))],
            majorFx: [Self.pair],
            speeches: [Self.speech],
            speechesStatus: Self.speechesStatus
        )
    }

    private func snapshot(events: [HomeEventSummary] = [], savedAt: Date) -> HomeCacheSnapshot {
        HomeCacheSnapshot(
            formatVersion: HomeCacheSnapshot.currentFormatVersion, userID: userA, date: today, timezone: tz, plan: "PRO",
            savedAt: savedAt, events: events, majorFx: [Self.pair], speeches: [], speechesStatus: nil, favorites: []
        )
    }

    private static let pair = MajorFxSummary(
        fxPairId: "p1", symbol: "USDJPY", price: 154.71, change: -0.39, changePercent: -0.25, timestamp: Date(timeIntervalSince1970: 1_793_599_000)
    )

    private static let speech = HomeSpeechSummary(
        id: "s1", countryCode: "US", speakerName: "パウエル", statementDatetime: Date(timeIntervalSince1970: 1_793_500_000), headline: "講演",
        organization: "FRB", reactionFxSymbol: "USDJPY", reactionPriceBefore: 155.0, reactionPriceAfter: 154.8, reactionPips: -20.0
    )

    private static let speechesStatus = HomeSpeechesStatus(windowDays: 7, lastSuccessAt: Date(timeIntervalSince1970: 1_793_590_000), stale: false)

    private static func event(
        id: String, status: EventStatus, at date: Date, valueDecimals: Int? = nil, locked: Bool? = nil, previousLocked: Bool? = nil
    ) -> HomeEventSummary {
        HomeEventSummary(
            id: id,
            indicatorId: "ind_1",
            indicatorName: "US CPI",
            countryCode: "US",
            currencyCode: "USD",
            importance: .high,
            releaseDatetime: date,
            releaseDatetimePrecision: .exact,
            status: status,
            dataStatus: .ready,
            forecast: 3.1,
            actual: status == .released ? 3.0245 : nil,
            previous: 3.0,
            surprise: nil,
            surpriseDirection: nil,
            relatedFxPairs: [RelatedFxPairSummary(fxPairId: "p1", symbol: "USDJPY", priority: 1)],
            displayName: "消費者物価指数（CPI）",
            unit: "%",
            locked: locked,
            requiredPlan: locked == true ? "PRO" : nil,
            resultType: .value,
            valueDecimals: valueDecimals,
            previousLocked: previousLocked
        )
    }
}
