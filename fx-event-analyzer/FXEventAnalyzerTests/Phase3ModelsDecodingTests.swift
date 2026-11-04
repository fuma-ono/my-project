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
              "data_status": "READY",
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
              "data_status": "DATA_PENDING",
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
        // 古いBackend・Eurostat以外の指標には`attribution`自体が無い(api-design v1.43)。
        XCTAssertNil(response.attribution)
    }

    /// HQ指示(2026-10-31)「出典表示」: Eurostatの指標(EU_HICP・
    /// EU_UNEMPLOYMENT_RATE)は`indicator`とは別の階層(応答の直下)に
    /// `attribution`が付く(src/routes/indicators.ts)。
    func testIndicatorDetailResponseDecodesEurostatAttribution() throws {
        let json = """
        {
          "indicator": {
            "id": "10000000-0000-0000-0000-000000000009",
            "code": "EU_HICP",
            "name": "Eurozone HICP (YoY)",
            "country_code": "EU",
            "currency_code": "EUR",
            "importance": "HIGH",
            "description": null,
            "frequency": "MONTHLY",
            "unit": "%",
            "source": null,
            "source_url": null,
            "favorable_direction": "NEUTRAL"
          },
          "attribution": {
            "source": "Eurostat（欧州連合統計局）",
            "source_url": "https://ec.europa.eu/eurostat",
            "notice": "Eurostat の公表データをもとに作成しています。Eurostat は本アプリでの利用について責任を負いません。"
          },
          "favorable_direction": "NEUTRAL",
          "related_fx_pairs": [],
          "latest_event": null
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(IndicatorDetailResponse.self, from: json)

        XCTAssertEqual(response.attribution?.source, "Eurostat（欧州連合統計局）")
        XCTAssertEqual(response.attribution?.sourceUrl, "https://ec.europa.eu/eurostat")
        XCTAssertEqual(response.attribution?.notice, "Eurostat の公表データをもとに作成しています。Eurostat は本アプリでの利用について責任を負いません。")
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
            "data_status": "READY",
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
            "data_status": "DATA_PENDING",
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
        // 古いBackend・Eurostat以外の指標の発表には`event.attribution`自体が無い(api-design v1.43)。
        XCTAssertNil(response.event.attribution)
    }

    /// HQ指示(2026-10-31)「出典表示」: Eurostatの指標(EU_HICP・
    /// EU_UNEMPLOYMENT_RATE)の発表は`event`の中に`attribution`が付く
    /// (src/routes/events.ts、ロックされていても隠さない)。
    func testEventDetailResponseDecodesEurostatAttribution() throws {
        let json = """
        {
          "event": {
            "id": "30000000-0000-0000-0000-000000000009",
            "indicator_id": "10000000-0000-0000-0000-000000000009",
            "indicator_name": "Eurozone HICP (YoY)",
            "country_code": "EU",
            "currency_code": "EUR",
            "release_datetime": "2026-11-05T10:00:00.000Z",
            "release_datetime_precision": "APPROXIMATE",
            "importance": "HIGH",
            "status": "SCHEDULED",
            "data_status": "DATA_PENDING",
            "revision_status": "NONE",
            "attribution": {
              "source": "Eurostat（欧州連合統計局）",
              "source_url": "https://ec.europa.eu/eurostat",
              "notice": "Eurostat の公表データをもとに作成しています。Eurostat は本アプリでの利用について責任を負いません。"
            }
          },
          "snapshot": null,
          "analysis": { "surprise": null, "surprise_direction": null },
          "explanation": null,
          "related_fx_pairs": [],
          "available_timeframes": ["1m", "5m", "15m", "30m", "60m"]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(EventDetailResponse.self, from: json)

        XCTAssertEqual(response.event.attribution?.source, "Eurostat（欧州連合統計局）")
        XCTAssertEqual(response.event.attribution?.sourceUrl, "https://ec.europa.eu/eurostat")
        XCTAssertEqual(response.event.attribution?.notice, "Eurostat の公表データをもとに作成しています。Eurostat は本アプリでの利用について責任を負いません。")
    }

    // Historical Event Detail (`HistoricalEventDetailResponse`等)のデコードテストは、
    // HQ指示(2026-10-03、画面構成全面更新)でこの画面自体
    // (`HistoricalEventDetailView`/旧SCR-010)が独立画面として削除されたため、
    // テスト対象の型ごと削除した。過去の発表回の値動き詳細はSCR-008
    // 相場反応詳細(`MovementDetailResponse`、別のテストで既にカバー済み)に
    // 集約されている。

    // HQ指示(2026-11-04)「経済指標の対応状況確定・未対応解消」: US_PPI・
    // US_CORE_PPI・US_JOLTS・EU_UNEMPLOYMENT_RATEはbackend側のingestion・DB保存は
    // 実装済み(indicators.ts・各種migration)だが、このファイルにはこれらの
    // indicator codeでのデコードテストが一つも無かった(調査で判明)。
    // secondary_*(前月比・前年比、snapshot/EventSnapshotDetail)のデコード自体も
    // どのテストからも一度も通っていなかった。実際のBackend応答形に沿った
    // リテラルJSONで、デコード・ラベル対応付けの双方を確認する。
    func testEventDetailResponseDecodesPpiSnapshotWithYoySecondary() throws {
        let json = """
        {
          "event": {
            "id": "30000000-0000-0000-0000-000000000010",
            "indicator_id": "10000000-0000-0000-0000-000000000010",
            "indicator_name": "US Producer Price Index (MoM)",
            "country_code": "US",
            "currency_code": "USD",
            "release_datetime": "2026-10-14T12:30:00.000Z",
            "release_datetime_precision": "EXACT",
            "importance": "MEDIUM",
            "status": "RELEASED",
            "data_status": "READY",
            "revision_status": "NONE"
          },
          "snapshot": {
            "forecast": 0.2, "actual": 0.3, "previous": 0.1,
            "unit": "%", "source": "U.S. Bureau of Labor Statistics", "source_url": null,
            "secondary_value_kind": "YOY_PCT",
            "secondary_forecast": null, "secondary_actual": 2.6, "secondary_previous": 2.4
          },
          "analysis": { "surprise": 0.1, "surprise_direction": "POSITIVE" },
          "explanation": null,
          "related_fx_pairs": [],
          "available_timeframes": ["1m", "5m", "15m", "30m", "60m"]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(EventDetailResponse.self, from: json)

        XCTAssertEqual(response.snapshot?.secondaryValueKind, "YOY_PCT")
        XCTAssertEqual(response.snapshot?.secondaryActual, 2.6)
        XCTAssertEqual(response.snapshot?.secondaryPrevious, 2.4)
        XCTAssertNil(response.snapshot?.secondaryForecast)
        // YOY_PCTが副指標なら、本来の値(MoM)が主ラベル・YoYが副ラベルになる。
        XCTAssertEqual(EventDetailCards.primaryLabel(forSecondary: response.snapshot?.secondaryValueKind), "前月比")
        XCTAssertEqual(EventDetailCards.secondaryLabel(response.snapshot?.secondaryValueKind), "前年比")
    }

    func testEventDetailResponseDecodesJoltsLevelSnapshotWithoutSecondary() throws {
        let json = """
        {
          "event": {
            "id": "30000000-0000-0000-0000-000000000011",
            "indicator_id": "10000000-0000-0000-0000-000000000011",
            "indicator_name": "US JOLTS Job Openings",
            "country_code": "US",
            "currency_code": "USD",
            "release_datetime": "2026-11-03T15:00:00.000Z",
            "release_datetime_precision": "EXACT",
            "importance": "MEDIUM",
            "status": "RELEASED",
            "data_status": "READY",
            "revision_status": "NONE"
          },
          "snapshot": {
            "forecast": 7200, "actual": 7400, "previous": 7100,
            "unit": "千人", "source": "U.S. Bureau of Labor Statistics", "source_url": null
          },
          "analysis": { "surprise": 200, "surprise_direction": "POSITIVE" },
          "explanation": null,
          "related_fx_pairs": [],
          "available_timeframes": ["1m", "5m", "15m", "30m", "60m"]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(EventDetailResponse.self, from: json)

        // US_JOLTSはindicators.tsにsecondaryが設定されていない(LEVEL値のみ)ので、
        // secondary_*キー自体が応答に無くても正常にnilへデコードされる必要がある。
        XCTAssertNil(response.snapshot?.secondaryValueKind)
        XCTAssertEqual(response.snapshot?.actual, 7400)
        XCTAssertEqual(response.snapshot?.unit, "千人")
    }

    /// HQ指示(2026-10-31)「出典表示」のattributionはEU_HICPのテストしか
    /// 無かった(調査で判明)。同じEurostat経路のEU_UNEMPLOYMENT_RATEでも
    /// 同様にevent.attributionが付くことを確認する。
    func testEventDetailResponseDecodesEuUnemploymentRateAttribution() throws {
        let json = """
        {
          "event": {
            "id": "30000000-0000-0000-0000-000000000012",
            "indicator_id": "10000000-0000-0000-0000-000000000012",
            "indicator_name": "Euro Area Unemployment Rate",
            "country_code": "EU",
            "currency_code": "EUR",
            "release_datetime": "2026-11-04T10:00:00.000Z",
            "release_datetime_precision": "APPROXIMATE",
            "importance": "MEDIUM",
            "status": "RELEASED",
            "data_status": "READY",
            "revision_status": "NONE",
            "attribution": {
              "source": "Eurostat（欧州連合統計局）",
              "source_url": "https://ec.europa.eu/eurostat",
              "notice": "Eurostat の公表データをもとに作成しています。Eurostat は本アプリでの利用について責任を負いません。"
            }
          },
          "snapshot": {
            "forecast": 6.3, "actual": 6.3, "previous": 6.4,
            "unit": "%", "source": "Eurostat", "source_url": null
          },
          "analysis": { "surprise": 0.0, "surprise_direction": "NEUTRAL" },
          "explanation": null,
          "related_fx_pairs": [],
          "available_timeframes": ["1m", "5m", "15m", "30m", "60m"]
        }
        """.data(using: .utf8)!

        let response = try makeDecoder().decode(EventDetailResponse.self, from: json)

        XCTAssertEqual(response.event.attribution?.source, "Eurostat（欧州連合統計局）")
        XCTAssertEqual(response.snapshot?.actual, 6.3)
    }
}
