import Foundation

/// Navigation destinations pushed onto a tab's `NavigationStack`
/// (ui-screens.md §6 コア画面遷移):
/// Home → Event Detail; Indicators → Indicator Detail → Historical Event
/// Detail → Indicator Detail. Deliberately a flat enum rather than a
/// Router/Coordinator abstraction — each tab owns its own `NavigationPath`
/// and pushes these directly (HQ Phase 3 instruction: "過度なRouter抽象化
/// は避ける").
enum AppRoute: Hashable {
    case indicatorDetail(id: String)
    case eventDetail(id: String)
    case historicalEventDetail(id: String)
}
