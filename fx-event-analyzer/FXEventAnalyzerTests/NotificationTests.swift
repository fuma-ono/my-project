import UserNotifications
import XCTest
@testable import FXEventAnalyzer

private func waitUntil(_ condition: @escaping () -> Bool) async {
    for _ in 0..<100 {
        if condition() { return }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
}

private func jsonObject(_ data: Data?) throws -> [String: Any] {
    let data = try XCTUnwrap(data)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private let base = Date(timeIntervalSince1970: 1_790_000_000)

private func entry(_ id: String, minutesFromBase: Double, kind: NotificationEntry.Kind = .indicator) -> NotificationEntry {
    let notifyAt = base.addingTimeInterval(minutesFromBase * 60)
    return NotificationEntry(kind: kind, targetID: id, title: "指標\(id)", body: "本文", notifyAt: notifyAt, scheduledAt: notifyAt.addingTimeInterval(300), importance: "HIGH")
}

@MainActor
private func makeStore() -> NotificationsStore {
    NotificationsStore(userDefaults: UserDefaults(suiteName: "NotificationTests-\(UUID().uuidString)")!)
}

private func upcoming(_ id: String, kind: UpcomingNotification.Kind, notifyAt: Date) -> UpcomingNotification {
    UpcomingNotification(
        kind: kind, id: id, title: "米雇用統計", speakerName: kind == .speech ? "パウエル議長" : nil,
        importance: "HIGH", scheduledAt: notifyAt.addingTimeInterval(300), notifyAt: notifyAt,
        countryCode: "US", currencyCode: "USD", relatedFxPairs: ["USDJPY"]
    )
}

// MARK: - モデル

final class NotificationModelsTests: XCTestCase {
    func testDecodesUpcomingNotifications() throws {
        let json = Data("""
        {
          "lead_minutes": 5,
          "items": [{
            "kind": "SPEECH", "id": "s1", "title": "議会証言", "speaker_name": "パウエル議長",
            "importance": "HIGH", "scheduled_at": "2026-10-06T14:00:00Z", "notify_at": "2026-10-06T13:55:00Z",
            "country_code": "US", "currency_code": "USD", "related_fx_pairs": ["USDJPY", "EURUSD"]
          }]
        }
        """.utf8)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let response = try decoder.decode(UpcomingNotificationsResponse.self, from: json)

        XCTAssertEqual(response.leadMinutes, 5)
        XCTAssertEqual(response.items.first?.kind, .speech)
        XCTAssertEqual(response.items.first?.speakerName, "パウエル議長")
        XCTAssertEqual(response.items.first?.relatedFxPairs, ["USDJPY", "EURUSD"])
    }

    func testEntryBodyDescribesTimingAndImportance() {
        let tokyo = TimeZone(identifier: "Asia/Tokyo")!
        let scheduled = ISO8601DateFormatter().date(from: "2026-10-06T12:30:00Z")!
        let item = UpcomingNotification(
            kind: .indicator, id: "e1", title: "米雇用統計", speakerName: nil, importance: "HIGH",
            scheduledAt: scheduled, notifyAt: scheduled.addingTimeInterval(-300),
            countryCode: "US", currencyCode: "USD", relatedFxPairs: []
        )

        let entry = NotificationEntry(item, leadMinutes: 5, timeZone: tokyo)

        XCTAssertEqual(entry.body, "発表の5分前です（10/6 21:30発表・重要度 高）")
        XCTAssertEqual(entry.targetID, "e1")
        XCTAssertEqual(entry.kind, .indicator)
        XCTAssertEqual(entry.subject, "米雇用統計")
        XCTAssertEqual(entry.countryCode, "US")
    }

    func testSpeechEntryPrefixesTheSpeaker() {
        let item = upcoming("s1", kind: .speech, notifyAt: base)
        let entry = NotificationEntry(item, leadMinutes: 0)
        XCTAssertEqual(entry.title, "パウエル議長：米雇用統計")
        XCTAssertEqual(entry.kind, .speech)
        XCTAssertEqual(entry.speakerName, "パウエル議長")
        XCTAssertTrue(entry.body.hasPrefix("まもなく発言です"))
    }
}

// MARK: - 通知の記録・未読

@MainActor
final class NotificationsStoreTests: XCTestCase {
    func testOnlyDeliveredEntriesCountAsUnread() {
        let store = makeStore()
        store.record([entry("future", minutesFromBase: 10)], now: base)
        XCTAssertFalse(store.hasUnread)
        XCTAssertTrue(store.delivered(now: base).isEmpty)

        store.refreshUnread(now: base.addingTimeInterval(11 * 60))
        XCTAssertTrue(store.hasUnread)
    }

    func testMarkAllReadClearsTheBadgeUntilTheNextDelivery() {
        let store = makeStore()
        store.record([entry("a", minutesFromBase: -5), entry("b", minutesFromBase: 10)], now: base)
        XCTAssertTrue(store.hasUnread)

        store.markAllRead(now: base)
        XCTAssertFalse(store.hasUnread)

        store.refreshUnread(now: base.addingTimeInterval(11 * 60))
        XCTAssertTrue(store.hasUnread)
    }

    func testRecordKeepsDeliveredAndReplacesUpcoming() {
        let store = makeStore()
        store.record([entry("past", minutesFromBase: -5), entry("old", minutesFromBase: 10)], now: base)

        store.record([entry("new", minutesFromBase: 20)], now: base)

        XCTAssertEqual(store.entries.map(\.targetID), ["past", "new"])
    }

    func testDeliveredTargetIsNotListedTwiceWhenItsTimeShifts() {
        let store = makeStore()
        store.record([entry("cpi", minutesFromBase: -5)], now: base)

        store.record([entry("cpi", minutesFromBase: -4), entry("cpi", minutesFromBase: 10)], now: base)

        XCTAssertEqual(store.entries.count, 1)
        XCTAssertEqual(store.entries.first?.notifyAt, base.addingTimeInterval(-5 * 60))
    }

    func testDeliveredEntriesAreNewestFirstAndCapped() {
        let store = makeStore()
        let many = (0..<(NotificationsStore.deliveredLimit + 5)).map { entry("\($0)", minutesFromBase: -Double(100 - $0)) }

        store.record(many, now: base)

        let delivered = store.delivered(now: base)
        XCTAssertEqual(delivered.count, NotificationsStore.deliveredLimit)
        XCTAssertEqual(delivered.first?.targetID, "\(NotificationsStore.deliveredLimit + 4)")
    }

    func testEntriesPersistAcrossInstances() {
        let defaults = UserDefaults(suiteName: "NotificationTests-\(UUID().uuidString)")!
        NotificationsStore(userDefaults: defaults).record([entry("a", minutesFromBase: -1)], now: base)

        let reloaded = NotificationsStore(userDefaults: defaults)

        XCTAssertEqual(reloaded.entries.map(\.targetID), ["a"])
    }

    func testSystemEntryIsDeliveredAtOnceAndReplacesThePreviousOne() {
        let store = makeStore()
        store.markAllRead(now: base.addingTimeInterval(-60))

        store.recordSystem(targetID: "settings", title: "通知設定を更新しました", body: "1", now: base)
        store.recordSystem(targetID: "settings", title: "通知設定を更新しました", body: "2", now: base.addingTimeInterval(30))

        let delivered = store.delivered(now: base.addingTimeInterval(30))
        XCTAssertEqual(delivered.map(\.body), ["2"])
        XCTAssertEqual(delivered.first?.kind, .system)
        XCTAssertTrue(store.hasUnread)

        store.record([entry("cpi", minutesFromBase: 10)], now: base.addingTimeInterval(30))
        XCTAssertEqual(store.entries.filter { $0.kind == .system }.count, 1, "refreshing upcoming items keeps system entries")
    }

    func testEntriesStoredBeforeTheDisplayFieldsStillDecode() throws {
        let json = Data(#"[{"kind":"SPEECH","targetID":"s1","title":"t","body":"b","notifyAt":0,"scheduledAt":300,"importance":"HIGH"}]"#.utf8)
        let entries = try JSONDecoder().decode([NotificationEntry].self, from: json)
        XCTAssertEqual(entries.first?.kind, .speech)
        XCTAssertNil(entries.first?.subject)
    }

    func testRemoveAllForgetsEverything() {
        let store = makeStore()
        store.record([entry("a", minutesFromBase: -1)], now: base)

        store.removeAll()

        XCTAssertTrue(store.entries.isEmpty)
        XCTAssertFalse(store.hasUnread)
    }
}

// MARK: - ローカル通知の予約

private final class MockNotificationCenter: UserNotificationCentering {
    var status: UNAuthorizationStatus = .authorized
    var grants = true
    var pending: [UNNotificationRequest] = []
    private(set) var requestedAuthorization = false

    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
        requestedAuthorization = true
        status = grants ? .authorized : .denied
        return grants
    }

    func authorizationStatus() async -> UNAuthorizationStatus { status }
    func pendingNotificationRequests() async -> [UNNotificationRequest] { pending }

    func removePendingNotificationRequests(withIdentifiers identifiers: [String]) {
        pending.removeAll { identifiers.contains($0.identifier) }
    }

    func add(_ request: UNNotificationRequest) async throws {
        pending.append(request)
    }
}

@MainActor
final class LocalNotificationSchedulerTests: XCTestCase {
    private func otherAppRequest() -> UNNotificationRequest {
        UNNotificationRequest(identifier: "other", content: UNMutableNotificationContent(), trigger: nil)
    }

    func testSchedulesOnlyFutureItemsAndKeepsOtherRequests() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(UpcomingNotificationsResponse(leadMinutes: 5, items: [
            upcoming("past", kind: .indicator, notifyAt: base.addingTimeInterval(-60)),
            upcoming("soon", kind: .indicator, notifyAt: base.addingTimeInterval(600)),
            upcoming("speech", kind: .speech, notifyAt: base.addingTimeInterval(1200)),
        ]))
        let center = MockNotificationCenter()
        center.pending = [otherAppRequest(), UNNotificationRequest(identifier: LocalNotificationScheduler.identifierPrefix + "stale", content: UNMutableNotificationContent(), trigger: nil)]
        let store = makeStore()
        let scheduler = LocalNotificationScheduler(apiClient: apiClient, center: center, store: store, now: { base })

        await scheduler.refresh()

        XCTAssertEqual(apiClient.lastEndpoint?.path, "notifications/upcoming")
        XCTAssertEqual(center.pending.map(\.identifier).filter { $0.hasPrefix(LocalNotificationScheduler.identifierPrefix) }.count, 2)
        XCTAssertTrue(center.pending.contains { $0.identifier == "other" })
        XCTAssertFalse(center.pending.contains { $0.identifier.hasSuffix("stale") })
        XCTAssertEqual(store.entries.count, 3)
        XCTAssertTrue(store.hasUnread, "the item whose notify time already passed is listed under the bell")
    }

    func testWithoutPermissionRecordsButDoesNotSchedule() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(UpcomingNotificationsResponse(leadMinutes: 5, items: [
            upcoming("soon", kind: .indicator, notifyAt: base.addingTimeInterval(600)),
        ]))
        let center = MockNotificationCenter()
        center.status = .denied
        let store = makeStore()
        let scheduler = LocalNotificationScheduler(apiClient: apiClient, center: center, store: store, now: { base })

        await scheduler.refresh()

        XCTAssertTrue(center.pending.isEmpty)
        XCTAssertEqual(store.entries.count, 1)
    }

    func testFetchFailureKeepsExistingRequests() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(URLError(.notConnectedToInternet))
        let center = MockNotificationCenter()
        let kept = UNNotificationRequest(identifier: LocalNotificationScheduler.identifierPrefix + "kept", content: UNMutableNotificationContent(), trigger: nil)
        center.pending = [kept]
        let scheduler = LocalNotificationScheduler(apiClient: apiClient, center: center, store: makeStore(), now: { base })

        await scheduler.refresh()

        XCTAssertEqual(center.pending.map(\.identifier), [kept.identifier])
    }

    func testRequestAuthorizationAsksOnlyWhenUndetermined() async {
        let center = MockNotificationCenter()
        let scheduler = LocalNotificationScheduler(apiClient: MockAPIClient(), center: center, store: makeStore())

        let alreadyAuthorized = await scheduler.requestAuthorization()
        XCTAssertTrue(alreadyAuthorized)
        XCTAssertFalse(center.requestedAuthorization)

        center.status = .notDetermined
        center.grants = false
        let granted = await scheduler.requestAuthorization()
        XCTAssertFalse(granted)
        XCTAssertTrue(center.requestedAuthorization)
    }

    func testRequestFiresAtTheNotifyTime() throws {
        let item = entry("e1", minutesFromBase: 0)
        let request = LocalNotificationScheduler.request(for: item)
        let trigger = try XCTUnwrap(request.trigger as? UNCalendarNotificationTrigger)
        XCTAssertEqual(Calendar.current.date(from: trigger.dateComponents), item.notifyAt)
        XCTAssertEqual(request.content.userInfo["id"] as? String, "e1")
    }
}

