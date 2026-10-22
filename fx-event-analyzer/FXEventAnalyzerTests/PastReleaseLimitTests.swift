import XCTest
@testable import FXEventAnalyzer

private func waitUntil(_ condition: @escaping () -> Bool) async {
    for _ in 0..<100 {
        if condition() { return }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
}

/// 無料プランの「過去の発表」制限(api-design v1.33 §12・§13.3・§14.1・§27・§28.2、
/// HQ判断 2026-10-22)。新しい項目(`locked`・`required_plan`・`past_release_limit`・
/// `past_releases_max`)が無い古いBackendの応答もそのまま読めることを確かめる。
@MainActor
final class PastReleaseLimitTests: XCTestCase {
    private func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    // MARK: - GET /indicators/{id}/events

    func testIndicatorEventsDecodeLockedRowAndPastReleaseLimit() throws {
        let json = """
        {
          "data": [
            {
              "event_id": "evt_new",
              "indicator_id": "ind_1",
              "release_datetime": "2026-09-10T12:30:00Z",
              "release_datetime_precision": "EXACT",
              "importance": "HIGH",
              "status": "RELEASED",
              "data_status": "READY",
              "forecast": 3.1,
              "actual": 3.3,
              "previous": 3.0,
              "surprise": 0.2,
              "surprise_direction": "POSITIVE",
              "locked": false,
              "required_plan": null
            },
            {
              "event_id": "evt_old",
              "indicator_id": "ind_1",
              "release_datetime": "2026-05-10T12:30:00Z",
              "release_datetime_precision": "EXACT",
              "importance": "HIGH",
              "status": "RELEASED",
              "data_status": "READY",
              "forecast": null,
              "actual": null,
              "previous": null,
              "surprise": null,
              "surprise_direction": null,
              "locked": true,
              "required_plan": "PRO"
            }
          ],
          "meta": { "page": 1, "limit": 20, "total": 2, "has_next": false },
          "past_release_limit": { "applied": true, "max_for_plan": 3, "pro_max": null }
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(IndicatorEventsListResponse.self, from: json)

        XCTAssertEqual(response.data.map(\.isLocked), [false, true])
        XCTAssertNil(response.data[0].requiredPlan)
        XCTAssertEqual(response.data[1].requiredPlan, "PRO")
        XCTAssertNil(response.data[1].actual)
        XCTAssertEqual(response.pastReleaseLimit, PastReleaseLimit(applied: true, maxForPlan: 3, proMax: nil))
    }

    func testIndicatorEventsFromOlderBackendDecodeAsUnlocked() throws {
        let json = """
        {
          "data": [
            {
              "event_id": "evt_1",
              "release_datetime": "2026-09-10T12:30:00Z",
              "status": "RELEASED",
              "data_status": "READY",
              "forecast": 3.1,
              "actual": 3.3,
              "previous": 3.0,
              "surprise": 0.2,
              "surprise_direction": "POSITIVE"
            }
          ],
          "meta": { "page": 1, "limit": 10, "total": 1, "has_next": false }
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(IndicatorEventsListResponse.self, from: json)

        XCTAssertEqual(response.data.first?.isLocked, false)
        XCTAssertNil(response.data.first?.requiredPlan)
        XCTAssertNil(response.pastReleaseLimit)
    }

    // MARK: - GET /home

    func testHomeDecodesLockedEventAndPastReleaseLimit() throws {
        let json = """
        {
          "date": "2026-09-10",
          "timezone": "UTC",
          "events": [
            {
              "event_id": "evt_old",
              "indicator_id": "ind_1",
              "indicator_name": "US Consumer Price Index (YoY)",
              "country_code": "US",
              "currency_code": "USD",
              "importance": "HIGH",
              "release_datetime": "2026-09-10T12:30:00Z",
              "release_datetime_precision": "EXACT",
              "status": "RELEASED",
              "data_status": "READY",
              "forecast": null,
              "actual": null,
              "previous": null,
              "surprise": null,
              "surprise_direction": null,
              "related_fx_pairs": [],
              "locked": true,
              "required_plan": "PRO"
            }
          ],
          "major_fx": [],
          "past_release_limit": { "applied": false, "max_for_plan": null, "pro_max": null }
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(HomeResponse.self, from: json)

        XCTAssertEqual(response.events.first?.isLocked, true)
        XCTAssertEqual(response.events.first?.requiredPlan, "PRO")
        XCTAssertEqual(response.pastReleaseLimit, PastReleaseLimit(applied: false, maxForPlan: nil, proMax: nil))
    }

    func testHomeFromOlderBackendDecodesAsUnlocked() throws {
        let json = """
        {
          "date": "2026-09-10",
          "timezone": "UTC",
          "events": [
            {
              "event_id": "evt_1",
              "indicator_id": "ind_1",
              "indicator_name": "US CPI",
              "country_code": "US",
              "currency_code": "USD",
              "importance": "HIGH",
              "release_datetime": "2026-09-10T12:30:00Z",
              "release_datetime_precision": "EXACT",
              "status": "RELEASED",
              "data_status": "READY",
              "forecast": 3.1,
              "actual": 3.3,
              "previous": 3.0,
              "surprise": 0.2,
              "surprise_direction": "POSITIVE",
              "related_fx_pairs": []
            }
          ],
          "major_fx": []
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(HomeResponse.self, from: json)

        XCTAssertEqual(response.events.first?.isLocked, false)
        XCTAssertNil(response.events.first?.requiredPlan)
        XCTAssertNil(response.pastReleaseLimit)
    }

    // MARK: - GET /events/{id}

    func testEventDetailDecodesLockedResponseWithNullAnalysis() throws {
        let json = """
        {
          "event": {
            "id": "evt_old",
            "indicator_id": "ind_1",
            "indicator_name": "US Consumer Price Index (YoY)",
            "display_name": null,
            "country_code": "US",
            "currency_code": "USD",
            "release_datetime": "2026-05-10T12:30:00Z",
            "release_datetime_precision": "EXACT",
            "importance": "HIGH",
            "status": "RELEASED",
            "data_status": "READY",
            "revision_status": null,
            "locked": true,
            "required_plan": "PRO"
          },
          "snapshot": {
            "forecast": null, "actual": null, "previous": null,
            "surprise": null, "surprise_direction": null,
            "unit": "%", "source": "U.S. Bureau of Labor Statistics", "source_url": null,
            "captured_at": "2026-05-10T12:30:05Z"
          },
          "analysis": { "surprise": null, "surprise_direction": null },
          "explanation": null,
          "related_fx_pairs": [
            {
              "fx_pair_id": "fx_1",
              "symbol": "USDJPY",
              "priority": 1,
              "reaction": { "timeframe": "5m", "pips": null, "change_percent": null, "analysis_status": null }
            }
          ],
          "major_fx_reactions": [
            {
              "fx_pair_id": "fx_1",
              "symbol": "USDJPY",
              "reactions": [
                { "timeframe": "1m", "pips": null, "change_percent": null, "analysis_status": null },
                { "timeframe": "5m", "pips": null, "change_percent": null, "analysis_status": null },
                { "timeframe": "15m", "pips": null, "change_percent": null, "analysis_status": null }
              ]
            }
          ],
          "available_timeframes": ["1m", "5m", "15m", "30m", "60m"]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(EventDetailResponse.self, from: json)

        XCTAssertTrue(response.event.isLocked)
        XCTAssertEqual(response.event.requiredPlan, "PRO")
        XCTAssertNil(response.event.revisionStatus)
        XCTAssertNil(response.snapshot?.actual)
        XCTAssertEqual(response.snapshot?.unit, "%")
        XCTAssertNil(response.analysis.surprise)
        XCTAssertNil(response.explanation)
        XCTAssertNil(response.relatedFxPairs.first?.reaction.analysisStatus)
        XCTAssertEqual(response.majorFxReactions?.first?.reactions.count, 3)
    }

    /// api-design v1.33: ロックされた発表の`revision_status`・`analysis_status`は`null`ではなく固定値。
    /// 古いアプリ(ビルド17/18)の型(どちらも非optional)でも読め、新しいアプリは`locked`を先に見る。
    private static let lockedDetailWithPlaceholdersJSON = """
    {
      "event": {
        "id": "evt_old",
        "indicator_id": "ind_1",
        "indicator_name": "US Consumer Price Index (YoY)",
        "display_name": null,
        "country_code": "US",
        "currency_code": "USD",
        "release_datetime": "2026-05-10T12:30:00Z",
        "release_datetime_precision": "EXACT",
        "importance": "HIGH",
        "status": "RELEASED",
        "data_status": "READY",
        "revision_status": "NONE",
        "locked": true,
        "required_plan": "PRO"
      },
      "snapshot": {
        "forecast": null, "actual": null, "previous": null,
        "surprise": null, "surprise_direction": null,
        "unit": "%", "source": "U.S. Bureau of Labor Statistics", "source_url": null,
        "captured_at": "2026-05-10T12:30:05Z"
      },
      "analysis": { "surprise": null, "surprise_direction": null },
      "explanation": null,
      "related_fx_pairs": [
        {
          "fx_pair_id": "fx_1",
          "symbol": "USDJPY",
          "priority": 1,
          "reaction": { "timeframe": "5m", "pips": null, "change_percent": null, "analysis_status": "NOT_ANALYZABLE" }
        }
      ],
      "major_fx_reactions": [
        {
          "fx_pair_id": "fx_1",
          "symbol": "USDJPY",
          "reactions": [
            { "timeframe": "1m", "pips": null, "change_percent": null, "analysis_status": "NOT_ANALYZABLE" },
            { "timeframe": "5m", "pips": null, "change_percent": null, "analysis_status": "NOT_ANALYZABLE" },
            { "timeframe": "15m", "pips": null, "change_percent": null, "analysis_status": "NOT_ANALYZABLE" }
          ]
        }
      ],
      "available_timeframes": ["1m", "5m", "15m", "30m", "60m"]
    }
    """

    func testEventDetailDecodesLockedResponseWithPlaceholderStatuses() throws {
        let json = Self.lockedDetailWithPlaceholdersJSON.data(using: .utf8)!

        let response = try makeDecoder().decode(EventDetailResponse.self, from: json)

        // 新しいアプリ: locked を先に見る。値は無く、相場反応詳細へは進まない。
        XCTAssertTrue(response.event.isLocked)
        XCTAssertEqual(response.event.requiredPlan, "PRO")
        XCTAssertNil(response.snapshot?.actual)
        XCTAssertNil(response.relatedFxPairs.first?.reaction.pips)
        let cards = EventDetailCards(response: response)
        XCTAssertTrue(cards.isLocked)
        XCTAssertFalse(cards.canOpenReactions)
    }

    /// 古いアプリ(ビルド17/18、489da7c7)の`EventDetailEvent.revisionStatus`・
    /// `EventReactionSummary.analysisStatus`は非optional。同じ形で読めることを確かめる。
    private struct LegacyEventDetail: Decodable {
        struct Event: Decodable {
            let status: EventStatus
            let dataStatus: DataQualityStatus
            let revisionStatus: RevisionStatus

            enum CodingKeys: String, CodingKey {
                case status
                case dataStatus = "data_status"
                case revisionStatus = "revision_status"
            }
        }
        struct Reaction: Decodable {
            let analysisStatus: DataQualityStatus

            enum CodingKeys: String, CodingKey {
                case analysisStatus = "analysis_status"
            }
        }
        struct Pair: Decodable {
            let reaction: Reaction
        }
        struct MajorPair: Decodable {
            let reactions: [Reaction]
        }
        let event: Event
        let relatedFxPairs: [Pair]
        let majorFxReactions: [MajorPair]

        enum CodingKeys: String, CodingKey {
            case event
            case relatedFxPairs = "related_fx_pairs"
            case majorFxReactions = "major_fx_reactions"
        }
    }

    func testLockedEventDetailDecodesWithLegacyNonOptionalStatuses() throws {
        let json = Self.lockedDetailWithPlaceholdersJSON.data(using: .utf8)!

        let legacy = try makeDecoder().decode(LegacyEventDetail.self, from: json)

        XCTAssertEqual(legacy.event.revisionStatus, RevisionStatus.none)
        XCTAssertEqual(legacy.relatedFxPairs.first?.reaction.analysisStatus, .notAnalyzable)
        XCTAssertEqual(legacy.majorFxReactions.first?.reactions.map(\.analysisStatus), [.notAnalyzable, .notAnalyzable, .notAnalyzable])
    }

    func testEventDetailFromOlderBackendDecodesAsUnlocked() throws {
        let json = """
        {
          "event": {
            "id": "evt_1",
            "indicator_id": "ind_1",
            "indicator_name": "US CPI",
            "country_code": "US",
            "currency_code": "USD",
            "release_datetime": "2026-09-10T12:30:00Z",
            "release_datetime_precision": "EXACT",
            "importance": "HIGH",
            "status": "RELEASED",
            "data_status": "READY",
            "revision_status": "NONE"
          },
          "snapshot": null,
          "analysis": { "surprise": null, "surprise_direction": null },
          "explanation": null,
          "related_fx_pairs": [],
          "available_timeframes": ["1m", "5m"]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(EventDetailResponse.self, from: json)

        XCTAssertFalse(response.event.isLocked)
        XCTAssertNil(response.event.requiredPlan)
        XCTAssertEqual(response.event.revisionStatus, RevisionStatus.none)
    }

    // MARK: - GET /indicators/{id}/comparison(api-design v1.33 §21)

    private static func comparisonJSON(events: String, extra: String = "") -> Data {
        """
        {
          "indicator": { "id": "ind_1", "code": "US_CPI", "name": "US CPI", "display_name": null,
                         "country_code": "US", "currency_code": "USD", "unit": "%" },
          "fx_pair_id": "fx_1",
          "timeframe": "5m",
          "total_events": 1,
          "analyzable_events": 1,
          "stats": { "average_movement": 0.2, "average_pips": 20.0, "max_movement": 0.2, "min_movement": 0.2,
                     "upward_count": 1, "downward_count": 0, "no_change_count": 0 },
          "advanced_statistics": { "available": false, "required_entitlement": "VIEW_ADVANCED_STATS", "data": null },
          "events": [\(events)],
          "meta": { "page": 1, "limit": 20, "total": 3, "has_next": false },
          "history_limit": { "applied": 3, "max_for_plan": 5, "pro_max": 20 }\(extra)
        }
        """.data(using: .utf8)!
    }

    func testComparisonDecodesLockedRowsWithNullValues() throws {
        let json = Self.comparisonJSON(events: """
            { "event_id": "evt_new", "release_datetime": "2026-09-10T12:30:00Z",
              "forecast": 3.0, "actual": 3.2, "previous": 3.1, "surprise": 0.2, "surprise_direction": "POSITIVE",
              "locked": false, "required_plan": null,
              "pips_by_timeframe": { "1m": 7.7, "5m": 20.0, "15m": null } },
            { "event_id": "evt_old", "release_datetime": "2026-05-10T12:30:00Z",
              "forecast": null, "actual": null, "previous": null, "surprise": null, "surprise_direction": null,
              "locked": true, "required_plan": "PRO",
              "pips_by_timeframe": { "1m": null, "5m": null, "15m": null } },
            { "event_id": "evt_older", "release_datetime": "2026-04-10T12:30:00Z",
              "forecast": null, "actual": null, "previous": null, "surprise": null, "surprise_direction": null,
              "locked": true, "required_plan": "PRO", "pips_by_timeframe": null }
            """, extra: """
            ,
              "past_release_limit": { "applied": true, "max_for_plan": 3, "pro_max": null }
            """)

        let response = try makeDecoder().decode(ComparisonResponse.self, from: json)

        XCTAssertEqual(response.events.map(\.isLocked), [false, true, true])
        XCTAssertEqual(response.events[0].pipsByTimeframe?["5m"] ?? nil, 20.0)
        XCTAssertNil(response.events[0].requiredPlan)
        XCTAssertEqual(response.events[1].requiredPlan, "PRO")
        XCTAssertNil(response.events[1].actual)
        XCTAssertNil(response.events[1].pipsByTimeframe?["5m"] ?? nil)
        XCTAssertNil(response.events[2].pipsByTimeframe)
        XCTAssertEqual(response.pastReleaseLimit, PastReleaseLimit(applied: true, maxForPlan: 3, proMax: nil))
    }

    func testComparisonFromOlderBackendDecodesAsUnlocked() throws {
        let json = Self.comparisonJSON(events: """
            { "event_id": "evt_1", "release_datetime": "2026-09-10T12:30:00Z",
              "forecast": 3.0, "actual": 3.2, "previous": 3.1, "surprise": 0.2, "surprise_direction": "POSITIVE",
              "pips_by_timeframe": { "1m": 7.7, "5m": 20.0, "15m": -3.0 } }
            """)

        let response = try makeDecoder().decode(ComparisonResponse.self, from: json)

        XCTAssertFalse(response.events[0].isLocked)
        XCTAssertNil(response.events[0].requiredPlan)
        XCTAssertNil(response.pastReleaseLimit)
        XCTAssertEqual(response.events[0].actual, 3.2)
    }

    // MARK: - GET /entitlements・PlanStore

    func testPlanLimitsDefaults() {
        XCTAssertEqual(PlanLimits.free().pastReleasesMax, 3)
        XCTAssertNil(PlanLimits.pro().pastReleasesMax)
    }

    func testEntitlementsLimitsDecodePastReleasesMax() throws {
        let json = """
        {
          "features": ["VIEW_BASIC_EVENT"],
          "plan": "FREE",
          "limits": {
            "calendar_earliest_from": "2026-09-01T00:00:00Z",
            "calendar_latest_to": "2028-01-01T00:00:00Z",
            "favorites_max": 3,
            "notification_importances": ["HIGH"],
            "notification_fx_pairs_max": 1,
            "history_events_max": 5,
            "past_releases_max": 3
          }
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(EntitlementsResponse.self, from: json)

        XCTAssertEqual(response.limits?.pastReleasesMax, 3)
    }

    func testEntitlementsLimitsFromOlderBackendDecodeWithoutPastReleasesMax() throws {
        let json = """
        {
          "features": [],
          "plan": "PRO",
          "limits": {
            "calendar_earliest_from": "2021-01-01T00:00:00Z",
            "calendar_latest_to": "2028-01-01T00:00:00Z",
            "favorites_max": null,
            "notification_importances": ["HIGH", "MEDIUM", "LOW"],
            "notification_fx_pairs_max": null,
            "history_events_max": 20,
            "past_releases_max": null
          }
        }
        """.data(using: .utf8)!
        let older = """
        {
          "features": [],
          "plan": "FREE",
          "limits": {
            "calendar_earliest_from": "2026-09-01T00:00:00Z",
            "calendar_latest_to": "2028-01-01T00:00:00Z",
            "favorites_max": 3,
            "notification_importances": ["HIGH"],
            "notification_fx_pairs_max": 1,
            "history_events_max": 5
          }
        }
        """.data(using: .utf8)!

        XCTAssertNil(try makeDecoder().decode(EntitlementsResponse.self, from: json).limits?.pastReleasesMax)
        let olderLimits = try XCTUnwrap(makeDecoder().decode(EntitlementsResponse.self, from: older).limits)
        XCTAssertNil(olderLimits.pastReleasesMax)
        XCTAssertEqual(olderLimits.historyEventsMax, 5)
    }

    func testPlanStoreResetReturnsToFreeDefaults() {
        let store = PlanStore()
        store.set(plan: .pro, limits: .pro())
        XCTAssertTrue(store.isPro)

        store.reset()

        XCTAssertFalse(store.isPro)
        XCTAssertEqual(store.limits.pastReleasesMax, 3)
        XCTAssertEqual(store.limits.favoritesMax, 3)
    }

    // MARK: - 画面に出す値

    func testLockedIndicatorReleaseExposesNoValues() {
        let locked = IndicatorEventSummary(
            id: "evt_old", releaseDatetime: Date(), status: .released, dataStatus: .ready,
            forecast: nil, actual: nil, previous: nil, surprise: nil, surpriseDirection: nil,
            locked: true, requiredPlan: "PRO"
        )
        let unlocked = IndicatorEventSummary(
            id: "evt_new", releaseDatetime: Date(), status: .released, dataStatus: .ready,
            forecast: 3.1, actual: 3.3, previous: 3.0, surprise: 0.2, surpriseDirection: .positive
        )

        XCTAssertNil(IndicatorReleasesView.releaseValues(locked))
        XCTAssertNotNil(IndicatorReleasesView.releaseValues(unlocked))
    }

    func testLockedHomeEventHasNoSubtitleValues() {
        let locked = HomeEventSummary(
            id: "evt_old", indicatorId: "ind_1", indicatorName: "US CPI", countryCode: "US", currencyCode: "USD",
            importance: .high, releaseDatetime: Date(), releaseDatetimePrecision: .exact, status: .released,
            dataStatus: .ready, forecast: 3.1, actual: nil, previous: 3.0, surprise: nil, surpriseDirection: nil,
            relatedFxPairs: [], locked: true, requiredPlan: "PRO"
        )
        let unlocked = HomeEventSummary(
            id: "evt_new", indicatorId: "ind_1", indicatorName: "US CPI", countryCode: "US", currencyCode: "USD",
            importance: .high, releaseDatetime: Date(), releaseDatetimePrecision: .exact, status: .released,
            dataStatus: .ready, forecast: 3.1, actual: 3.3, previous: 3.0, surprise: 0.2, surpriseDirection: .positive,
            relatedFxPairs: []
        )

        // 値が(誤って)入っていても、ロックされた行には出さない。
        XCTAssertNil(HomeView.eventSubtitle(locked))
        XCTAssertNotNil(HomeView.eventSubtitle(unlocked))
    }

    func testLockedPromptMessageMentionsPlanCount() {
        XCTAssertTrue(PastReleaseLock.promptMessage(maxForPlan: 3).contains("直近3回"))
        XCTAssertTrue(PastReleaseLock.promptMessage(maxForPlan: nil).contains("直近3回"))
    }

    // MARK: - 子のAPIの403 PLAN_LIMIT_EXCEEDED

    func testMovementDetailShowsPastReleaseLockedOnPlanLimitExceeded() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(
            APIError.server(code: .planLimitExceeded, message: "This past release is not available on the FREE plan.", httpStatus: 403)
        )

        let viewModel = MovementDetailViewModel(
            apiClient: apiClient, eventId: "evt_old", indicatorId: "ind_1", fxPairId: "fx_1", symbol: "USDJPY",
            indicatorName: "US CPI", releaseDatetime: Date()
        )
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .pastReleaseLocked)
    }

    func testPlanLimitExceededErrorCodeDecodes() {
        XCTAssertEqual(APIErrorCode(rawValue: "PLAN_LIMIT_EXCEEDED"), .planLimitExceeded)
    }
}
