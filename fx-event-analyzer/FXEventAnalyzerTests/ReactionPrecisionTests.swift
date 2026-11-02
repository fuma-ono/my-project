import XCTest
@testable import FXEventAnalyzer

/// api-design v1.45(HQ指示 2026-11-02「APPROXIMATE時刻の相場反応表示対応」): 反応・チャートの応答の
/// `release_datetime_precision`は任意の項目。無い・null・知らない値でも読めること、APPROXIMATEのときだけ
/// 注記と「約」を出すことを確かめる。
final class ReactionPrecisionTests: XCTestCase {
    private func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private func reactionJSON(precision: String?) -> String {
        let field = precision.map { #","release_datetime_precision":\#($0)"# } ?? ""
        return #"{"event_id":"e1","fx_pair_id":"p1","pre_release_price":150.0,"reactions":[]"# + field + "}"
    }

    private func chartJSON(precision: String?) -> String {
        let field = precision.map { #","release_datetime_precision":\#($0)"# } ?? ""
        return #"{"event_id":"e1","fx_pair_id":"p1","timeframe":"5m","release_datetime":"2026-10-30T10:00:00Z","prices":[]"# + field + "}"
    }

    func testReactionResponseDecodesEveryForm() throws {
        let cases: [(String?, ReleaseDatetimePrecision?)] = [
            (#""APPROXIMATE""#, .approximate),
            (#""EXACT""#, .exact),
            (nil, nil), // 古いBackend(項目なし)
            ("null", nil),
            (#""SOMETHING_NEW""#, nil), // 知らない値でも応答の読み込みは失敗しない
        ]
        for (raw, expected) in cases {
            let response = try decoder().decode(ReactionAllTimeframesResponse.self, from: Data(reactionJSON(precision: raw).utf8))
            XCTAssertEqual(response.releaseDatetimePrecision, expected, "\(String(describing: raw))")
            XCTAssertEqual(response.preReleasePrice, 150.0)
        }
    }

    func testChartResponseDecodesEveryForm() throws {
        let cases: [(String?, ReleaseDatetimePrecision?)] = [
            (#""APPROXIMATE""#, .approximate),
            (#""EXACT""#, .exact),
            (nil, nil),
            ("null", nil),
            (#""SOMETHING_NEW""#, nil),
        ]
        for (raw, expected) in cases {
            let chart = try decoder().decode(ChartResponse.self, from: Data(chartJSON(precision: raw).utf8))
            XCTAssertEqual(chart.releaseDatetimePrecision, expected, "\(String(describing: raw))")
            XCTAssertEqual(chart.timeframe, "5m")
            XCTAssertNil(chart.windowFrom)
        }
    }

    func testNoticeOnlyForApproximate() {
        let notice = ReactionTimingNotice.text(precision: .approximate, releaseTimeLabel: "約11:00")
        XCTAssertEqual(notice, "発表の時刻は概算（約11:00）です。値動きは概算の時刻を起点に計算しています。")
        XCTAssertNil(ReactionTimingNotice.text(precision: .exact, releaseTimeLabel: "11:00"))
        XCTAssertNil(ReactionTimingNotice.text(precision: nil, releaseTimeLabel: "11:00"))
        XCTAssertNil(ReactionTimingNotice.text(precision: .dateOnly, releaseTimeLabel: "11:00"))
        XCTAssertNil(ReactionTimingNotice.text(precision: .unknown, releaseTimeLabel: "11:00"))
    }

    func testChartLabelPrefixOnlyForApproximate() {
        let date = Date(timeIntervalSince1970: 1_793_354_400) // 2026-10-30T10:00:00Z
        let plain = AppPreferences.shared.timeString(date)
        XCTAssertEqual(AppPreferences.shared.timeString(date, precision: .approximate), "約\(plain)")
        XCTAssertEqual(AppPreferences.shared.timeString(date, precision: .exact), plain)
        XCTAssertEqual(AppPreferences.shared.timeString(date, precision: nil), plain)
    }
}
