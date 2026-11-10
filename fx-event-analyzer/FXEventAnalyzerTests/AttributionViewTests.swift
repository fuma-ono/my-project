import XCTest
@testable import FXEventAnalyzer

/// HQ決定(2026-11-10「取得日の表示方法と出典対応」案a)。「出典：{出典}・取得日 {日付}」の
/// 短い1行表示(`AttributionLine`)の文字列組み立てを確かめる。取得日が無いときは推測せず
/// 出典名だけにすることを特に確かめる。
@MainActor
final class AttributionViewTests: XCTestCase {
    func testSummaryIncludesCapturedDateWhenPresent() {
        let capturedAt = ISO8601DateFormatter().date(from: "2026-11-07T12:30:05Z")!
        let text = AttributionLine.summaryText(source: "米国労働統計局（BLS）", capturedAt: capturedAt)
        XCTAssertTrue(text.hasPrefix("出典：米国労働統計局（BLS）・取得日 "), "got: \(text)")
    }

    /// 推測した日付を表示しない(HQ共通の禁止事項)。
    func testSummaryOmitsCapturedDateWhenAbsent() {
        let text = AttributionLine.summaryText(source: "米国労働統計局（BLS）", capturedAt: nil)
        XCTAssertEqual(text, "出典：米国労働統計局（BLS）")
    }
}
