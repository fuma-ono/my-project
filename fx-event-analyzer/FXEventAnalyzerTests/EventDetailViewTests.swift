import SwiftUI
import XCTest
@testable import FXEventAnalyzer

/// HQ指示(2026-11-09「StrategyAnalysisのFREE/PROアクセス制御」): 「トレード戦略分析」へ
/// 遷移してよいかは`PlanStore`の確定済みプランだけで決める。未確定・取得失敗のまま(`isConfirmed
/// == false`)FREE/PROを誤判定して遷移させないことを確かめる。
@MainActor
final class EventDetailViewTests: XCTestCase {
    override func tearDown() {
        // `EventDetailView`は`PlanStore.shared`を直接見るため、他のテストに影響しないよう
        // 必ず既定(未確定・無料プラン)に戻す。
        PlanStore.shared.reset()
        super.tearDown()
    }

    private func makeView() -> EventDetailView {
        EventDetailView(apiClient: MockAPIClient(), eventId: "evt_1", tabSelection: .constant(0))
    }

    func testUnconfirmedPlanCannotOpenStrategyAnalysis() {
        PlanStore.shared.reset() // 起動直後・/entitlements 取得前と同じ(未確定)
        XCTAssertFalse(makeView().canOpenStrategyAnalysis, "an unconfirmed plan must never be treated as PRO")
    }

    func testConfirmedFreePlanCannotOpenStrategyAnalysis() {
        PlanStore.shared.set(plan: .free, limits: .free())
        XCTAssertFalse(makeView().canOpenStrategyAnalysis)
    }

    func testConfirmedProPlanCanOpenStrategyAnalysis() {
        PlanStore.shared.set(plan: .pro, limits: .pro())
        XCTAssertTrue(makeView().canOpenStrategyAnalysis)
    }

    /// `/entitlements`の確認に失敗した(前回の値のまま・未確定)場合、前回たまたまPROだった
    /// としても、確定していない限り遷移させない。
    func testProValueWithoutConfirmationCannotOpenStrategyAnalysis() {
        PlanStore.shared.set(plan: .pro, limits: .pro(), confirmed: false)
        XCTAssertFalse(makeView().canOpenStrategyAnalysis, "an unconfirmed PRO-looking value must still be treated as blocked")
    }
}
