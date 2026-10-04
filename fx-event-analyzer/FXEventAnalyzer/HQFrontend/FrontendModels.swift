import Foundation

// Visual-layer models. Claude Code should map existing API/ViewModel models into these shapes.
// They intentionally contain no networking or business logic.

struct FXEventUI: Identifiable, Hashable {
    let id: String
    let indicatorID: String
    let indicatorName: String
    let country: String
    let currency: String
    let importance: String
    let releaseDate: Date
    let status: String
    let dataStatus: String
    let forecast: String?
    let actual: String?
    let previous: String?
    let surprise: String?
    let surpriseLabel: String?
    let pair: String
    let reaction5m: String?
}

struct FXIndicatorUI: Identifiable, Hashable {
    let id: String
    let name: String
    let code: String
    let country: String
    let currency: String
    let importance: String
    let description: String
    let source: String
}

struct FXPairUI: Identifiable, Hashable { let id: String; let symbol: String; let price: String; let change: String; let isUp: Bool }

struct FXReactionUI: Identifiable, Hashable {
    let id = UUID(); let timeframe: String; let movement: String; let pips: String; let percent: String; let direction: String
}

struct FXHistoryUI: Identifiable, Hashable {
    let id: String; let date: Date; let forecast: String?; let actual: String?; let surprise: String?; let reaction: String?; let pair: String
}

struct FXRevisionUI: Identifiable, Hashable { let id: String; let field: String; let oldValue: String; let newValue: String; let date: Date; let source: String }
