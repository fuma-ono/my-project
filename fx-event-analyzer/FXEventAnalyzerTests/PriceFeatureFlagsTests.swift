import XCTest
@testable import FXEventAnalyzer

/// 2026-11-24(オーナー決定): 1.0は日本国内・FREEのみで公開し、価格由来の情報(為替レート・pips・値動き・
/// チャート・戦略分析・価格アラート)と購入(PRO課金)の導線を見せない。サーバー側のフラグ
/// (`GET /entitlements`の`price_features_enabled`・`purchases_enabled`)で、1.1以降に再有効化できる。
/// iOSの既定はどちらもfalse(読み込み前・オフライン・失敗・ログアウトでも隠す側)。
@MainActor
final class PriceFeatureFlagsTests: XCTestCase {
    private func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    /// 中立の表示に出してはいけない語。
    private let forbiddenWords = ["プレミアム", "PRO", "Pro", "有料", "無料", "プラン", "アップグレード", "課金", "購入", "購読", "料金", "価格", "為替", "pips"]

    private func assertNeutral(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        for word in forbiddenWords {
            XCTAssertFalse(text.contains(word), "「\(text)」に「\(word)」が含まれている", file: file, line: line)
        }
    }

    // MARK: - PlanStore のフラグ

    func testFlagsDefaultToFalse() {
        let store = PlanStore()
        XCTAssertFalse(store.priceFeaturesEnabled)
        XCTAssertFalse(store.purchasesEnabled)
    }

    func testEntitlementsWithoutFlagKeysDecodeAsNil() throws {
        let json = #"{"features":["VIEW_BASIC_EVENT"],"plan":"FREE"}"#.data(using: .utf8)!
        let response = try makeDecoder().decode(EntitlementsResponse.self, from: json)
        XCTAssertNil(response.priceFeaturesEnabled)
        XCTAssertNil(response.purchasesEnabled)
        XCTAssertEqual(response.plan, .free)
    }

    func testEntitlementsWithFlagKeysDecode() throws {
        let json = #"{"features":[],"plan":"FREE","price_features_enabled":true,"purchases_enabled":false}"#.data(using: .utf8)!
        let response = try makeDecoder().decode(EntitlementsResponse.self, from: json)
        XCTAssertEqual(response.priceFeaturesEnabled, true)
        XCTAssertEqual(response.purchasesEnabled, false)
    }

