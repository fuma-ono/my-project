import XCTest
@testable import FXEventAnalyzer

/// api-design v1.54(HQ指示 2026-11-26「日銀・ECBの会合日程の表示」): `event.meeting`。会合の期間・出所・公式ページ(https)だけで、
/// 時刻や値は無い。古いBackend(項目が無い)・対象外のイベントではnil(今までの表示)。DATE_ONLYは時刻を出さない。
final class MeetingDisplayTests: XCTestCase {
    private func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private let event = #"{"id":"e1","indicator_id":"i1","indicator_name":"日銀政策金利","country_code":"JP","currency_code":"JPY","release_datetime":"2026-12-18T03:00:00Z","release_datetime_precision":"DATE_ONLY","importance":"HIGH","status":"SCHEDULED","data_status":"DATA_PENDING","revision_status":"NONE""#

    func testDecodesMeetingPeriodSourceAndLink() throws {
        let json = event + #","meeting":{"start_date":"2026-12-17","end_date":"2026-12-18","source_url":"https://www.boj.or.jp/mopo/mpmsche_minu/index.htm","source_name":"日本銀行"}}"#
        let decoded = try decoder().decode(EventDetailEvent.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.releaseDatetimePrecision, .dateOnly)
        XCTAssertEqual(decoded.meeting?.periodText, "12月17日〜12月18日")
        XCTAssertEqual(decoded.meeting?.sourceName, "日本銀行")
        XCTAssertEqual(decoded.meeting?.officialURL?.absoluteString, "https://www.boj.or.jp/mopo/mpmsche_minu/index.htm")
    }

