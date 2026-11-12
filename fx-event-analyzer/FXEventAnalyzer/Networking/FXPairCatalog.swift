import Foundation

/// 選択できる通貨ペア(`fx_pairs.symbol`)の取得元。
///
/// 暫定(2026-10-02 HQ了承): 通貨ペア一覧APIがまだないため、Backendの
/// `fx_pairs`シードと同じ固定値を返す`StaticFXPairCatalog`を使う。最終仕様では
/// ホーム画面の「通貨ペア」からユーザーが表示ペアを編集できるようになるので、
/// 一覧APIが追加されたら`APIClient`で取得する実装をこのプロトコルに準拠させて
/// 差し替える。利用側(SCR-019 チャート設定など)は候補の出どころを知らない。
protocol FXPairCatalog {
    func availableSymbols() async throws -> [String]
}

struct StaticFXPairCatalog: FXPairCatalog {
    static let seededSymbols = ["USDJPY", "EURUSD", "EURJPY"]

    func availableSymbols() async throws -> [String] {
        Self.seededSymbols
    }
}

enum FXPairSymbol {
    /// "USDJPY" → "USD/JPY"。6文字の通貨コード2つでない記号はそのまま返す。
    static func displayName(_ symbol: String) -> String {
        guard symbol.count == 6 else { return symbol }
        return "\(symbol.prefix(3))/\(symbol.suffix(3))"
    }
}
