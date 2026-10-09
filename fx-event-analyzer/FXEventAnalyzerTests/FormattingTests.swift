import XCTest
@testable import FXEventAnalyzer

final class ValueFormatTests: XCTestCase {
    func testNumberFormatsNilAsPlaceholder() {
        XCTAssertEqual(ValueFormat.number(nil), "--")
    }

    func testNumberFormatsPositiveValueWithoutSignByDefault() {
        XCTAssertEqual(ValueFormat.number(3.2), "3.2")
    }

    func testNumberFormatsSignedPositiveValueWithPlusPrefix() {
        XCTAssertEqual(ValueFormat.number(0.2, signed: true), "+0.2")
    }

    func testNumberFormatsSignedNegativeValueWithMinus() {
        XCTAssertEqual(ValueFormat.number(-0.2, signed: true), "-0.2")
    }

    func testPercentFormatsNilAsPlaceholder() {
        XCTAssertEqual(ValueFormat.percent(nil), "--")
    }

    func testPercentAppendsPercentSign() {
        XCTAssertEqual(ValueFormat.percent(0.19, signed: true), "+0.19%")
    }

    func testPipsFormatsNilAsPlaceholder() {
        XCTAssertEqual(ValueFormat.pips(nil), "--")
    }

    func testPipsAppendsUnitSuffix() {
        XCTAssertEqual(ValueFormat.pips(28.0), "+28 pips")
    }

    func testCountdownReturnsNilForAPastDate() {
        let past = Date().addingTimeInterval(-60)
        XCTAssertNil(ValueFormat.countdown(to: past))
    }

    func testCountdownReturnsMinutesForANearFutureDate() {
        let now = Date()
        let future = now.addingTimeInterval(30 * 60)
        XCTAssertEqual(ValueFormat.countdown(to: future, from: now), "30分後")
    }

    func testCountdownReturnsHoursAndMinutesForALaterFutureDate() {
        let now = Date()
        let future = now.addingTimeInterval(90 * 60)
        XCTAssertEqual(ValueFormat.countdown(to: future, from: now), "1時間30分後")
    }

    // MARK: - surpriseComparisonLabel (Phase 5 §8 UX audit follow-up)

    func testSurpriseComparisonLabelReturnsNilForNoSurprise() {
        XCTAssertNil(ValueFormat.surpriseComparisonLabel(nil))
    }

    func testSurpriseComparisonLabelForAPositiveSurprise() {
        XCTAssertEqual(ValueFormat.surpriseComparisonLabel(0.2), "予想を上回る結果")
    }

    func testSurpriseComparisonLabelForANegativeSurprise() {
        XCTAssertEqual(ValueFormat.surpriseComparisonLabel(-0.2), "予想を下回る結果")
    }

    func testSurpriseComparisonLabelForAZeroSurprise() {
        XCTAssertEqual(ValueFormat.surpriseComparisonLabel(0), "予想通りの結果")
    }
}

final class CountryFlagTests: XCTestCase {
    func testEmojiConvertsAValidTwoLetterCode() {
        XCTAssertEqual(CountryFlag.emoji(for: "US"), "\u{1F1FA}\u{1F1F8}")
        XCTAssertEqual(CountryFlag.emoji(for: "jp"), "\u{1F1EF}\u{1F1F5}")
    }

    func testEmojiFallsBackToRawCodeForUnexpectedInput() {
        XCTAssertEqual(CountryFlag.emoji(for: "EUR"), "EUR")
    }
}

final class ValueFormatUnitTests: XCTestCase {
    func testWithUnit() {
        XCTAssertEqual(ValueFormat.withUnit(2.9, unit: "%"), "2.9%")
        XCTAssertEqual(ValueFormat.withUnit(180, unit: "千人"), "18.0万人")
        XCTAssertEqual(ValueFormat.withUnit(175, unit: "K"), "17.5万人")
        XCTAssertEqual(ValueFormat.withUnit(4.5, unit: nil), "4.5")
    }

