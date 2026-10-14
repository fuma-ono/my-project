import XCTest
@testable import FXEventAnalyzer

@MainActor
final class SpeechListViewModelTests: XCTestCase {
    private func speech(_ id: String, name: String, org: String, title: String, minutes: Double, status: SpeechStatus, importance: Importance = .high) -> SpeechDetailResponse {
        let json = """
        {"speech_id":"\(id)","speaker":{"speaker_id":"sp-\(id)","name":"\(name)","title":"理事","organization":"\(org)","country_code":"US","currency_code":"USD","photo_url":null},
         "title":"\(title)","summary":null,"statement_datetime":"\(ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: 1_790_000_000 + minutes * 60)))",
         "importance":"\(importance.rawValue)","status":"\(status.rawValue)"}
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try! decoder.decode(SpeechDetailResponse.self, from: Data(json.utf8))
    }

    func testUpcomingComeFirstSoonestFirstThenPastNewestFirst() {
        let speeches = [
            speech("past-old", name: "A", org: "FRB", title: "t", minutes: -300, status: .delivered),
            speech("future-far", name: "B", org: "FRB", title: "t", minutes: 600, status: .scheduled),
            speech("past-new", name: "C", org: "ECB", title: "t", minutes: -60, status: .delivered),
            speech("future-near", name: "D", org: "ECB", title: "t", minutes: 30, status: .scheduled),
        ]
        let ordered = SpeechListViewModel.order(speeches)
        XCTAssertEqual(ordered.map(\.speechId), ["future-near", "future-far", "past-new", "past-old"])
    }

    func testFamilyNameIsTheLastPartOfAKatakanaName() {
        XCTAssertEqual(SpeechListView.familyName("ジェローム・パウエル"), "パウエル")
        XCTAssertEqual(SpeechListView.familyName("クリスティーヌ・ラガルド"), "ラガルド")
        XCTAssertEqual(SpeechListView.familyName("植田和男"), "植田和男")
    }

    func testSearchMatchesNameOrganizationTitleAndCountry() {
        let item = speech("1", name: "植田和男", org: "日本銀行", title: "金融経済懇談会での講演", minutes: 0, status: .scheduled)
        XCTAssertTrue(SpeechListViewModel.matchesSearch(item, query: "植田"))
        XCTAssertTrue(SpeechListViewModel.matchesSearch(item, query: "日本銀行"))
        XCTAssertTrue(SpeechListViewModel.matchesSearch(item, query: "懇談会"))
        XCTAssertTrue(SpeechListViewModel.matchesSearch(item, query: "米国"))
        XCTAssertFalse(SpeechListViewModel.matchesSearch(item, query: "ラガルド"))
    }
}
