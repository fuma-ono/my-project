import XCTest
@testable import FXEventAnalyzer

final class DesignTokensTests: XCTestCase {
    func testSpacingScaleIsMonotonicallyIncreasing() {
        let scale = [
            DesignTokens.Spacing.xs,
            DesignTokens.Spacing.sm,
            DesignTokens.Spacing.md,
            DesignTokens.Spacing.lg,
            DesignTokens.Spacing.xl,
        ]
        XCTAssertEqual(scale, scale.sorted(), "Spacing tokens must stay ordered xs < sm < md < lg < xl")
        XCTAssertEqual(Set(scale).count, scale.count, "Spacing tokens must be distinct")
    }

    func testCornerRadiiArePositive() {
        XCTAssertGreaterThan(DesignTokens.CornerRadius.card, 0)
        XCTAssertGreaterThan(DesignTokens.CornerRadius.control, 0)
    }
}
