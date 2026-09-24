import Foundation
import SwiftUI

/// HQ UI Master v5 Frontend integration (2026-09-24): `HQV5Event`/
/// `HQV5PairReaction` are HQ's own reusable UI-row types (unchanged from
/// `Sources/HQV5Models.swift`), used as the adapter target each screen maps
/// real ViewModel data into. `HQV5Store` (hardcoded demo instances) and
/// `HQV5DemoRouter` (a `HQV5RootView`-only navigation stand-in) are
/// deliberately NOT carried over — the package's own README calls them
/// "the demo store/adapters" to replace with "the existing production
/// ViewModels/API", and this app already has real ViewModels and a real
/// `AppRoute`/`NavigationPath` for that.
struct HQV5Event: Identifiable {
    let id: String
    let flag: String
    let name: String
    let code: String
    let importance: HQV5Badge.Kind
    let importanceText: String
    let time: String
    let forecast: String
    let actual: String
    let previous: String
    let surprise: String
}

struct HQV5PairReaction: Identifiable {
    let id = UUID()
    let pair: String
    let value: String
    let positive: Bool
}
