import XCTest
@testable import FXEventAnalyzer

final class LegalDocumentsTests: XCTestCase {
    private func text(_ document: LegalDocument) -> String {
        ([document.title, document.preamble ?? ""] + document.sections.flatMap { [$0.heading, $0.lead ?? ""] + $0.items }).joined(separator: "\n")
    }

    func testTermsCoverAutoRenewalAndInvestmentDisclaimer() {
        let terms = text(LegalDocuments.terms)
        XCTAssertTrue(terms.contains("24時間前"))
        XCTAssertTrue(terms.contains("投資助言を行いません"))
        XCTAssertTrue(terms.contains("故意または重大な過失"))
        XCTAssertEqual(LegalDocuments.terms.sections.first?.heading, "第1条（適用）")
    }

    func testPrivacyPolicyNamesEveryExternalService() {
        let privacy = text(LegalDocuments.privacy)
        for service in ["Supabase", "App Store", "GitHub", "米国"] {
            XCTAssertTrue(privacy.contains(service), service)
        }
        XCTAssertTrue(privacy.contains("広告"))
    }

    func testArticlesAreNumberedInOrder() {
        for document in [LegalDocuments.terms, LegalDocuments.privacy] {
            for (index, section) in document.sections.enumerated() {
                XCTAssertTrue(section.heading.hasPrefix("第\(index + 1)条"), section.heading)
            }
        }
    }
}
