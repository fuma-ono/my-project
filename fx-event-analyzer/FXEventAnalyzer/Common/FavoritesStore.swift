import Foundation

/// HQ指示(2026-10-02)「タップ時にオンオフに切り替えられて、お気に入り登録
/// したらどこかの画面から見れるようにしたい」。お気に入りのON/OFF状態だけを
/// 端末ローカルに永続化する最小限のストア。バックエンドにお気に入りAPIは
/// 無い(`IndicatorDetailView`の既存コメント通り)ため、`UserDefaults`で
/// 保持する — ログアウトやアンインストールで消える前提の軽量な実装。
/// 指標とイベントのIDは別々の採番空間の可能性があるため、`"indicator:<id>"`
/// / `"event:<id>"`という複合キーで型ごとに区別して保存する。
@MainActor
final class FavoritesStore: ObservableObject {
    static let shared = FavoritesStore()

    enum ItemType: String {
        case indicator
        case event
    }

    @Published private(set) var favoriteKeys: Set<String>

    private let userDefaults: UserDefaults
    private let storageKey = "com.fumaono.fxeventanalyzer.favoriteKeys"

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        favoriteKeys = Set(userDefaults.stringArray(forKey: storageKey) ?? [])
    }

    func isFavorite(_ type: ItemType, id: String) -> Bool {
        favoriteKeys.contains(Self.key(type, id))
    }

    func toggle(_ type: ItemType, id: String) {
        let key = Self.key(type, id)
        if favoriteKeys.contains(key) {
            favoriteKeys.remove(key)
        } else {
            favoriteKeys.insert(key)
        }
        userDefaults.set(Array(favoriteKeys), forKey: storageKey)
    }

    private static func key(_ type: ItemType, _ id: String) -> String {
        "\(type.rawValue):\(id)"
    }
}
