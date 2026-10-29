import XCTest
@testable import FXEventAnalyzer

/// HQ指示(2026-10-24)「カレンダーからはイベント詳細に遷移してほしい」:
/// 2026-10-09の指示で指標の行を指標詳細(SCR-006)へ変更していたが、タップした
/// 具体的な発表(イベントID)の情報が失われ、その日の相場反応詳細(SCR-008)へ
/// 進めなくなっていたため元に戻した(`CalendarItem.route`)。この挙動を固定する。
final class CalendarModelsTests: XCTestCase {
    private func date(_ y: Int, _ m: Int, _ d: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar.date(from: DateComponents(year: y, month: m, day: d))!
    }

    func testIndicatorRowRoutesToEventDetailEvenWhenIndicatorIdIsPresent() {
        let item = CalendarItem(
            kind: .indicator, id: "event-1", indicatorId: "indicator-1", title: "米国CPI",
            speakerName: nil, countryCode: "US", currencyCode: "USD", importance: .high,
            datetime: date(2026, 11, 10), datetimePrecision: .exact, status: "RELEASED"
        )
        XCTAssertEqual(item.route, .eventDetail(id: "event-1"))
    }

    func testIndicatorRowRoutesToEventDetailWhenIndicatorIdIsMissing() {
        let item = CalendarItem(
            kind: .indicator, id: "event-2", title: "米国雇用統計",
            speakerName: nil, countryCode: "US", currencyCode: "USD", importance: .high,
            datetime: date(2026, 11, 6), datetimePrecision: .exact, status: "SCHEDULED"
        )
        XCTAssertEqual(item.route, .eventDetail(id: "event-2"))
    }

    func testSpeechRowRoutesToSpeechDetail() {
        let item = CalendarItem(
            kind: .speech, id: "speech-1", title: "FRB議長発言",
            speakerName: "Speaker", countryCode: "US", currencyCode: "USD", importance: .medium,
            datetime: date(2026, 11, 10), datetimePrecision: .exact, status: "DELIVERED"
        )
        XCTAssertEqual(item.route, .speechDetail(id: "speech-1"))
    }

    // MARK: - 指標の状態表示(result_type/data_status、api-design v1.42)

    private func indicatorItem(datetime: Date, resultType: ResultType?, dataStatus: DataQualityStatus?) -> CalendarItem {
        CalendarItem(
            kind: .indicator, id: "event-1", title: "米国FOMC議事要旨",
            speakerName: nil, countryCode: "US", currencyCode: "USD", importance: .high,
            datetime: datetime, datetimePrecision: .exact, status: "RELEASED",
            resultType: resultType, dataStatus: dataStatus
        )
    }

    /// HQ指示(2026-10-29)「指標の状態表示」: NONEで発表時刻を過ぎたら「公表済み」
    /// (結果の値が出ない予定、今はFOMC議事要旨だけ)。
    func testResultStatusLabelShowsPublishedForNoValueAfterReleaseTime() {
        let item = indicatorItem(datetime: date(2026, 11, 10), resultType: .noValue, dataStatus: nil)
        XCTAssertEqual(item.resultStatusLabel(now: date(2026, 11, 11)), "公表済み")
    }

    /// VALUEで発表時刻を過ぎてDATA_PENDINGなら「結果待ち」(値を推測で埋めない)。
    func testResultStatusLabelShowsWaitingForValuePendingAfterReleaseTime() {
        let item = indicatorItem(datetime: date(2026, 11, 10), resultType: .value, dataStatus: .dataPending)
        XCTAssertEqual(item.resultStatusLabel(now: date(2026, 11, 11)), "結果待ち")
    }

    /// 発表時刻の前は、どちらの種類でも何も表示しない。
    func testResultStatusLabelIsNilBeforeReleaseTime() {
        let item = indicatorItem(datetime: date(2026, 11, 10), resultType: .noValue, dataStatus: nil)
        XCTAssertNil(item.resultStatusLabel(now: date(2026, 11, 9)))
    }

    /// VALUEでもREADY(結果が出ている)なら、値そのものはこの表示の対象外なので何も出さない。
    func testResultStatusLabelIsNilWhenValueIsReady() {
        let item = indicatorItem(datetime: date(2026, 11, 10), resultType: .value, dataStatus: .ready)
        XCTAssertNil(item.resultStatusLabel(now: date(2026, 11, 11)))
    }

    /// result_typeが無い(古いBackend)行は何も表示しない。
    func testResultStatusLabelIsNilWithoutResultType() {
        let item = indicatorItem(datetime: date(2026, 11, 10), resultType: nil, dataStatus: nil)
        XCTAssertNil(item.resultStatusLabel(now: date(2026, 11, 11)))
    }
}