    func testNilForOldBackendsAndOtherEvents() throws {
        XCTAssertNil(try decoder().decode(EventDetailEvent.self, from: Data((event + "}").utf8)).meeting)
        XCTAssertNil(try decoder().decode(EventDetailEvent.self, from: Data((event + #","meeting":null}"#).utf8)).meeting)
    }

    func testMalformedMeetingDropsOnlyTheMeeting() throws {
        let wrongType = event + #","meeting":{"start_date":20261217,"end_date":"2026-12-18","source_url":"https://www.boj.or.jp","source_name":"日本銀行"}}"#
        let decoded = try decoder().decode(EventDetailEvent.self, from: Data(wrongType.utf8))
        XCTAssertNil(decoded.meeting)
        XCTAssertEqual(decoded.id, "e1")
        let notAnObject = event + #","meeting":"oops"}"#
        XCTAssertNil(try decoder().decode(EventDetailEvent.self, from: Data(notAnObject.utf8)).meeting)
        let missingKey = event + #","meeting":{"start_date":"2026-12-17"}}"#
        XCTAssertNil(try decoder().decode(EventDetailEvent.self, from: Data(missingKey.utf8)).meeting)
    }

    func testIndicatorSummaryReadsPrecisionAndResultType() throws {
        let base = #"{"id":"i1","code":"BOJ_RATE","name":"日銀政策金利","country_code":"JP","currency_code":"JPY","importance":"HIGH","description":null,"frequency":"IRREGULAR","unit":null,"source":null,"source_url":null,"favorable_direction":"NEUTRAL""#
        let withFields = base + #","next_release_datetime":"2026-12-18T03:00:00Z","next_release_precision":"DATE_ONLY","latest_release_precision":null,"result_type":"NONE"}"#
        let summary = try decoder().decode(IndicatorSummary.self, from: Data(withFields.utf8))
        XCTAssertFalse(summary.nextReleaseShowsTime)
        XCTAssertFalse(summary.hasResultValues)
        // 古いバックエンド・未知の値の確認は、予定だけの指標(BOJ_RATE / EU_ECB_RATE)ではない指標コードで行う
        // (予定だけの指標は、精度が無くても時刻なし・結果なしにする安全側の判定がある)。
        let valueBase = base.replacingOccurrences(of: "BOJ_RATE", with: "US_CPI")
        let old = try decoder().decode(IndicatorSummary.self, from: Data((valueBase + "}").utf8))
        XCTAssertTrue(old.nextReleaseShowsTime)
        XCTAssertTrue(old.hasResultValues)
        let unknown = valueBase + #","next_release_precision":"SOMETHING_NEW","result_type":"SOMETHING_NEW"}"#
        let tolerant = try decoder().decode(IndicatorSummary.self, from: Data(unknown.utf8))
        XCTAssertTrue(tolerant.nextReleaseShowsTime)
        XCTAssertTrue(tolerant.hasResultValues)
        // 予定だけの指標は、古いバックエンド(精度・結果の種類が無い)でも、時刻なし・結果なし。
        let scheduleOnlyOld = try decoder().decode(IndicatorSummary.self, from: Data((base + "}").utf8))
        XCTAssertFalse(scheduleOnlyOld.nextReleaseShowsTime)
        XCTAssertFalse(scheduleOnlyOld.hasResultValues)
    }

    func testIndicatorEventSummaryReadsPrecision() throws {
        let json = #"{"event_id":"e1","indicator_id":"i1","release_datetime":"2026-12-18T03:00:00Z","release_datetime_precision":"DATE_ONLY","status":"SCHEDULED","data_status":"DATA_PENDING","forecast":null,"actual":null,"previous":null,"surprise":null,"surprise_direction":null}"#
        let summary = try decoder().decode(IndicatorEventSummary.self, from: Data(json.utf8))
        XCTAssertEqual(summary.precision, .dateOnly)
        XCTAssertFalse(summary.showsTime)
    }

    func testPeriodTextHandlesSingleDayAndUnreadableDates() {
        let one = EventMeeting(startDate: "2027-01-21", endDate: "2027-01-21", sourceUrl: "https://example.com", sourceName: "x")
        XCTAssertEqual(one.periodText, "1月21日")
        let bad = EventMeeting(startDate: "bad", endDate: "2027-01-22", sourceUrl: "https://example.com", sourceName: "x")
        XCTAssertNil(bad.periodText)
    }

    func testOnlyHttpsLinksAreOffered() {
        let http = EventMeeting(startDate: "2026-12-16", endDate: "2026-12-17", sourceUrl: "http://www.ecb.europa.eu", sourceName: "欧州中央銀行(ECB)")
        XCTAssertNil(http.officialURL)
        let other = EventMeeting(startDate: "2026-12-16", endDate: "2026-12-17", sourceUrl: "javascript:alert(1)", sourceName: "x")
        XCTAssertNil(other.officialURL)
    }

    func testDateOnlyAndUnknownDoNotShowATime() {
        XCTAssertFalse(ReleaseDatetimePrecision.dateOnly.showsTime)
        XCTAssertFalse(ReleaseDatetimePrecision.unknown.showsTime)
        XCTAssertTrue(ReleaseDatetimePrecision.exact.showsTime)
        XCTAssertTrue(ReleaseDatetimePrecision.approximate.showsTime)
    }

    // MARK: - 時刻を出さない固定の判定(precision / result_typeが無い古い応答)

    private let indicatorBase = #"{"id":"i1","name":"x","country_code":"JP","currency_code":"JPY","importance":"HIGH","description":null,"frequency":"IRREGULAR","unit":null,"source":null,"source_url":null,"favorable_direction":"NEUTRAL""#

    func testScheduleOnlyCodesNeverShowATimeEvenWithoutPrecision() throws {
        for code in ["BOJ_RATE", "EU_ECB_RATE"] {
            let json = indicatorBase + #","code":"\#(code)","next_release_datetime":"2026-12-18T03:00:00Z"}"#
            let summary = try decoder().decode(IndicatorSummary.self, from: Data(json.utf8))
            XCTAssertTrue(summary.isScheduleOnly)
            XCTAssertFalse(summary.nextReleaseShowsTime)
            XCTAssertFalse(summary.hasResultValues)
        }
    }

    func testNoneResultTypeHidesTheComparisonAndValueKeepsIt() throws {
        let none = indicatorBase + #","code":"X_NONE","result_type":"NONE"}"#
        XCTAssertFalse(try decoder().decode(IndicatorSummary.self, from: Data(none.utf8)).hasResultValues)
        let value = indicatorBase + #","code":"US_CPI","result_type":"VALUE","next_release_precision":"EXACT"}"#
        let cpi = try decoder().decode(IndicatorSummary.self, from: Data(value.utf8))
        XCTAssertTrue(cpi.hasResultValues)
        XCTAssertTrue(cpi.nextReleaseShowsTime)
        XCTAssertFalse(cpi.isScheduleOnly)
        let old = indicatorBase + #","code":"US_CPI"}"#
        XCTAssertTrue(try decoder().decode(IndicatorSummary.self, from: Data(old.utf8)).hasResultValues)
    }

    @MainActor
    func testEventDetailHeaderHasNoClockTimeForAMeetingEvenIfPrecisionSaysExact() throws {
        let exactWithMeeting = event.replacingOccurrences(of: "DATE_ONLY", with: "EXACT")
            + #","meeting":{"start_date":"2026-12-17","end_date":"2026-12-18","source_url":"https://www.boj.or.jp","source_name":"日本銀行"}}"#
        let withMeeting = try decoder().decode(EventDetailEvent.self, from: Data(exactWithMeeting.utf8))
        let dateOnlyText = EventDetailCards.releaseDateTimeText(withMeeting)
        XCTAssertFalse(dateOnlyText.contains(" "))
        XCTAssertFalse(dateOnlyText.contains(":"))
        let dateOnly = try decoder().decode(EventDetailEvent.self, from: Data((event + "}").utf8))
        XCTAssertFalse(EventDetailCards.releaseDateTimeText(dateOnly).contains(":"))
    }

    // MARK: - お気に入りの保存(古い形式の読み込み)

    /// 精度の項目を足す前に保存された`HomeFavoriteItem`(標準の`JSONEncoder`の形式。日付は2001年からの秒数)。
    func testOldCachedFavoritesWithoutPrecisionStillDecode() throws {
        let oldIndicator = #"{"indicator":{"id":"i1","countryCode":"US","currencyCode":"USD","name":"米国CPI","importance":"HIGH","nextReleaseDatetime":782000000}}"#
        let oldIndicatorNoDate = #"{"indicator":{"id":"i2","countryCode":"JP","currencyCode":"JPY","name":"日銀","importance":"HIGH"}}"#
        let oldEvent = #"{"event":{"id":"e1","countryCode":"US","currencyCode":"USD","name":"米国CPI","importance":"HIGH","releaseDatetime":782000000}}"#
        let decoder = JSONDecoder()
        let indicator = try decoder.decode(HomeFavoriteItem.self, from: Data(oldIndicator.utf8))
        XCTAssertEqual(indicator.id, "indicator:i1")
        guard case let .indicator(_, _, _, _, _, nextDate, nextPrecision) = indicator else { return XCTFail("indicator expected") }
        XCTAssertNotNil(nextDate)
        XCTAssertNil(nextPrecision)
        let noDate = try decoder.decode(HomeFavoriteItem.self, from: Data(oldIndicatorNoDate.utf8))
        XCTAssertEqual(noDate.id, "indicator:i2")
        let event = try decoder.decode(HomeFavoriteItem.self, from: Data(oldEvent.utf8))
        guard case let .event(_, _, _, _, _, _, precision) = event else { return XCTFail("event expected") }
        XCTAssertNil(precision)
    }

    func testNewFavoritesRoundTripWithPrecision() throws {
        let item = HomeFavoriteItem.indicator(id: "i1", countryCode: "JP", currencyCode: "JPY", name: "日銀", importance: .high, nextReleaseDatetime: Date(timeIntervalSince1970: 1_800_000_000), nextReleasePrecision: .dateOnly)
        let data = try JSONEncoder().encode(item)
        XCTAssertEqual(try JSONDecoder().decode(HomeFavoriteItem.self, from: data), item)
    }
}
