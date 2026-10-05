import Foundation

/// HQ指示(2026-10-02)「タップ時にオンオフに切り替えられて、お気に入り登録
/// したらどこかの画面から見れるようにしたい」。お気に入りのON/OFF状態だけを
/// 端末ローカルに永続化する最小限のストア。バックエンドにお気に入りAPIは
/// 無い(`IndicatorDetailView`の既存コメント通り)ため、`UserDefaults`で
/// 保持する — ログアウトやアンインストールで消える前提の軽量な実装。
/// 指標とイベントのIDは別々の採番空間の可能性があるため、`"indicator:<id>"`
/// / `"event:<id>"`という複合キーで型ごとに区別して保存する。
///
/// HQ指示(2026-10-02、追加)「ホーム画面にお気に入り(最大3件)」: Home側で
/// 「直近登録した順」に表示する必要があるため、`Set`(順序なし)から配列
/// (新しく登録したものを先頭に挿入)へ変更した。
@MainActor
final class FavoritesStore: ObservableObject {
    static let shared = FavoritesStore()

    enum ItemType: String {
        case indicator
        case event
        /// HQ指示(2026-10-02)「お気に入りは指標・イベント・通貨ペア」。
        /// 通貨ペア単体を取得するAPIも、どの画面にも通貨ペアをお気に入り
        /// 登録する★も現状無いため、このtypeのエントリは実際には発生しない
        /// — 両方が揃った時にすぐ使えるよう型だけ先に用意している。
        case fxPair
    }

    struct Entry: Equatable {
        let type: ItemType
        let id: String
    }

    /// 新しく登録した順(先頭が最新)。
    @Published private(set) var entries: [Entry]

    private let userDefaults: UserDefaults
    private let storageKey = "com.fumaono.fxeventanalyzer.favoriteKeys"

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        entries = (userDefaults.stringArray(forKey: storageKey) ?? []).compactMap(Self.parse)
    }

    func isFavorite(_ type: ItemType, id: String) -> Bool {
        entries.contains { $0.type == type && $0.id == id }
    }

    func toggle(_ type: ItemType, id: String) {
        if let index = entries.firstIndex(where: { $0.type == type && $0.id == id }) {
            entries.remove(at: index)
        } else {
            entries.insert(Entry(type: type, id: id), at: 0)
        }
        userDefaults.set(entries.map(Self.key), forKey: storageKey)
    }

    /// すべてのお気に入りを消す。SCR-024 アカウント削除で、サーバー側の
    /// データと一緒に端末のお気に入りも消すために使う(HQ指示 2026-10-05)。
    func removeAll() {
        entries = []
        userDefaults.removeObject(forKey: storageKey)
    }

    private static func key(_ entry: Entry) -> String {
        "\(entry.type.rawValue):\(entry.id)"
    }

    private static func parse(_ raw: String) -> Entry? {
        let parts = raw.split(separator: ":", maxSplits: 1)
        guard parts.count == 2, let type = ItemType(rawValue: String(parts[0])) else { return nil }
        return Entry(type: type, id: String(parts[1]))
    }
}
