import XCTest
@testable import FXEventAnalyzer

/// api-design v1.46(HQ指示 2026-11-02「表示桁数」): 指標の値は`value_decimals`の桁に丸めて(0から遠い側へ)
/// 末尾の0も出す。-0.0は0.0。前回比・予想との差は、表示の桁に丸めた値どうしで計算する。`value_decimals`が
/// 無い(古いBackend)・null(BLS以外の指標)なら今までの表示のまま。保存値は丸めない(表示だけ)。
@MainActor
final class ValueDecimalsTests: XCTestCase {
    private func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    // MARK: - 丸めと表示

    func testRoundsHalfAwayFromZeroAndDropsTheSignOfZero() {
        XCTAssertEqual(ValueFormat.displayRounded(3.7377, decimals: 1), 3.7)
        XCTAssertEqual(ValueFormat.displayRounded(0.25, decimals: 1), 0.3)
        XCTAssertEqual(ValueFormat.displayRounded(-0.25, decimals: 1), -0.3)
        XCTAssertEqual(ValueFormat.displayRounded(0.15, decimals: 1), 0.2) // 2進数の誤差で0.1にしない
        XCTAssertEqual(ValueFormat.displayRounded(-0.0167, decimals: 1).sign, .plus) // -0.0 → 0.0
    }

    func testFormatsWithTheGivenDecimalsKeepingTrailingZeros() {
        XCTAssertEqual(ValueFormat.withUnit(3.7377, unit: "%", decimals: 1), "3.7%")
        XCTAssertEqual(ValueFormat.withUnit(3.0245, unit: "%", decimals: 1), "3.0%")
        XCTAssertEqual(ValueFormat.withUnit(-0.0167, unit: "%", decimals: 1), "0.0%")
        XCTAssertEqual(ValueFormat.withUnit(-0.4225, unit: "%", decimals: 1), "-0.4%")
    }

    func testNilDecimalsKeepsTheCurrentDisplay() {
        XCTAssertEqual(ValueFormat.withUnit(3.7377, unit: "%"), "3.74%")
        XCTAssertEqual(ValueFormat.withUnit(3.7377, unit: "%", decimals: nil), "3.74%")
        XCTAssertEqual(ValueFormat.indicatorNumber(3.0, decimals: nil), "3")
    }

    func testThousandsKeepTheTenThousandsDisplay() {
        XCTAssertEqual(ValueFormat.withUnit(254, unit: "千人", decimals: 1), "25.4万人")
        XCTAssertEqual(ValueFormat.withUnit(254, unit: "K", decimals: nil), "25.4万人")
    }

    func testHistoricalComparisonValueText() {
        XCTAssertEqual(HistoricalComparisonView.valueText(3.0245, unit: "%", decimals: 1), "3.0%")
        XCTAssertEqual(HistoricalComparisonView.valueText(-0.0167, unit: "%", decimals: 1), "0.0%")
        XCTAssertEqual(HistoricalComparisonView.valueText(3.7377, unit: "%"), "3.74%") // 今までどおり
        XCTAssertEqual(HistoricalComparisonView.valueText(nil, unit: "%", decimals: 1), "--")
    }

    // MARK: - 前回比・予想との差

    func testChangeFromPreviousUsesTheDisplayedValues() {
        // 表示は3.7と3.4 → +0.3(丸める前の差0.38から+0.4にしない)
        XCTAssertEqual(EventDetailCards.changeFromPrevious(actual: 3.74, previous: 3.36, unit: "%", decimals: 1), "(前回比 +0.3ポイント)")
        // 表示はどちらも3.0 → ±0.0
        XCTAssertEqual(EventDetailCards.changeFromPrevious(actual: 3.04, previous: 2.96, unit: "%", decimals: 1), "(前回比 ±0.0ポイント)")
        XCTAssertEqual(EventDetailCards.changeFromPrevious(actual: 3.1, previous: 3.3, unit: "%", decimals: 1), "(前回比 -0.2ポイント)")
        // decimals が無ければ今までどおり(丸める前の差)
        XCTAssertEqual(EventDetailCards.changeFromPrevious(actual: 3.74, previous: 3.36, unit: "%"), "(前回比 +0.38ポイント)")
    }