// MARK: - SCR-016 通知設定(自動保存)

@MainActor
private final class MockScheduler: LocalNotificationScheduling {
    var authorizationResult = true
    var denied = false
    private(set) var refreshCount = 0
    private(set) var authorizationRequests = 0

    func requestAuthorization() async -> Bool {
        authorizationRequests += 1
        return authorizationResult
    }

    func isAuthorizationDenied() async -> Bool { denied }
    func refresh() async { refreshCount += 1 }
}

@MainActor
final class NotificationSettingsViewModelTests: XCTestCase {
    private let settings = SettingsResponse(
        notifications: .defaults,
        display: DisplaySettings.defaults,
        chart: ChartSettings.defaults
    )

    private lazy var store = makeStore()

    private func loadedViewModel(_ apiClient: MockAPIClient, scheduler: MockScheduler) async -> NotificationSettingsViewModel {
        apiClient.result = .success(settings)
        apiClient.results["fx-pairs"] = .success(FXPairListResponse(data: [FXPairResponse(symbol: "USDJPY"), FXPairResponse(symbol: "GBPJPY")]))
        let viewModel = NotificationSettingsViewModel(apiClient: apiClient, scheduler: scheduler, debounce: .milliseconds(30), store: store)
        viewModel.load()
        await waitUntil { viewModel.loadState == .loaded && viewModel.fxPairSymbols == ["USDJPY", "GBPJPY"] }
        return viewModel
    }

