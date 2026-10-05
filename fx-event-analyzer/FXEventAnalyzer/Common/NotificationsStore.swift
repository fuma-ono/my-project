import Foundation

/// HQ指示(2026-10-04)「通知があった場合に赤バッチがつく仕組みにして」。
///
/// 通知機能自体(プッシュ通知・通知一覧・未読管理)はバックエンドに未実装で、
/// 要件定義書(features.md FEAT-221)でも「MVPでは対象外、将来のP2機能」と
/// 明記されている。実データの無い通知を捏造してバッジを常時点灯させる
/// わけにはいかないため、HQの回答(「仕組みだけ用意し、今は非表示のまま」)
/// に従い、`FavoritesStore`と同じ「型だけ先に用意しておく」方針で、未読有無
/// を持つだけの軽量なストアをここに用意した。
///
/// 現時点では`hasUnread`をtrueにする経路が一切無い(セットする呼び出し元が
/// 存在しない)ため、`HomeView`の通知ベルの赤バッジは常に非表示になる。
/// 将来、通知APIが実装された時点で、その取得結果を`setUnread(_:)`に渡す
/// だけでバッジが実際に動くようになる。
@MainActor
final class NotificationsStore: ObservableObject {
    static let shared = NotificationsStore()

    @Published private(set) var hasUnread: Bool = false

    private init() {}

    func setUnread(_ hasUnread: Bool) {
        self.hasUnread = hasUnread
    }
}
