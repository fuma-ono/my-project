import XCTest
@testable import FXEventAnalyzer

/// Decodes literal JSON matching the real Backend's Phase 3 response shapes
/// verbatim (fx-event-analyzer-backend/src/routes/{home,indicators,events,
/// historical}.ts), the same way AccountModelsTests.swift does for Phase 2 —
/// this is what actually catches a CodingKeys/date-format mismatch against
/// the real Backend, since MockAPIClient-based ViewModel tests never parse
/// real JSON.
final class Phase3ModelsDecodingTests: XCTestCase {
    private func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    // MARK: - Home (src/routes/home.ts)

    func testHomeResponseDecodesRealBackendShapeIncludingRelatedFxPairs() throws {
        let json = """
        {
          "date": "2026-09-10",
          "timezone": "UTC",
          "events": [
            {
              "event_id": "30000000-0000-0000-0000-000000000001",
              "indicator_id": "10000000-0000-0000-0000-000000000001",
              "indicator_name": "US Consumer Price Index (YoY)",
              "country_code": "US",
              "currency_code": "USD",
              "importance": "HIGH",
              "release_datetime": "2026-09-10T12:30:00.000Z",
              "release_datetime_precision": "EXACT",
              "status": "RELEASED",
              "data_status": "AVAILABLE",
              "forecast": 3.1,
              "actual": 3.3,
              "previous": 3.0,
              "surprise": 0.2,
              "surprise_direction": "POSITIVE",
              "related_fx_pairs": [
                { "fx_pair_id": "20000000-0000-0000-0000-000000000001", "symbol": "USDJPY", "priority": 1 }
              ]
            }
          ],
          "major_fx": [
            {
              "fx_pair_id": "20000000-0000-0000-0000-000000000001",
              "symbol": "USDJPY",
              "price": 147.48,
              "change": 0.28,
              "change_percent": 0.19,
              "timestamp": "2026-09-10T12:31:00.000Z"
            }
          ]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(HomeResponse.self, from: json)

        XCTAssertEqual(response.events.count, 1)
        let event = response.events[0]
        XCTAssertEqual(event.status, .released)
        XCTAssertEqual(event.importance, .high)
        XCTAssertEqual(event.relatedFxPairs.map(\.symbol), ["USDJPY"])
        XCTAssertEqual(response.majorFx.first?.symbol, "USDJPY")
    }

    func testHomeResponseDecodesAScheduledEventWithNoSnapshotValues() throws {
        let json = """
        {
          "date": "2026-10-03",
          "timezone": "UTC",
          "events": [
            {
              "event_id": "30000000-0000-0000-0000-000000000003",
              "indicator_id": "10000000-0000-0000-0000-000000000002",
              "indicator_name": "US Non-Farm Payrolls",
              "country_code": "US",
              "currency_code": "USD",
              "importance": "HIGH",
              "release_datetime": "2026-10-03T12:30:00.000Z",
              "release_datetime_precision": "EXACT",
              "status": "SCHEDULED",
              "data_status": "PENDING",
              "forecast": null,
              "actual": null,
              "previous": null,
              "surprise": null,
              "surprise_direction": null,
              "related_fx_pairs": []
            }
          ],
          "major_fx": []
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(HomeResponse.self, from: json)

        let event = response.events[0]
        XCTAssertEqual(event.status, .scheduled)
        XCTAssertEqual(event.dataStatus, .dataPending)
        XCTAssertNil(event.forecast)
        XCTAssertNil(event.surprise)
    }

    // MARK: - Indicators (src/routes/indicators.ts)

    func testIndicatorsListResponseDecodesRealBackendShape() throws {
        let json = """
        {
          "data": [
            {
              "id": "10000000-0000-0000-0000-000000000001",
              "code": "US_CPI",
              "name": "US Consumer Price Index (YoY)",
              "country_code": "US",
              "currency_code": "USD",
              "importance": "HIGH",
              "description": "US headline inflation rate, year-over-year.",
              "frequency": "MONTHLY",
              "unit": "%",
              "source": "U.S. Bureau of Labor Statistics",
              "source_url": null,
              "favorable_direction": "HIGHER_IS_POSITIVE"
            }
          ],
          "meta": { "page": 1, "limit": 20, "total": 1, "has_next": false }
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(IndicatorsListResponse.self, from: json)

        XCTAssertEqual(response.data.first?.code, "US_CPI")
        XCTAssertEqual(response.data.first?.favorableDirection, .higherIsPositive)
        XCTAssertEqual(response.meta, PaginationMeta(page: 1, limit: 20, total: 1, hasNext: false))
    }

    func testIndicatorDetailResponseDecodesRealBackendShape() throws {
        let json = """
        {
          "indicator": {
            "id": "10000000-0000-0000-0000-000000000001",
            "code": "US_CPI",
            "name": "US Consumer Price Index (YoY)",
            "country_code": "US",
            "currency_code": "USD",
            "importance": "HIGH",
            "description": "US headline inflation rate, year-over-year.",
            "frequency": "MONTHLY",
            "unit": "%",
            "source": "U.S. Bureau of Labor Statistics",
            "source_url": null,
            "favorable_direction": "HIGHER_IS_POSITIVE"
          },
          "favorable_direction": "HIGHER_IS_POSITIVE",
          "related_fx_pairs": [
            { "fx_pair_id": "20000000-0000-0000-0000-000000000001", "symbol": "USDJPY", "priority": 1 }
          ],
          "latest_event": { "id": "30000000-0000-0000-0000-000000000001", "release_datetime": "2026-09-10T12:30:00.000Z", "status": "RELEASED" }
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(IndicatorDetailResponse.self, from: json)

        XCTAssertEqual(response.indicator.code, "US_CPI")
        XCTAssertEqual(response.relatedFxPairs.map(\.symbol), ["USDJPY"])
    }

    func testIndicatorEventsListResponseDecodesRealBackendShape() throws {
        let json = """
        {
          "data": [
            {
              "event_id": "30000000-0000-0000-0000-000000000001",
              "indicator_id": "10000000-0000-0000-0000-000000000001",
              "release_datetime": "2026-09-10T12:30:00.000Z",
              "release_datetime_precision": "EXACT",
              "importance": "HIGH",
              "status": "RELEASED",
              "data_status": "AVAILABLE",
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

        XCTAssertEqual(response.data.first?.id, "30000000-0000-0000-0000-000000000001")
        XCTAssertEqual(response.data.first?.surpriseDirection, .positive)
    }

    // MARK: - Event Detail (src/routes/events.ts)

    func testEventDetailResponseDecodesARevisedReleasedEvent() throws {
        let json = """
        {
          "event": {
            "id": "30000000-0000-0000-0000-000000000001",
            "indicator_id": "10000000-0000-0000-0000-000000000001",
            "indicator_name": "US Consumer Price Index (YoY)",
            "country_code": "US",
            "currency_code": "USD",
            "release_datetime": "2026-09-10T12:30:00.000Z",
            "release_datetime_precision": "EXACT",
            "importance": "HIGH",
            "status": "RELEASED",
            "data_status": "AVAILABLE",
            "revision_status": "REVISED"
          },
          "snapshot": {
            "forecast": 3.1, "actual": 3.3, "previous": 3.0,
            "unit": "%", "source": "U.S. Bureau of Labor Statistics", "source_url": null
          },
          "analysis": { "surprise": 0.2, "surprise_direction": "POSITIVE" },
          "explanation": {
            "summary": "Headline CPI rose 3.3% YoY versus a forecast of 3.1%.",
            "source": "U.S. Bureau of Labor Statistics",
            "source_url": "https://www.bls.gov/cpi/"
          },
          "related_fx_pairs": [
            {
              "fx_pair_id": "20000000-0000-0000-0000-000000000001",
              "symbol": "USDJPY",
              "priority": 1,
              "reaction": { "timeframe": "5m", "pips": 56.0, "change_percent": 0.38, "analysis_status": "READY" }
            }
          ],
          "available_timeframes": ["1m", "5m", "15m", "30m", "60m"]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(EventDetailResponse.self, from: json)

        XCTAssertEqual(response.event.revisionStatus, .revised)
        XCTAssertEqual(response.analysis.surprise, 0.2)
        XCTAssertEqual(response.explanation?.source, "U.S. Bureau of Labor Statistics")
        XCTAssertEqual(response.relatedFxPairs.first?.reaction.analysisStatus, .ready)
        XCTAssertEqual(response.availableTimeframes, ["1m", "5m", "15m", "30m", "60m"])
    }

    func testEventDetailResponseDecodesANullSnapshotAndExplanationForAScheduledEvent() throws {
        let json = """
        {
          "event": {
            "id": "30000000-0000-0000-0000-000000000003",
            "indicator_id": "10000000-0000-0000-0000-000000000002",
            "indicator_name": "US Non-Farm Payrolls",
            "country_code": "US",
            "currency_code": "USD",
            "release_datetime": "2026-10-03T12:30:00.000Z",
            "release_datetime_precision": "EXACT",
            "importance": "HIGH",
            "status": "SCHEDULED",
            "data_status": "PENDING",
            "revision_status": "NONE"
          },
          "snapshot": null,
          "analysis": { "surprise": null, "surprise_direction": null },
          "explanation": null,
          "related_fx_pairs": [],
          "available_timeframes": ["1m", "5m", "15m", "30m", "60m"]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(EventDetailResponse.self, from: json)

        XCTAssertNil(response.snapshot)
        XCTAssertNil(response.explanation)
        XCTAssertNil(response.analysis.surprise)
        XCTAssertTrue(response.relatedFxPairs.isEmpty)
    }

    // MARK: - Historical Event Detail (src/routes/historical.ts)

    func testHistoricalEventDetailResponseDecodesRealBackendShape() throws {
        let json = """
        {
          "indicator_id": "10000000-0000-0000-0000-000000000001",
          "event": {
            "id": "30000000-0000-0000-0000-000000000001",
            "indicator_name": "US Consumer Price Index (YoY)",
            "release_datetime": "2026-09-10T12:30:00.000Z",
            "importance": "HIGH"
          },
          "snapshot": {
            "forecast": 3.1, "actual": 3.3, "previous": 3.0, "surprise": 0.2, "surprise_direction": "POSITIVE"
          },
          "explanation": {
            "summary": "Headline CPI rose 3.3% YoY versus a forecast of 3.1%.",
            "source": "U.S. Bureau of Labor Statistics",
            "source_url": "https://www.bls.gov/cpi/"
          },
          "related_fx_pairs": [
            {
              "fx_pair_id": "20000000-0000-0000-0000-000000000001",
              "symbol": "USDJPY",
              "reactions": [
                {
                  "timeframe": "1m",
                  "pre_release_price": 147.20,
                  "post_release_price": 147.48,
                  "movement": 0.28,
                  "pips": 28.0,
                  "change_percent": 0.19,
                  "max_upward": 0.30,
                  "max_downward": -0.05,
                  "max_upward_pips": 30.0,
                  "max_downward_pips": -5.0,
                  "analysis_status": "READY"
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(HistoricalEventDetailResponse.self, from: json)

        XCTAssertEqual(response.indicatorId, "10000000-0000-0000-0000-000000000001")
        XCTAssertEqual(response.snapshot?.surprise, 0.2)
        let reaction = response.relatedFxPairs.first?.reactions.first
        XCTAssertEqual(reaction?.analysisStatus, .ready)
        XCTAssertEqual(reaction?.pips, 28.0)
    }
}