    func testDifferenceFromForecastUsesTheDisplayedValues() {
        let reactions = [entry("1m", -8.2), entry("15m", -41.3)]
        let above = MovementAnalysisText.summary(reactions: reactions, actual: 3.74, forecast: 3.36, unit: "%", valueDecimals: 1)
        XCTAssertEqual(above?.facts.first?.value, "予想を0.3ポイント上回る")
        let same = MovementAnalysisText.summary(reactions: reactions, actual: 3.04, forecast: 2.96, unit: "%", valueDecimals: 1)
        XCTAssertEqual(same?.facts.first?.value, "予想どおり")
        let sentence = MovementAnalysisText.build(reactions: reactions, actual: 3.74, forecast: 3.36, unit: "%", valueDecimals: 1)
        XCTAssertEqual(sentence?.hasPrefix("結果は予想を0.3%上回った。"), true)
    }

    // MARK: - 応答の読み込み(古いBackendとの互換)

    func testModelsDecodeValueDecimalsAndToleratesOldBackends() throws {
        let home = #"{"event_id":"e1","indicator_id":"i1","indicator_name":"CPI","country_code":"US","currency_code":"USD","importance":"HIGH","release_datetime":"2026-10-14T12:30:00Z","release_datetime_precision":"EXACT","status":"RELEASED","data_status":"READY","forecast":null,"actual":3.7377,"previous":3.3965,"surprise":null,"surprise_direction":null,"related_fx_pairs":[]"#
        XCTAssertEqual(try decoder().decode(HomeEventSummary.self, from: Data((home + #","value_decimals":1}"#).utf8)).valueDecimals, 1)
        XCTAssertNil(try decoder().decode(HomeEventSummary.self, from: Data((home + #","value_decimals":null}"#).utf8)).valueDecimals)
        XCTAssertNil(try decoder().decode(HomeEventSummary.self, from: Data((home + "}").utf8)).valueDecimals) // 古いBackend

        let event = #"{"id":"e1","indicator_id":"i1","indicator_name":"CPI","country_code":"US","currency_code":"USD","release_datetime":"2026-10-14T12:30:00Z","release_datetime_precision":"EXACT","importance":"HIGH","status":"RELEASED","data_status":"READY","revision_status":null"#
        XCTAssertEqual(try decoder().decode(EventDetailEvent.self, from: Data((event + #","value_decimals":1}"#).utf8)).valueDecimals, 1)
        XCTAssertNil(try decoder().decode(EventDetailEvent.self, from: Data((event + "}").utf8)).valueDecimals)

        let row = #"{"event_id":"e1","release_datetime":"2026-10-14T12:30:00Z","status":"RELEASED","data_status":"READY","forecast":null,"actual":3.7377,"previous":null,"surprise":null,"surprise_direction":null"#
        XCTAssertEqual(try decoder().decode(IndicatorEventSummary.self, from: Data((row + #","value_decimals":1}"#).utf8)).valueDecimals, 1)
        XCTAssertNil(try decoder().decode(IndicatorEventSummary.self, from: Data((row + "}").utf8)).valueDecimals)

        let indicator = #"{"id":"i1","code":"US_CPI","name":"CPI","unit":"%""#
        XCTAssertEqual(try decoder().decode(ComparisonIndicatorSummary.self, from: Data((indicator + #","value_decimals":1}"#).utf8)).valueDecimals, 1)
        XCTAssertNil(try decoder().decode(ComparisonIndicatorSummary.self, from: Data((indicator + "}").utf8)).valueDecimals)
    }

    private func entry(_ timeframe: String, _ pips: Double) -> ReactionTimeframeEntry {
        let json = #"{"timeframe":"\#(timeframe)","post_release_price":null,"movement":null,"pips":\#(pips),"change_percent":null,"max_upward":null,"max_downward":null,"max_upward_pips":null,"max_downward_pips":null,"analysis_status":"READY"}"#
        return try! JSONDecoder().decode(ReactionTimeframeEntry.self, from: Data(json.utf8))
    }
}