    func testChangesAreSavedAutomaticallyAndCoalesced() async throws {
        let apiClient = MockAPIClient()
        let scheduler = MockScheduler()
        let viewModel = await loadedViewModel(apiClient, scheduler: scheduler)
        var stored = settings
        stored.notifications.leadMinutes = 15
        stored.notifications.speeches = false
        apiClient.result = .success(stored)

        viewModel.setLeadMinutes(15)
        viewModel.setSpeeches(false)
        XCTAssertEqual(viewModel.saveState, .saving)
        await waitUntil { viewModel.saveState == .saved }

        XCTAssertEqual(apiClient.requestedPaths.filter { $0 == "settings" }.count, 2, "one GET and a single PATCH")
        XCTAssertEqual(apiClient.lastEndpoint?.method, .patch)
        let body = try jsonObject(apiClient.lastEndpoint?.body)
        XCTAssertEqual(Set(body.keys), ["notifications"])
        let notifications = try XCTUnwrap(body["notifications"] as? [String: Any])
        XCTAssertEqual(notifications["lead_minutes"] as? Int, 15)
        XCTAssertEqual(notifications["speeches"] as? Bool, false)
        XCTAssertEqual(viewModel.settings, stored.notifications)
        XCTAssertEqual(scheduler.refreshCount, 1)
        XCTAssertEqual(store.delivered().map(\.title), ["通知設定を更新しました"])
    }

