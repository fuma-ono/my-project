import XCTest
@testable import FXEventAnalyzer

/// HQ指示(2026-11-05「NY連銀の出典表示の軽微な修正」): アプリ情報の「データの出典」に NY連銀(FOMC政策金利の誘導目標
/// レンジ)の項目。著作権の表示の年は固定にせず開いたときの年(UTC)。文言は Backend の nyFedAttribution と同じ。
final class AppInfoDataSourcesTests: XCTestCase {
    private var section: LegalDocument.Section? {
        AppInfo.dataSourcesDocument.sections.first { $0.heading == "FOMC政策金利（誘導目標レンジ）" }
    }

    func testTheNYFedSectionHasTheSourceTheDecisionMakerAndTheDisclaimers() throws {
        let items = try XCTUnwrap(section).items.joined(separator: "\n")
        XCTAssertTrue(items.contains("出典：ニューヨーク連邦準備銀行（Federal Reserve Bank of New York）"))
        XCTAssertTrue(items.contains("誘導目標レンジは FOMC（米連邦公開市場委員会）が決定するもの"))
        XCTAssertTrue(items.contains("EFFR（実際の取引の金利）の値は表示していません。"))
        // HQ指示(2026-11-06「NY連銀の規約対応」修正案1): FOMC会合との対応付けは本アプリが行っていることを明示する
        XCTAssertTrue(items.contains("FOMC会合との対応付け（発表日の翌営業日以降で最初に有効になったレンジ）は、本アプリが行っています。"))
        XCTAssertTrue(items.contains("本アプリはニューヨーク連邦準備銀行と関係がなく、ニューヨーク連邦準備銀行は本アプリやそのサービスを承認・推奨していません。"))
        XCTAssertTrue(items.contains("The New York Fed is not responsible for publication of the federal funds target range data by FX Event Analyzer, does not sanction or endorse any particular republication, and has no liability for your use."))
        XCTAssertTrue(items.contains("FX Event Analyzer is not affiliated with the New York Fed. The New York Fed does not sanction, endorse, or recommend any products or services offered by FX Event Analyzer."))
    }

    func testTheCopyrightYearFollowsTheCurrentYear() throws {
        let items = try XCTUnwrap(section).items
        XCTAssertTrue(items.contains("© \(AppInfo.currentUTCYear) Federal Reserve Bank of New York. Content from the New York Fed subject to the Terms of Use at newyorkfed.org."))
        XCTAssertTrue(AppInfo.nyFedDataSourceItems(year: 2027).contains { $0.hasPrefix("© 2027 Federal Reserve Bank of New York.") })
        XCTAssertFalse(AppInfo.nyFedDataSourceItems(year: 2027).contains { $0.contains("© 2026") })
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        XCTAssertEqual(AppInfo.currentUTCYear, calendar.component(.year, from: Date()))
    }

    func testTheExistingSourcesStayInPlace() {
        XCTAssertEqual(
            AppInfo.dataSourcesDocument.sections.map(\.heading),
            ["要人発言の予定・要人の写真", "経済指標の結果の照合", "FOMC政策金利（誘導目標レンジ）", "値動き・pipsについて"]
        )
    }
}
