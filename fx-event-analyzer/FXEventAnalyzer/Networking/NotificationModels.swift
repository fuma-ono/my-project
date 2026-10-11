import Foundation

/// HQ指示(Calendar/Settings/Accountのみ移植): 元ファイルには
/// `GET /api/v1/notifications/upcoming`用の`UpcomingNotificationsResponse`/
/// `UpcomingNotification`/`NotificationService`(端末内ローカル通知の予約
/// 基盤、`LocalNotificationScheduler`が使う)も定義されていたが、その基盤
/// 自体は今回のポート対象外のため含めていない。ここに残すのは
/// `GET /api/v1/fx-pairs`(api-design.md §25.2)関連の型だけで、これは
/// SCR-016 通知設定の対象通貨ペアピッカー(`RemoteFXPairCatalog`、
/// `FXPairCatalog.swift`)が使う。

/// `GET /api/v1/fx-pairs`の1件。
struct FXPairResponse: Decodable, Equatable {
    let symbol: String
}

struct FXPairListResponse: Decodable, Equatable {
    let data: [FXPairResponse]
}

/// `GET /fx-pairs`で通貨ペアの候補を取る`FXPairCatalog`。一覧APIが使えない
/// (古いBackend・通信失敗)ときは、シードと同じ固定値に戻す。
struct RemoteFXPairCatalog: FXPairCatalog {
    let apiClient: APIClient

    func availableSymbols() async throws -> [String] {
        do {
            let response: FXPairListResponse = try await apiClient.send(Endpoint(path: "fx-pairs"))
            let symbols = response.data.map(\.symbol)
            return symbols.isEmpty ? StaticFXPairCatalog.seededSymbols : symbols
        } catch {
            return try await StaticFXPairCatalog().availableSymbols()
        }
    }
}
