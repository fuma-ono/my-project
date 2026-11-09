import Foundation

/// 表示設定の「基本通貨」(HQ指示 2026-10-15「通貨は基本通貨として設定し、優先して出す」)。
/// 通貨ペアの候補(ホーム通貨ペアの追加・通知の対象通貨ペア・レートアラート・検索の通貨ペア)を、
/// 基本通貨を含むペアを先に並べる。同じ組の中の順番は元のまま。
enum BaseCurrency {
    static func prioritize(_ symbols: [String], base: String) -> [String] {
        let code = base.uppercased()
        guard code.count == 3 else { return symbols }
        let matches = symbols.filter { $0.replacingOccurrences(of: "/", with: "").uppercased().contains(code) }
        return matches + symbols.filter { !matches.contains($0) }
    }

    @MainActor static func prioritize(_ symbols: [String]) -> [String] {
        prioritize(symbols, base: AppPreferences.shared.display.currency)
    }
}