    func testHomeEventWithoutUnitDecodesToNil() throws {
        let json = Data(#"{"event_id":"e","indicator_id":"i","indicator_name":"n","country_code":"US","currency_code":"USD","importance":"HIGH","release_datetime":"2026-10-08T00:00:00Z","release_datetime_precision":"EXACT","status":"SCHEDULED","data_status":"DATA_PENDING","forecast":null,"actual":null,"previous":null,"surprise":null,"surprise_direction":null,"related_fx_pairs":[]}"#.utf8)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(BackendDate.decode)
        XCTAssertNil(try decoder.decode(HomeEventSummary.self, from: json).unit)
    }
}

final class MovementAnalysisTextTests: XCTestCase {
    private func entry(_ timeframe: String, _ pips: Double?, status: DataQualityStatus = .ready) -> ReactionTimeframeEntry {
        ReactionTimeframeEntry(timeframe: timeframe, postReleasePrice: nil, movement: nil, pips: pips, changePercent: nil,
                               maxUpward: nil, maxDownward: nil, maxUpwardPips: nil, maxDownwardPips: nil, analysisStatus: status)
    }

    func testShortTextWithTheGeneralView() {
        let text = MovementAnalysisText.build(
            reactions: [entry("1m", -8.2), entry("5m", -24.5), entry("15m", -41.3), entry("60m", -38.9)],
            actual: 3.1, forecast: 3.2, unit: "%",
            marketViewAbove: "上回るとドルが買われやすいとされる。", marketViewBelow: "下回るとドルが売られやすいとされる。"
        )
        XCTAssertEqual(text, "結果は予想を0.1%下回った。下回るとドルが売られやすいとされる。発表後1分で8.2pips、15分で41.3pips下落した。")
    }

    func testSummarySeparatesFactsAndInterpretation() {
        let summary = MovementAnalysisText.summary(
            reactions: [entry("1m", -8.2), entry("15m", -41.3)], actual: 3.1, forecast: 3.2, unit: "%",
            marketViewAbove: "上", marketViewBelow: "下回るとドルが売られやすいとされる。"
        )
        XCTAssertEqual(summary?.facts.map(\.label), ["発表結果", "初動（1分）", "15分後"])
        XCTAssertEqual(summary?.facts.map(\.value), ["予想を0.1ポイント下回る", "-8.2 pips", "-41.3 pips"])
        XCTAssertEqual(summary?.interpretation, "下回るとドルが売られやすいとされる。")
    }

    func testReversalAndMissingData() {
        let text = MovementAnalysisText.build(reactions: [entry("1m", 5), entry("15m", -3)], actual: nil, forecast: nil, unit: nil)
        XCTAssertEqual(text, "発表後1分で5pips上昇したが、15分後には3pips下落した。")
        XCTAssertNil(MovementAnalysisText.build(reactions: [entry("1m", nil, status: .dataPending)], actual: 1, forecast: 1, unit: nil))
    }
}

final class IndicatorDetailNameTests: XCTestCase {
    func testSplitsBeforeTheParenthesis() {
        XCTAssertEqual(IndicatorDetailCard.splitName("米国CPI(消費者物価指数)").main, "米国CPI")
        XCTAssertEqual(IndicatorDetailCard.splitName("米国CPI(消費者物価指数)").paren, "(消費者物価指数)")
        XCTAssertNil(IndicatorDetailCard.splitName("FOMC政策金利").paren)
    }
}

final class HomeShortIndicatorNameTests: XCTestCase {
    func testDropsTheParenthetical() {
        XCTAssertEqual(HomeView.shortIndicatorName("米国雇用統計(非農業部門雇用者数)"), "米国雇用統計")
        XCTAssertEqual(HomeView.shortIndicatorName("日本CPI（消費者物価指数）"), "日本CPI")
        XCTAssertEqual(HomeView.shortIndicatorName("FOMC政策金利"), "FOMC政策金利")
    }
}

final class EventCommonModelsDisplayTests: XCTestCase {
    func testImportanceStarDisplayReflectsLevel() {
        XCTAssertEqual(Importance.high.starDisplay, "★★★")
        XCTAssertEqual(Importance.medium.starDisplay, "★★☆")
        XCTAssertEqual(Importance.low.starDisplay, "★☆☆")
    }

    func testDataQualityStatusLabelsAreDistinct() {
        let labels = Set([
            DataQualityStatus.ready, .dataPending, .dataUnavailable, .notAnalyzable,
        ].map(\.label))
        XCTAssertEqual(labels.count, 4)
    }
}