    func testImportanceKeepsAtLeastOneAndStaysOrdered() async {
        let viewModel = await loadedViewModel(MockAPIClient(), scheduler: MockScheduler())

        viewModel.toggleImportance("LOW")
        XCTAssertEqual(viewModel.settings.importances, ["HIGH", "MEDIUM", "LOW"])
        viewModel.toggleImportance("HIGH")
        viewModel.toggleImportance("MEDIUM")
        viewModel.toggleImportance("LOW")
        XCTAssertEqual(viewModel.settings.importances, ["LOW"])
        XCTAssertEqual(viewModel.importancesLabel, "低")
    }

    func testEmptyPairSelectionMeansAllPairs() async {
        let viewModel = await loadedViewModel(MockAPIClient(), scheduler: MockScheduler())

        viewModel.setFxPairs(["GBPJPY", "USDJPY"])
        XCTAssertEqual(viewModel.settings.fxPairs, ["USDJPY", "GBPJPY"])
        XCTAssertEqual(viewModel.fxPairsLabel, "USD/JPY・GBP/JPY")

        viewModel.setFxPairs([])
        XCTAssertNil(viewModel.settings.fxPairs)
        XCTAssertEqual(viewModel.fxPairsLabel, "すべての通貨ペア")
    }

    func testTurningPushOnAsksForPermission() async {
        let apiClient = MockAPIClient()
        var off = settings
        off.notifications.push = false
        apiClient.result = .success(off)
        let scheduler = MockScheduler()
        scheduler.authorizationResult = false
        let viewModel = NotificationSettingsViewModel(apiClient: apiClient, scheduler: scheduler, debounce: .milliseconds(30), store: store)
        viewModel.load()
        await waitUntil { viewModel.loadState == .loaded }

        viewModel.setPush(true)
        await waitUntil { viewModel.authorizationDenied }

        XCTAssertEqual(scheduler.authorizationRequests, 1)
        XCTAssertTrue(viewModel.authorizationDenied)
        XCTAssertTrue(viewModel.settings.push)
    }

    func testSaveFailureKeepsTheEdit() async {
        let apiClient = MockAPIClient()
        let viewModel = await loadedViewModel(apiClient, scheduler: MockScheduler())
        apiClient.result = .failure(URLError(.timedOut))

        viewModel.setIndicators(false)
        await waitUntil { if case .error = viewModel.saveState { return true } else { return false } }

        XCTAssertFalse(viewModel.settings.indicators)
        if case .error = viewModel.saveState {} else { XCTFail("expected a save error") }
    }
}

// MARK: - 通知一覧の短い表示名

final class IndicatorShortNameTests: XCTestCase {
    func testLongOfficialNamesBecomeCommonAbbreviations() {
        XCTAssertEqual(IndicatorShortName.shorten("Japan Consumer Price Index (YoY)"), "Japan CPI (YoY)")
        XCTAssertEqual(IndicatorShortName.shorten("英) 国内総生産（前期比）"), "英) GDP（前期比）")
        XCTAssertEqual(IndicatorShortName.shorten("ECB Interest Rate Decision"), "ECB Rate Decision")
    }

    func testNamesWithoutAKnownAbbreviationStayAsIs() {
        XCTAssertEqual(IndicatorShortName.shorten("日銀短観"), "日銀短観")
    }
}
