import XCTest
@testable import FXEventAnalyzer

@MainActor
final class HomeViewModelTests: XCTestCase {
    func testLoadWithNoBackendConfiguredShowsBackendNotConfigured() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.notConfigured)

        let viewModel = await load(with: apiClient)

        XCTAssertEqual(viewModel.state, .backendNotConfigured)
    }

    func testLoadSuccessSplitsEventsByStatus() async {
        let apiClient = MockAPIClient()
        let scheduled = Self.makeEvent(id: "evt_scheduled", status: .scheduled)
        let released = Self.makeEvent(id: "evt_released", status: .released)
        apiClient.result = .success(HomeResponse(date: "2026-09-17", timezone: "UTC", events: [scheduled, released], majorFx: []))

        let viewModel = await load(with: apiClient)

        XCTAssertEqual(viewModel.state, .loaded(events: [scheduled, released], majorFx: []))
        XCTAssertEqual(viewModel.upcomingEvents, [scheduled])
        XCTAssertEqual(viewModel.recentEvents, [released])
    }

    func testLoadOtherFailureShowsGenericError() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.transport("connection reset"))

        let viewModel = await load(with: apiClient)

        guard case .error = viewModel.state else {
            return XCTFail("Expected .error state, got \(viewModel.state)")
        }
    }

    // MARK: - HQ決定(2026-10-21「起動の遅れの改善A1」): 前回データの先行表示

    private func makeSession(userID: UUID = UUID()) -> UserSession {
        UserSession(userID: userID, accessToken: "token", expiresAt: Date().addingTimeInterval(3600))
    }

    private func makeSnapshotStore() -> (store: HomeSnapshotStore, cleanup: () -> Void) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return (HomeSnapshotStore(directory: directory), { try? FileManager.default.removeItem(at: directory) })
    }

    func testLoadWithoutAuthServiceBehavesLikeBefore() async {
        // `authService`省略(既定nil)なら前回データの先行表示は行わず、
        // 既存のテスト(上の3件)が検証する挙動とまったく同じになる。
        let apiClient = MockAPIClient()
        apiClient.result = .success(HomeResponse(date: "2026-10-21", timezone: "UTC", events: [], majorFx: []))
        let viewModel = HomeViewModel(apiClient: apiClient)

        viewModel.load()
        let state = await settledState(of: viewModel)

        XCTAssertEqual(state, .loaded(events: [], majorFx: []))
    }

    func testLoadWithUsableSnapshotEventuallyShowsFreshDataOnSuccess() async {
        let (snapshotStore, cleanup) = makeSnapshotStore()
        defer { cleanup() }
        let session = makeSession()
        let today = Self.isoDateFormatter.string(from: Date())
        let timezone = TimeZone.current.identifier
        snapshotStore.save(HomeSnapshot(events: [], majorFx: [], speeches: [], fetchedAt: Date(), requestedDate: today, requestedTimezone: timezone, userID: session.userID.uuidString, plan: "FREE"))

        let apiClient = MockAPIClient()
        apiClient.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil))
        let freshEvent = Self.makeEvent(id: "evt_fresh", status: .scheduled)
        apiClient.results["home"] = .success(HomeResponse(date: today, timezone: timezone, events: [freshEvent], majorFx: []))
        let authService = MockAuthService()
        authService.sessionResult = .success(session)
        let viewModel = HomeViewModel(apiClient: apiClient, snapshotStore: snapshotStore, authService: authService, planStore: PlanStore())

        viewModel.load()
        let state = await settledState(of: viewModel)

        XCTAssertEqual(state, .loaded(events: [freshEvent], majorFx: []))
    }

    func testLoadWithUsableSnapshotKeepsShowingSnapshotWhenFetchFails() async {
        let (snapshotStore, cleanup) = makeSnapshotStore()
        defer { cleanup() }
        let session = makeSession()
        let today = Self.isoDateFormatter.string(from: Date())
        let timezone = TimeZone.current.identifier
        let snapshot = HomeSnapshot(events: [], majorFx: [], speeches: [], fetchedAt: Date(), requestedDate: today, requestedTimezone: timezone, userID: session.userID.uuidString, plan: "FREE")
        snapshotStore.save(snapshot)

        let apiClient = MockAPIClient()
        apiClient.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil))
        apiClient.results["home"] = .failure(APIError.transport("connection reset"))
        let authService = MockAuthService()
        authService.sessionResult = .success(session)
        let viewModel = HomeViewModel(apiClient: apiClient, snapshotStore: snapshotStore, authService: authService, planStore: PlanStore())

        viewModel.load()
        let state = await settledState(of: viewModel)

        guard case .showingSnapshot(let shown, let refreshFailed) = state else {
            return XCTFail("Expected .showingSnapshot, got \(state)")
        }
        XCTAssertEqual(shown, snapshot)
        XCTAssertTrue(refreshFailed)
    }

    func testLoadWithMismatchedUserDoesNotShowSnapshotAndFallsBackToLoaded() async {
        let (snapshotStore, cleanup) = makeSnapshotStore()
        defer { cleanup() }
        let today = Self.isoDateFormatter.string(from: Date())
        let timezone = TimeZone.current.identifier
        // 別の利用者IDで保存された前回データ。
        snapshotStore.save(HomeSnapshot(events: [], majorFx: [], speeches: [], fetchedAt: Date(), requestedDate: today, requestedTimezone: timezone, userID: "someone-else", plan: "FREE"))

        let apiClient = MockAPIClient()
        apiClient.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil))
        apiClient.results["home"] = .success(HomeResponse(date: today, timezone: timezone, events: [], majorFx: []))
        let authService = MockAuthService()
        authService.sessionResult = .success(makeSession())
        let viewModel = HomeViewModel(apiClient: apiClient, snapshotStore: snapshotStore, authService: authService, planStore: PlanStore())

        viewModel.load()
        let state = await settledState(of: viewModel)

        XCTAssertEqual(state, .loaded(events: [], majorFx: []))
    }

    func testLoadWithUsableSnapshotPopulatesRecentSpeechesImmediately() async {
        let (snapshotStore, cleanup) = makeSnapshotStore()
        defer { cleanup() }
        let session = makeSession()
        let today = Self.isoDateFormatter.string(from: Date())
        let timezone = TimeZone.current.identifier
        let speech = Self.makeSpeech(id: "sp1")
        snapshotStore.save(HomeSnapshot(events: [], majorFx: [], speeches: [speech], fetchedAt: Date(), requestedDate: today, requestedTimezone: timezone, userID: session.userID.uuidString, plan: "FREE"))

        let apiClient = MockAPIClient()
        apiClient.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil))
        // `fetch()`が成功で終わるまで待つと`recentSpeeches`が最新のもの
        // (ここでは空)に置き換わってしまうため、意図的に通信エラーにして
        // `.showingSnapshot(_, refreshFailed: true)`で止める
        // (`.notConfigured`は`.backendNotConfigured`へ遷移してしまうため使えない)。
        apiClient.results["home"] = .failure(APIError.transport("connection reset"))
        let authService = MockAuthService()
        authService.sessionResult = .success(session)
        let viewModel = HomeViewModel(apiClient: apiClient, snapshotStore: snapshotStore, authService: authService, planStore: PlanStore())

        viewModel.load()
        _ = await settledState(of: viewModel)

        XCTAssertEqual(viewModel.recentSpeeches, [speech])
    }

    // MARK: - HQ指示(2026-10-22「A1ホームスナップショットのプラン失効対策」)

    /// 受け入れ条件1: PROで保存したスナップショットをFREE確定後に利用できない。
    func testLoadWithSnapshotSavedUnderDifferentPlanDoesNotShowIt() async {
        let (snapshotStore, cleanup) = makeSnapshotStore()
        defer { cleanup() }
        let session = makeSession()
        let today = Self.isoDateFormatter.string(from: Date())
        let timezone = TimeZone.current.identifier
        // PRO時点で保存された前回データ(ロックされていない実数値を含む想定)。
        let proSnapshot = HomeSnapshot(events: [], majorFx: [], speeches: [], fetchedAt: Date(), requestedDate: today, requestedTimezone: timezone, userID: session.userID.uuidString, plan: "PRO")
        snapshotStore.save(proSnapshot)

        let apiClient = MockAPIClient()
        // 現在はFREEであることが確認できる。
        apiClient.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil))
        apiClient.results["home"] = .success(HomeResponse(date: today, timezone: timezone, events: [], majorFx: []))
        let authService = MockAuthService()
        authService.sessionResult = .success(session)
        let planStore = PlanStore()
        let viewModel = HomeViewModel(apiClient: apiClient, snapshotStore: snapshotStore, authService: authService, planStore: planStore)

        viewModel.load()
        let state = await settledState(of: viewModel)

        if case .showingSnapshot(let shown, _) = state, shown == proSnapshot {
            XCTFail("PROプラン時点のスナップショットが、FREE確定後にそのまま表示されてはならない")
        }
        XCTAssertEqual(planStore.plan, .free)
        XCTAssertEqual(planStore.confirmationState, .confirmed)
    }

    /// 受け入れ条件2: プラン未確定中はスナップショットを表示しない
    /// (`PlanStore.load()`がまだ完了していない間、途中で`.showingSnapshot`に
    /// ならないこと)。
    func testLoadWhilePlanUnconfirmedDoesNotShowSnapshot() async {
        let (snapshotStore, cleanup) = makeSnapshotStore()
        defer { cleanup() }
        let session = makeSession()
        let today = Self.isoDateFormatter.string(from: Date())
        let timezone = TimeZone.current.identifier
        snapshotStore.save(HomeSnapshot(events: [], majorFx: [], speeches: [], fetchedAt: Date(), requestedDate: today, requestedTimezone: timezone, userID: session.userID.uuidString, plan: "FREE"))

        let mockClient = MockAPIClient()
        mockClient.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil))
        mockClient.results["home"] = .success(HomeResponse(date: today, timezone: timezone, events: [], majorFx: []))
        // entitlementsの応答だけ意図的に遅らせ、「未確定の間」を作り出す。
        let apiClient = DelayedEntitlementsAPIClient(wrapped: mockClient, delayNanoseconds: 300_000_000)
        let authService = MockAuthService()
        authService.sessionResult = .success(session)
        let planStore = PlanStore()
        let viewModel = HomeViewModel(apiClient: apiClient, snapshotStore: snapshotStore, authService: authService, planStore: planStore)

        viewModel.load()
        try? await Task.sleep(nanoseconds: 100_000_000) // entitlementsの遅延(300ms)より短い時点で確認

        XCTAssertEqual(planStore.confirmationState, .notLoaded, "この時点ではまだプラン確認が終わっていないはず")
        if case .showingSnapshot = viewModel.state {
            XCTFail("プラン未確定の間にスナップショットを表示してはならない")
        }

        // 確定後は使える条件を満たすため、最終的には表示される。
        let state = await settledState(of: viewModel)
        guard case .showingSnapshot = state else {
            return XCTFail("プラン確定後は前回データが表示されるはず、got \(state)")
        }
    }

    /// 受け入れ条件3: プラン取得失敗時に古いPROデータを表示しない。
    func testLoadWithPlanFetchFailureDoesNotShowStaleSnapshot() async {
        let (snapshotStore, cleanup) = makeSnapshotStore()
        defer { cleanup() }
        let session = makeSession()
        let today = Self.isoDateFormatter.string(from: Date())
        let timezone = TimeZone.current.identifier
        let staleSnapshot = HomeSnapshot(events: [], majorFx: [], speeches: [], fetchedAt: Date(), requestedDate: today, requestedTimezone: timezone, userID: session.userID.uuidString, plan: "PRO")
        snapshotStore.save(staleSnapshot)

        let apiClient = MockAPIClient()
        apiClient.results["entitlements"] = .failure(APIError.transport("connection reset"))
        apiClient.results["home"] = .success(HomeResponse(date: today, timezone: timezone, events: [], majorFx: []))
        let authService = MockAuthService()
        authService.sessionResult = .success(session)
        let planStore = PlanStore()
        let viewModel = HomeViewModel(apiClient: apiClient, snapshotStore: snapshotStore, authService: authService, planStore: planStore)

        viewModel.load()
        let state = await settledState(of: viewModel)

        if case .showingSnapshot = state {
            XCTFail("プラン取得に失敗した場合、古いPROデータのスナップショットを表示してはならない, got \(state)")
        }
        XCTAssertEqual(planStore.confirmationState, .failed)
    }

    /// プラン確認付きの`APIClient`ラッパー(`entitlements`だけ応答を遅らせる)。
    private struct DelayedEntitlementsAPIClient: APIClient {
        let wrapped: APIClient
        let delayNanoseconds: UInt64

        func send<T: Decodable>(_ endpoint: Endpoint) async throws -> T {
            if endpoint.path == "entitlements" {
                try? await Task.sleep(nanoseconds: delayNanoseconds)
            }
            return try await wrapped.send(endpoint)
        }
    }

    /// `load()`はdispatchが非同期(利用者ID解決のため)のため、短くポーリングする。
    private func settledState(of viewModel: HomeViewModel) async -> HomeState {
        for _ in 0..<50 {
            if viewModel.state != .loading {
                // `.showingSnapshot(_, refreshFailed: false)`は取得中を示す
                // 中間状態なので、それ以外(確定状態)まで待つ。
                if case .showingSnapshot(_, let refreshFailed) = viewModel.state, !refreshFailed {
                    try? await Task.sleep(nanoseconds: 10_000_000)
                    continue
                }
                break
            }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return viewModel.state
    }

    private static let isoDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        return formatter
    }()

    private static func makeSpeech(id: String) -> HomeSpeechSummary {
        let json = """
        {"speech_id":"\(id)","country_code":"US","speaker_name":"パウエル","statement_datetime":"2026-10-21T12:00:00Z","headline":"見出し","organization":"FRB"}
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try! decoder.decode(HomeSpeechSummary.self, from: Data(json.utf8))
    }

    // MARK: - Fixtures

    private static func makeEvent(id: String, status: EventStatus) -> HomeEventSummary {
        HomeEventSummary(
            id: id,
            indicatorId: "ind_1",
            indicatorName: "US CPI",
            countryCode: "US",
            currencyCode: "USD",
            importance: .high,
            releaseDatetime: Date(),
            releaseDatetimePrecision: .exact,
            status: status,
            dataStatus: .ready,
            forecast: 3.1,
            actual: status == .released ? 3.3 : nil,
            previous: 3.0,
            surprise: status == .released ? 0.2 : nil,
            surpriseDirection: status == .released ? .positive : nil,
            relatedFxPairs: []
        )
    }

    // MARK: - Helper

    /// `load()` dispatches asynchronously; poll briefly until it settles out
    /// of `.loading` rather than assuming a fixed delay is always enough.
    private func load(with apiClient: MockAPIClient) async -> HomeViewModel {
        let viewModel = HomeViewModel(apiClient: apiClient)
        viewModel.load()
        for _ in 0..<50 {
            if viewModel.state != .loading { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return viewModel
    }
}
