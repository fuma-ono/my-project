import XCTest
@testable import FXEventAnalyzer

/// テクニカル分析チャート(フラグの既定・リセット、応答のデコード、エラーの対応、指標の並び、時間足)。
/// 1.0ではフラグがどちらもfalseなので、画面にも入口にも何も出ない(`technicalAnalysisVisible`が両方trueのときだけtrue)。
@MainActor
final class TechnicalChartTests: XCTestCase {
    private func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(BackendDate.decode)
        return decoder
    }

    private let sampleJSON = """
    {
      "data": {
        "fx_pair_id": "fx_1",
        "symbol": "USDJPY",
        "timeframe": "60m",
        "unknown_top_level": 1,
        "candles": [
          { "t": "2026-11-20T00:00:00.000Z", "o": 150.1, "h": 150.5, "l": 149.9, "c": 150.3, "v": 10 },
          { "t": "2026-11-20T01:00:00Z", "o": 150.3, "h": 150.8, "l": 150.2, "c": 150.7 },
          { "t": "2026-11-20T02:00:00Z", "o": 150.7, "h": 150.9, "l": 150.4, "c": 150.5 }
        ],
        "indicators": {
          "sma20": [null, null, 150.5],
          "ema50": [null, 150.2, 150.3],
          "rsi14": [null, null, 55.5],
          "macd": { "macd": [null, 0.1, 0.2], "signal": [null, null, 0.15], "histogram": [null, null, 0.05] },
          "bollinger": { "middle": [null, null, 150.5], "upper": [null, null, 151.0], "lower": [null, null, 150.0] },
          "stoch": { "k": [null, null, 60.0], "d": [null, null, 58.0] },
          "future_indicator": [1, 2, 3]
        },
        "key_zones": [
          { "kind": "support", "lower": 149.8, "upper": 150.0, "center": 149.9, "touches": 4, "high_touches": 0, "low_touches": 4, "first_t": "2026-11-18T00:00:00Z", "last_t": "2026-11-20T00:00:00Z" },
          { "kind": "new_kind", "lower": 151.0, "upper": 151.2 }
        ],
        "meta": {
          "timeframe": "60m", "convention": "NY17", "bar_count": 3, "requested_limit": 120, "applied_limit": 120,
          "source_row_cap_hit": false, "source_bar_count": 180, "expected_source_bars": 180,
          "has_gaps": true, "partial_last": true, "data_source": "Twelve Data",
          "rights_ledger": { "entry_id": "e1", "status": "confirmed", "features": ["display"], "evidence_urls": ["https://example.com"] },
          "future_meta": "x"
        }
      }
    }
    """

    private func decodeSample() throws -> TechnicalResponse {
        let data: Data = sampleJSON.data(using: .utf8)!
        return try makeDecoder().decode(TechnicalResponse.self, from: data)
    }

    // MARK: - フラグ

    func testFlagDefaultsToFalse() {
        let store = PlanStore()
        XCTAssertFalse(store.technicalAnalysisEnabled)
        XCTAssertFalse(store.technicalAnalysisVisible)
    }

    func testEntitlementsDecodeTechnicalFlag() throws {
        let absent: Data = #"{"features":[],"plan":"FREE"}"#.data(using: .utf8)!
        let withTrue: Data = #"{"features":[],"plan":"FREE","technical_analysis_enabled":true}"#.data(using: .utf8)!
        let first = try makeDecoder().decode(EntitlementsResponse.self, from: absent)
        let second = try makeDecoder().decode(EntitlementsResponse.self, from: withTrue)
        XCTAssertNil(first.technicalAnalysisEnabled)
        XCTAssertEqual(second.technicalAnalysisEnabled, true)
    }

    func testVisibleOnlyWhenBothFlagsAreTrue() {
        let store = PlanStore()
        store.set(plan: .free, limits: .free(), confirmed: true, priceFeaturesEnabled: false, purchasesEnabled: false, technicalAnalysisEnabled: false)
        XCTAssertFalse(store.technicalAnalysisVisible)
        store.set(plan: .free, limits: .free(), confirmed: true, priceFeaturesEnabled: true, technicalAnalysisEnabled: false)
        XCTAssertFalse(store.technicalAnalysisVisible)
        store.set(plan: .free, limits: .free(), confirmed: true, priceFeaturesEnabled: false, technicalAnalysisEnabled: true)
        XCTAssertFalse(store.technicalAnalysisVisible, "価格由来の表示が閉じていればテクニカル分析も出さない")
        store.set(plan: .free, limits: .free(), confirmed: true, priceFeaturesEnabled: true, technicalAnalysisEnabled: true)
        XCTAssertTrue(store.technicalAnalysisVisible)
    }

    func testLoadReflectsAndFailedLoadResetsFlag() async {
        let api = MockAPIClient()
        api.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil, priceFeaturesEnabled: true, purchasesEnabled: false, technicalAnalysisEnabled: true))
        let store = PlanStore()
        await store.load(apiClient: api)
        XCTAssertTrue(store.technicalAnalysisEnabled)
        XCTAssertTrue(store.technicalAnalysisVisible)

        api.results["entitlements"] = .failure(APIError.transport("offline"))
        await store.load(apiClient: api)
        XCTAssertFalse(store.technicalAnalysisEnabled, "取得に失敗したら隠す側に戻す")
        XCTAssertFalse(store.technicalAnalysisVisible)
    }

    func testLoadWithoutKeyKeepsFlagFalse() async {
        let api = MockAPIClient()
        api.results["entitlements"] = .success(EntitlementsResponse(features: [], plan: .free, limits: nil, priceFeaturesEnabled: true))
        let store = PlanStore()
        await store.load(apiClient: api)
        XCTAssertFalse(store.technicalAnalysisEnabled)
    }

    func testResetClearsFlag() {
        let store = PlanStore()
        store.set(plan: .free, limits: .free(), confirmed: true, priceFeaturesEnabled: true, technicalAnalysisEnabled: true)
        store.reset()
        XCTAssertFalse(store.technicalAnalysisEnabled)
        XCTAssertFalse(store.technicalAnalysisVisible)
    }

    func testRouteIsHashableAndDistinct() {
        let first = AppRoute.technicalChart(fxPairId: "a", symbol: "USDJPY")
        let same = AppRoute.technicalChart(fxPairId: "a", symbol: "USDJPY")
        let other = AppRoute.technicalChart(fxPairId: "b", symbol: "EURUSD")
        XCTAssertEqual(first, same)
        XCTAssertNotEqual(first, other)
        XCTAssertEqual(Set([first, same, other]).count, 2)
    }

    // MARK: - デコード

    func testDecodesCandlesIndicatorsZonesAndMeta() throws {
        let response = try decodeSample()
        let data = response.data
        XCTAssertEqual(data.symbol, "USDJPY")
        XCTAssertEqual(data.candles.count, 3)
        XCTAssertEqual(data.candles[0].open, 150.1, accuracy: 0.0001)
        XCTAssertEqual(data.candles[1].close, 150.7, accuracy: 0.0001)
        XCTAssertLessThan(data.candles[0].time, data.candles[1].time)

        let indicators = data.indicators
        XCTAssertEqual(indicators?.sma20?.count, 3)
        XCTAssertNil(indicators?.sma20?[0] ?? nil)
        XCTAssertEqual(indicators?.sma20?[2] ?? nil, 150.5)
        XCTAssertEqual(indicators?.macd?.histogram?[2] ?? nil, 0.05)
        XCTAssertEqual(indicators?.bollinger?.upper?[2] ?? nil, 151.0)
        XCTAssertEqual(indicators?.stoch?.k?[2] ?? nil, 60.0)
        XCTAssertNil(indicators?.atr14, "要求しなかった指標はnil")

        XCTAssertEqual(data.keyZones?.count, 2)
        XCTAssertEqual(data.keyZones?[0].kind, "support")
        XCTAssertEqual(data.keyZones?[0].lowTouches, 4)
        XCTAssertNotNil(data.keyZones?[0].firstT)
        XCTAssertEqual(data.keyZones?[1].kind, "new_kind")
        XCTAssertNil(data.keyZones?[1].center)

        XCTAssertEqual(data.meta?.dataSource, "Twelve Data")
        XCTAssertEqual(data.meta?.hasGaps, true)
        XCTAssertEqual(data.meta?.partialLast, true)
        XCTAssertEqual(data.meta?.rightsLedger?.status, "confirmed")
    }

    func testDecodesMinimalResponse() throws {
        let json: Data = #"{"data":{"candles":[]}}"#.data(using: .utf8)!
        let response = try makeDecoder().decode(TechnicalResponse.self, from: json)
        XCTAssertTrue(response.data.candles.isEmpty)
        XCTAssertNil(response.data.indicators)
        XCTAssertNil(response.data.meta)
    }

    // MARK: - 指標の並び

    func testPointsSkipNullsAndKeepCandleIndex() throws {
        let response = try decodeSample()
        let points = TechnicalSeries.points(response.data.indicators?.ema50, candleCount: response.data.candles.count)
        XCTAssertEqual(points.map { $0.index }, [1, 2])
        XCTAssertEqual(points.map { $0.value }, [150.2, 150.3])
    }

    func testPointsTruncateToCandleCountAndHandleNil() {
        let values: [Double?] = [1, nil, 3, 4, 5]
        let points = TechnicalSeries.points(values, candleCount: 3)
        XCTAssertEqual(points.map { $0.index }, [0, 2])
        XCTAssertTrue(TechnicalSeries.points(nil, candleCount: 3).isEmpty)
    }

    func testPointsDropNonFiniteValues() {
        let values: [Double?] = [1, Double.nan, Double.infinity, 4]
        let points = TechnicalSeries.points(values, candleCount: 4)
        XCTAssertEqual(points.map { $0.index }, [0, 3])
    }

    func testAlignedPadsAndTruncates() {
        let short: [Double?] = [1, 2]
        let long: [Double?] = [1, 2, 3, 4]
        let paddedValues = TechnicalSeries.aligned(short, candleCount: 4)
        let cutValues = TechnicalSeries.aligned(long, candleCount: 3)
        XCTAssertEqual(paddedValues.count, 4)
        XCTAssertNil(paddedValues[3] ?? nil)
        XCTAssertEqual(cutValues.count, 3)
        XCTAssertEqual(TechnicalSeries.aligned(nil, candleCount: 2).count, 2)
        XCTAssertEqual(TechnicalSeries.aligned(long, candleCount: -1).count, 0)
    }

    func testPriceRangeIncludesOverlays() throws {
        let response = try decodeSample()
        let candles = response.data.candles
        let plain = TechnicalSeries.priceRange(candles: candles, extra: [])
        XCTAssertEqual(plain?.low ?? 0, 149.9, accuracy: 0.0001)
        XCTAssertEqual(plain?.high ?? 0, 150.9, accuracy: 0.0001)
        let band: [TechnicalPoint] = [TechnicalPoint(index: 2, value: 151.0), TechnicalPoint(index: 2, value: 149.5)]
        let widened = TechnicalSeries.priceRange(candles: candles, extra: [band])
        XCTAssertEqual(widened?.low ?? 0, 149.5, accuracy: 0.0001)
        XCTAssertEqual(widened?.high ?? 0, 151.0, accuracy: 0.0001)
        XCTAssertNil(TechnicalSeries.priceRange(candles: [], extra: []))
    }

    func testClampedZonesDropOutsideAndClip() throws {
        let response = try decodeSample()
        let zones = TechnicalSeries.clampedZones(response.data.keyZones, low: 149.9, high: 150.9)
        XCTAssertEqual(zones.count, 1, "範囲外の帯(151.0〜151.2)は描かない")
        XCTAssertEqual(zones[0].lower, 149.9, accuracy: 0.0001, "範囲に切り詰める")
        XCTAssertEqual(zones[0].upper, 150.0, accuracy: 0.0001)
        XCTAssertTrue(TechnicalSeries.clampedZones(nil, low: 0, high: 1).isEmpty)
    }

    func testValueRange() {
        XCTAssertNil(TechnicalSeries.valueRange([]))
        let series: [[TechnicalPoint]] = [[TechnicalPoint(index: 0, value: -1), TechnicalPoint(index: 1, value: 1)]]
        let range = TechnicalSeries.valueRange(series)
        XCTAssertEqual(range?.low ?? 0, -1.2, accuracy: 0.0001)
        XCTAssertEqual(range?.high ?? 0, 1.2, accuracy: 0.0001)
    }

    // MARK: - 時間足・文言

    func testTimeframeMapping() {
        let raws: [String] = TechnicalTimeframe.allCases.map { $0.rawValue }
        XCTAssertEqual(raws, ["5m", "15m", "30m", "60m", "4h", "1d"])
        XCTAssertEqual(TechnicalTimeframe.h1.label, "1時間")
        XCTAssertEqual(TechnicalTimeframe.initial, .h1)
        XCTAssertTrue(TechnicalTimeframe.d1.isDaily)
        XCTAssertFalse(TechnicalTimeframe.h4.isDaily)
        XCTAssertNil(TechnicalTimeframe(rawValue: "1h"))
    }

    func testDisclaimerAndNotes() throws {
        XCTAssertEqual(
            TechnicalText.disclaimer,
            "テクニカル指標は過去の価格から計算した参考情報で、将来の値動きを保証するものではありません。投資の判断はご自身で行ってください。"
        )
        let response = try decodeSample()
        XCTAssertEqual(TechnicalText.attribution(response.data.meta), "価格データの提供元: Twelve Data")
        XCTAssertEqual(TechnicalText.notes(response.data.meta).count, 2)
        XCTAssertNil(TechnicalText.attribution(nil))
        XCTAssertTrue(TechnicalText.notes(nil).isEmpty)
    }

    // MARK: - 取得とエラーの対応

    func testEndpointQuery() {
        let endpoint = TechnicalChartViewModel.endpoint(fxPairId: "fx_1", timeframe: .h4)
        XCTAssertEqual(endpoint.path, "fx-pairs/fx_1/technical")
        XCTAssertEqual(endpoint.method, .get)
        var query: [String: String] = [:]
        for item in endpoint.queryItems {
            query[item.name] = item.value ?? ""
        }
        XCTAssertEqual(query["timeframe"], "4h")
        XCTAssertEqual(query["limit"], "120")
        XCTAssertEqual(query["indicators"], "sma20,ema50,rsi14,macd,bollinger,stoch")
    }

    func testErrorMapping() {
        func mapped(_ code: APIErrorCode, _ status: Int) -> TechnicalChartState {
            let error = APIError.server(code: code, message: "x", httpStatus: status)
            return TechnicalChartViewModel.state(forError: error)
        }
        XCTAssertEqual(mapped(.dataRightsUnconfirmed, 403), .rightsUnconfirmed)
        XCTAssertEqual(mapped(.notFound, 404), .unavailable)
        XCTAssertEqual(mapped(.fxPairNotFound, 404), .notFound)
        if case .error = mapped(.validationError, 422) {
        } else {
            XCTFail("422は一般のエラー")
        }
        XCTAssertEqual(TechnicalChartViewModel.state(forError: APIError.notConfigured), .backendNotConfigured)
        if case .error = TechnicalChartViewModel.state(forError: APIError.transport("offline")) {
        } else {
            XCTFail("通信失敗は一般のエラー")
        }
        XCTAssertEqual(APIErrorCode(rawValue: "DATA_RIGHTS_UNCONFIRMED"), .dataRightsUnconfirmed)
    }

    func testFetchLoadsAndMapsErrors() async throws {
        let api = MockAPIClient()
        let response = try decodeSample()
        api.results["fx-pairs/fx_1/technical"] = .success(response)
        let viewModel = TechnicalChartViewModel(apiClient: api, fxPairId: "fx_1", symbol: "USDJPY")
        await viewModel.fetch()
        if case .loaded(let data) = viewModel.state {
            XCTAssertEqual(data.candles.count, 3)
        } else {
            XCTFail("loadedになるはず")
        }
        XCTAssertEqual(viewModel.scrollX, 0, "足が表示本数より少なければ先頭から")

        api.results["fx-pairs/fx_1/technical"] = .failure(APIError.server(code: .dataRightsUnconfirmed, message: "x", httpStatus: 403))
        await viewModel.fetch()
        XCTAssertEqual(viewModel.state, .rightsUnconfirmed)
    }

    func testFetchWithNoCandlesIsEmpty() async throws {
        let api = MockAPIClient()
        let json: Data = #"{"data":{"candles":[]}}"#.data(using: .utf8)!
        let response = try makeDecoder().decode(TechnicalResponse.self, from: json)
        api.results["fx-pairs/fx_1/technical"] = .success(response)
        let viewModel = TechnicalChartViewModel(apiClient: api, fxPairId: "fx_1", symbol: "USDJPY")
        await viewModel.fetch()
        XCTAssertEqual(viewModel.state, .empty)
    }
}