    func testLoadWithoutFlagKeysKeepsFlagsFalse() async {
        let api = MockAPIClient()
        api.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil))
        let store = PlanStore()

        await store.load(apiClient: api)

        XCTAssertTrue(store.isConfirmed)
        XCTAssertFalse(store.priceFeaturesEnabled)
        XCTAssertFalse(store.purchasesEnabled)
    }

    func testLoadReflectsTheFlags() async {
        let api = MockAPIClient()
        api.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil, priceFeaturesEnabled: true, purchasesEnabled: false))
        let store = PlanStore()

        await store.load(apiClient: api)

        XCTAssertTrue(store.priceFeaturesEnabled)
        XCTAssertFalse(store.purchasesEnabled)
    }

    func testFailedLoadResetsFlagsToFalse() async {
        let api = MockAPIClient()
        api.results["entitlements"] = .failure(APIError.transport("offline"))
        let store = PlanStore()
        store.set(plan: .free, limits: .free(), confirmed: true, priceFeaturesEnabled: true, purchasesEnabled: true)

        await store.load(apiClient: api)

        XCTAssertFalse(store.priceFeaturesEnabled, "取得に失敗したら隠す側に戻す")
        XCTAssertFalse(store.purchasesEnabled)
    }

    func testResetClearsFlags() {
        let store = PlanStore()
        store.set(plan: .free, limits: .free(), confirmed: true, priceFeaturesEnabled: true, purchasesEnabled: true)
        store.reset()
        XCTAssertFalse(store.priceFeaturesEnabled)
        XCTAssertFalse(store.purchasesEnabled)
    }

    // MARK: - 価格キーが無い応答のデコード

    func testComparisonResponseDecodesValueOnlyJSON() throws {
        let json = """
        {
          "indicator": { "id": "10000000-0000-0000-0000-000000000001", "code": "US_CPI", "name": "US CPI" },
          "timeframe": "5m",
          "total_events": 3,
          "events": [
            { "event_id": "30000000-0000-0000-0000-000000000001", "release_datetime": "2026-09-10T12:30:00.000Z", "forecast": 3.1, "actual": 3.3, "previous": 3.0, "surprise": 0.2, "surprise_direction": "POSITIVE" }
          ],
          "meta": { "page": 1, "limit": 20, "total": 3, "has_next": false },
          "history_limit": { "applied": 3, "max_for_plan": 3, "pro_max": 20 }
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(ComparisonResponse.self, from: json)

        XCTAssertNil(response.fxPairId)
        XCTAssertNil(response.stats)
        XCTAssertNil(response.advancedStatistics)
        XCTAssertNil(response.analyzableEvents)
        XCTAssertEqual(response.totalEvents, 3)
        XCTAssertEqual(response.events.count, 1)
        XCTAssertNil(response.events[0].pipsByTimeframe)
    }

    func testEventDetailRelatedPairDecodesWithoutReaction() throws {
        let json = #"{"fx_pair_id":"fx_1","symbol":"USDJPY","priority":1}"#.data(using: .utf8)!
        let pair = try makeDecoder().decode(EventRelatedFxPair.self, from: json)
        XCTAssertEqual(pair.symbol, "USDJPY")
        XCTAssertNil(pair.reaction)
    }

    func testSpeakerComparisonDecodesWithoutPips() throws {
        let json = """
        {
          "speaker": { "speaker_id": "s1", "name": "Jerome Powell", "title": "議長", "organization": "FRB", "country_code": "US", "currency_code": "USD" },
          "fx_pair_id": null,
          "symbol": null,
          "events": [
            { "speech_id": "sp1", "title": "講演", "statement_datetime": "2026-09-10T12:30:00.000Z", "importance": "HIGH" }
          ],
          "history_limit": null
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(SpeakerComparisonResponse.self, from: json)

        XCTAssertEqual(response.events.count, 1)
        XCTAssertNil(response.events[0].pipsByTimeframe)
        XCTAssertNil(response.symbol)
    }

    // MARK: - 中立の文言

    func testNeutralTextHasNoPriceOrPurchaseWords() {
        assertNeutral(PlanNeutralText.title)
        assertNeutral(PlanNeutralText.defaultMessage)
        assertNeutral(PlanNeutralText.closeButton)
        assertNeutral(PlanNeutralText.preparing)
        assertNeutral(PlanNeutralText.preparingShort)
        assertNeutral(HistoricalComparisonView.neutralLimitText(maxForPlan: 3))
        assertNeutral(IndicatorDetailCard.comparisonSubtitle(priceFeaturesEnabled: false))
        assertNeutral(CalendarViewModel.needsProMessageNeutral)
    }

    func testPastReleaseLockTextIsNeutralWhenPurchasesAreDisabled() {
        PlanStore.shared.reset()
        defer { PlanStore.shared.reset() }
        assertNeutral(PastReleaseLock.label)
        assertNeutral(PastReleaseLock.previousShortLabel)
        assertNeutral(PastReleaseLock.movementLockedMessage)
        assertNeutral(PastReleaseLock.promptMessage(maxForPlan: 3))
        XCTAssertTrue(PastReleaseLock.promptMessage(maxForPlan: nil).contains("直近3回"))
    }

    func testPastReleaseLockTextKeepsThePaidWordingWhenPurchasesAreEnabled() {
        PlanStore.shared.set(plan: .free, limits: .free(), confirmed: true, priceFeaturesEnabled: true, purchasesEnabled: true)
        defer { PlanStore.shared.reset() }
        XCTAssertEqual(PastReleaseLock.label, "有料プランで見られます")
        XCTAssertEqual(PastReleaseLock.previousShortLabel, "有料プラン")
    }

    func testSanitizedMessageDropsPriceAndPlanWords() {
        XCTAssertEqual(PlanNeutralText.sanitized("プレミアムプランなら全部見られます。"), PlanNeutralText.defaultMessage)
        XCTAssertEqual(PlanNeutralText.sanitized(nil), PlanNeutralText.defaultMessage)
        XCTAssertEqual(PlanNeutralText.sanitized("お気に入りは3件までです。"), "お気に入りは3件までです。")
    }

    // MARK: - ヘルプ・出典・設定

    func testHelpFAQHidesBillingAndChartWhenFlagsAreOff() {
        let visible = HelpFAQ.visibleCategories(priceFeaturesEnabled: false, purchasesEnabled: false)
        XCTAssertEqual(visible.map(\.title), ["アカウントについて", "通知について", "データの見方", "その他"])
        for category in visible {
            for item in category.items {
                assertNeutral(item.question)
                assertNeutral(item.answer)
            }
        }
    }

    func testHelpFAQIsUnchangedWhenFlagsAreOn() {
        let visible = HelpFAQ.visibleCategories(priceFeaturesEnabled: true, purchasesEnabled: true)
        XCTAssertEqual(visible, HelpFAQ.categories)
    }

    func testDataSourcesDocumentDropsThePriceSectionWhenPriceFeaturesAreOff() {
        let off = AppInfo.visibleDataSourcesDocument(priceFeaturesEnabled: false)
        XCTAssertFalse(off.sections.contains { $0.heading == AppInfo.priceSectionHeading })
        let on = AppInfo.visibleDataSourcesDocument(priceFeaturesEnabled: true)
        XCTAssertEqual(on.sections.map(\.heading), AppInfo.dataSourcesDocument.sections.map(\.heading))
    }

    func testSettingsGroupRowsAndPositionsFollowTheFlags() {
        XCTAssertEqual(SettingsView.group1RowCount(purchasesEnabled: false, priceFeaturesEnabled: false), 4)
        XCTAssertEqual(SettingsView.group1RowCount(purchasesEnabled: true, priceFeaturesEnabled: false), 5)
        XCTAssertEqual(SettingsView.group1RowCount(purchasesEnabled: true, priceFeaturesEnabled: true), 6)
        // 6行(従来)のときは、従来の位置(54.5 + 6×31 + 8)のまま。
        let expectedGroup2Top: CGFloat = 54.5 + 6 * 31 + 8
        XCTAssertEqual(SettingsView.group2Top(group1Rows: 6), expectedGroup2Top)
        let expectedLogoutTop: CGFloat = expectedGroup2Top + 4 * 31 + 8
        XCTAssertEqual(SettingsView.logoutTop(group1Rows: 6), expectedLogoutTop)
        // 4行のときは、2行ぶん(62)上に詰まる。
        let top4: CGFloat = SettingsView.group2Top(group1Rows: 4)
        let top6: CGFloat = SettingsView.group2Top(group1Rows: 6)
        XCTAssertEqual(top4, top6 - 62)
    }

    func testHistoricalValueColumnsFitTheTableWithoutPips() {
        // pipsの列が無いとき、日時(40)+区切り線+数値の列が表の幅(214)にちょうど収まる。
        let widthPrimary: CGFloat = HistoricalComparisonView.valueColumnWidthWithoutPips(showSecondary: false)
        let totalPrimary: CGFloat = 40 + 0.5 + widthPrimary * 3
        XCTAssertEqual(totalPrimary, 214, accuracy: 0.001)
        let widthSecondary: CGFloat = HistoricalComparisonView.valueColumnWidthWithoutPips(showSecondary: true)
        let totalSecondary: CGFloat = 40 + 1.0 + widthSecondary * 6
        XCTAssertEqual(totalSecondary, 214, accuracy: 0.001)
    }

    func testIndicatorDetailOpensComparisonWithoutAPairWhenPriceFeaturesAreOff() {
        XCTAssertNotNil(IndicatorDetailCard.valueOnlyPair(priceFeaturesEnabled: false))
        XCTAssertNil(IndicatorDetailCard.valueOnlyPair(priceFeaturesEnabled: true))
    }

    // MARK: - 通知(古いレートアラートの記録)

    func testRateAlertRecordsAreHiddenWhenPriceFeaturesAreOff() {
        PlanStore.shared.reset()
        defer { PlanStore.shared.reset() }
        let store = NotificationsStore(userDefaults: UserDefaults(suiteName: "PriceFeatureFlagsTests-\(UUID().uuidString)")!)
        let now = Date()
        let alert = NotificationEntry(
            kind: .rateAlert, targetID: "ra1", title: "USD/JPY", body: "150円を上回りました",
            notifyAt: now.addingTimeInterval(-60), scheduledAt: now.addingTimeInterval(-120), importance: "LOW"
        )
        store.record([alert], now: now)

        XCTAssertEqual(store.entries.count, 1, "記録そのものは消さない")
        XCTAssertTrue(store.delivered(now: now).isEmpty)
        store.refreshUnread(now: now)
        XCTAssertFalse(store.hasUnread)

        PlanStore.shared.set(plan: .free, limits: .free(), confirmed: true, priceFeaturesEnabled: true)
        XCTAssertEqual(store.delivered(now: now).count, 1)
    }
}
