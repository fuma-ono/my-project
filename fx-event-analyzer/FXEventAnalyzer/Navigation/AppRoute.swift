import Foundation

/// Navigation destinations pushed onto a tab's `NavigationStack`
/// (ui-screens.md §6 コア画面遷移):
/// Home → Event Detail → Movement Detail; Indicators → Indicator Detail →
/// Historical Event Detail → Indicator Detail; Indicator Detail →
/// Historical Comparison. Deliberately a flat enum rather than a
/// Router/Coordinator abstraction — each tab owns its own `NavigationPath`
/// and pushes these directly (HQ Phase 3 instruction: "過度なRouter抽象化
/// は避ける").
enum AppRoute: Hashable {
    case indicatorDetail(id: String)
    case eventDetail(id: String)
    case historicalEventDetail(id: String)
    /// SCR-004's related FX pair rows carry enough already-fetched display
    /// context (symbol/indicator name/release datetime) to avoid an extra
    /// round trip just to re-render Movement Detail's header.
    case movementDetail(eventId: String, fxPairId: String, symbol: String, indicatorName: String, releaseDatetime: Date)
    case historicalComparison(indicatorId: String, indicatorName: String, fxPairId: String, fxPairSymbol: String)
}
