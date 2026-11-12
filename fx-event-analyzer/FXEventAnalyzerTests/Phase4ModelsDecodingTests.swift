import XCTest
@testable import FXEventAnalyzer

/// Real-JSON decoding tests for Phase 4's DTOs, matching the Backend's
/// actual response shapes verbatim (fx-event-analyzer-backend/src/routes/
/// {events,historical}.ts) — same rationale as Phase3ModelsDecodingTests.
final class Phase4ModelsDecodingTests: XCTestCase {
    private func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    // MARK: - Reaction (src/routes/events.ts, timeframe=all — api-design.md §18.1)

    func testReactionAllTimeframesResponseDecodesEveryDataQualityState() throws {
        let json = """
        {
          "event_id": "30000000-0000-0000-0000-000000000001",
          "fx_pair_id": "20000000-0000-0000-0000-000000000001",
          "pre_release_price": 147.123,
          "reactions": [
            {
              "timeframe": "1m",
              "post_release_price": null,
              "movement": null,
              "pips": null,
              "change_percent": null,
              "max_upward": null,
              "max_downward": null,
              "max_upward_pips": null,
              "max_downward_pips": null,
              "analysis_status": "NOT_ANALYZABLE"
            },
            {
              "timeframe": "5m",
              "post_release_price": 147.403,
              "movement": 0.28,
              "pips": 28.0,
              "change_percent": 0.1903,
              "max_upward": 0.30,
              "max_downward": -0.05,
              "max_upward_pips": 30.0,
              "max_downward_pips": -5.0,
              "analysis_status": "READY"
            },
            {
              "timeframe": "15m",
              "post_release_price": 147.123,
              "movement": 0.0,
              "pips": 0.0,
              "change_percent": 0.0,
              "max_upward": 0.0,
              "max_downward": 0.0,
              "max_upward_pips": 0.0,
              "max_downward_pips": 0.0,
              "analysis_status": "READY"
            },
            {
              "timeframe": "30m",
              "post_release_price": null,
              "movement": null,
              "pips": null,
              "change_percent": null,
              "max_upward": null,
              "max_downward": null,
              "max_upward_pips": null,
              "max_downward_pips": null,
              "analysis_status": "DATA_PENDING"
            },
            {
              "timeframe": "60m",
              "post_release_price": null,
              "movement": null,
              "pips": null,
              "change_percent": null,
              "max_upward": null,
              "max_downward": null,
              "max_upward_pips": null,
              "max_downward_pips": null,
              "analysis_status": "DATA_UNAVAILABLE"
            }
          ]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(ReactionAllTimeframesResponse.self, from: json)

        XCTAssertEqual(response.reactions.count, 5)
        XCTAssertEqual(response.reactions.map(\.timeframe), ["1m", "5m", "15m", "30m", "60m"])
        XCTAssertEqual(response.reactions.map(\.analysisStatus), [.notAnalyzable, .ready, .ready, .dataPending, .dataUnavailable])

        let fiveMin = response.reactions[1]
        XCTAssertEqual(fiveMin.pips, 28.0)
        XCTAssertEqual(fiveMin.changePercent, 0.1903)
        XCTAssertEqual(fiveMin.maxUpward, 0.30)
        XCTAssertEqual(fiveMin.maxDownward, -0.05)
        XCTAssertEqual(fiveMin.maxUpwardPips, 30.0)
        XCTAssertEqual(fiveMin.maxDownwardPips, -5.0)

        // Zero movement decodes as a real 0, never confused with a missing value.
        let fifteenMin = response.reactions[2]
        XCTAssertEqual(fifteenMin.movement, 0.0)
        XCTAssertEqual(fifteenMin.pips, 0.0)
        XCTAssertNotNil(fifteenMin.pips)
    }

    // MARK: - Chart (src/routes/events.ts §19)

    func testChartResponseDecodesRealBackendShape() throws {
        let json = """
        {
          "event_id": "30000000-0000-0000-0000-000000000001",
          "fx_pair_id": "20000000-0000-0000-0000-000000000001",
          "timeframe": "1m",
          "release_datetime": "2026-09-10T12:30:00.000Z",
          "prices": [
            { "timestamp": "2026-09-10T12:29:00.000Z", "open": 147.18, "high": 147.22, "low": 147.17, "close": 147.20, "volume": null },
            { "timestamp": "2026-09-10T12:30:00.000Z", "open": 147.20, "high": 147.50, "low": 147.19, "close": 147.48, "volume": null }
          ]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(ChartResponse.self, from: json)

        XCTAssertEqual(response.prices.count, 2)
        XCTAssertEqual(response.prices.last?.close, 147.48)
        XCTAssertEqual(response.timeframe, "1m")
    }

    func testChartResponseDecodesAnEmptyPricesArray() throws {
        let json = """
        {
          "event_id": "30000000-0000-0000-0000-000000000003",
          "fx_pair_id": "20000000-0000-0000-0000-000000000001",
          "timeframe": "1m",
          "release_datetime": "2026-10-03T12:30:00.000Z",
          "prices": []
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(ChartResponse.self, from: json)

        XCTAssertTrue(response.prices.isEmpty)
    }

    // MARK: - Historical Comparison (src/routes/historical.ts §21.1)

    func testComparisonResponseDecodesNormalStatsWithAdvancedStatisticsAvailable() throws {
        let json = """
        {
          "indicator": { "id": "10000000-0000-0000-0000-000000000001", "code": "US_CPI", "name": "US Consumer Price Index (YoY)" },
          "fx_pair_id": "20000000-0000-0000-0000-000000000001",
          "timeframe": "5m",
          "total_events": 20,
          "analyzable_events": 18,
          "stats": {
            "average_movement": 0.21, "average_pips": 21.0, "max_movement": 0.55, "min_movement": -0.30,
            "upward_count": 12, "downward_count": 6, "no_change_count": 0
          },
          "advanced_statistics": { "available": true, "required_entitlement": null, "data": { "average_absolute_movement": 0.28, "average_absolute_pips": 28.0 } },
          "events": [
            { "event_id": "30000000-0000-0000-0000-000000000001", "release_datetime": "2026-09-10T12:30:00.000Z", "forecast": 3.1, "actual": 3.3, "previous": 3.0, "surprise": 0.2, "surprise_direction": "POSITIVE" }
          ],
          "meta": { "page": 1, "limit": 20, "total": 20, "has_next": false }
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(ComparisonResponse.self, from: json)

        XCTAssertEqual(response.totalEvents, 20)
        XCTAssertEqual(response.analyzableEvents, 18)
        XCTAssertEqual(response.stats.upwardCount, 12)
        XCTAssertTrue(response.advancedStatistics.available)
        XCTAssertEqual(response.advancedStatistics.data?.averageAbsolutePips, 28.0)
        XCTAssertEqual(response.events.first?.id, "30000000-0000-0000-0000-000000000001")
    }

    func testComparisonResponseDecodesAdvancedStatisticsGatedForFreeUsers() throws {
        let json = """
        {
          "indicator": { "id": "10000000-0000-0000-0000-000000000001", "code": "US_CPI", "name": "US Consumer Price Index (YoY)" },
          "fx_pair_id": "20000000-0000-0000-0000-000000000001",
          "timeframe": "5m",
          "total_events": 5,
          "analyzable_events": 5,
          "stats": {
            "average_movement": 0.1, "average_pips": 10.0, "max_movement": 0.2, "min_movement": -0.1,
            "upward_count": 3, "downward_count": 2, "no_change_count": 0
          },
          "advanced_statistics": { "available": false, "required_entitlement": "VIEW_ADVANCED_STATS", "data": null },
          "events": [],
          "meta": { "page": 1, "limit": 20, "total": 5, "has_next": false }
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(ComparisonResponse.self, from: json)

        XCTAssertFalse(response.advancedStatistics.available)
        XCTAssertEqual(response.advancedStatistics.requiredEntitlement, "VIEW_ADVANCED_STATS")
        XCTAssertNil(response.advancedStatistics.data)
    }

    func testComparisonResponseDecodesEmptyEventsAsAGenuineNoHistoryState() throws {
        let json = """
        {
          "indicator": { "id": "10000000-0000-0000-0000-000000000005", "code": "BOJ_RATE", "name": "BOJ Policy Rate Decision" },
          "fx_pair_id": "20000000-0000-0000-0000-000000000001",
          "timeframe": "5m",
          "total_events": 0,
          "analyzable_events": 0,
          "stats": { "average_movement": null, "average_pips": null, "max_movement": null, "min_movement": null, "upward_count": 0, "downward_count": 0, "no_change_count": 0 },
          "advanced_statistics": { "available": false, "required_entitlement": "VIEW_ADVANCED_STATS", "data": null },
          "events": [],
          "meta": { "page": 1, "limit": 20, "total": 0, "has_next": false }
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(ComparisonResponse.self, from: json)

        XCTAssertEqual(response.totalEvents, 0)
        XCTAssertTrue(response.events.isEmpty)
        XCTAssertNil(response.stats.averageMovement)
    }

    /// api-design.md §7.2: incomplete data (fewer analyzable than total) is
    /// never silently rounded away — both counts must survive decoding.
    func testComparisonResponseDecodesIncompleteDataDistinctFromTotal() throws {
        let json = """
        {
          "indicator": { "id": "10000000-0000-0000-0000-000000000001", "code": "US_CPI", "name": "US CPI" },
          "fx_pair_id": "20000000-0000-0000-0000-000000000001",
          "timeframe": "1m",
          "total_events": 20,
          "analyzable_events": 12,
          "stats": { "average_movement": 0.15, "average_pips": 15.0, "max_movement": 0.4, "min_movement": -0.2, "upward_count": 8, "downward_count": 4, "no_change_count": 0 },
          "advanced_statistics": { "available": true, "required_entitlement": null, "data": { "average_absolute_movement": 0.2, "average_absolute_pips": 20.0 } },
          "events": [],
          "meta": { "page": 1, "limit": 20, "total": 20, "has_next": false }
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(ComparisonResponse.self, from: json)

        XCTAssertEqual(response.totalEvents, 20)
        XCTAssertEqual(response.analyzableEvents, 12)
        XCTAssertNotEqual(response.totalEvents, response.analyzableEvents)
    }
}
