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
