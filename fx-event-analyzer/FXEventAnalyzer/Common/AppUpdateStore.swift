import Foundation

/// HQ指示(2026-10-25)「アップデートしたことを分かりやすくするために、
/// アップデートしてくださいのポップをだして、App Storeで更新させるように
/// したい」への対応。HQ確認済み(2026-10-25、AskUserQuestion):
/// - 「最新バージョン」はApp Store公開後の運用を想定し、AppleのiTunes
///   Lookup API(`https://itunes.apple.com/lookup?bundleId=...`、認証不要の
///   公開API)で配信中のバージョンを取得する。Backend側の変更は不要。
/// - ポップアップは閉じられる案内(強制アップデートではない)。「後で」で
///   閉じれば同じバージョンでは再度出さない(`UserDefaults`に記録)。
///
/// このアプリは本ラウンド時点でApp Store未公開(TestFlightのみ)のため、
/// `resultCount`は常に0(`results`が空)になり、実際にポップアップが出る
/// のはApp Store公開後になる — 公開前は常に何も起きない(安全側)。
@MainActor
final class AppUpdateStore: ObservableObject {
    static let shared = AppUpdateStore()

    @Published private(set) var availableUpdate: AppUpdateInfo?

    private let userDefaults: UserDefaults
    private let bundleId: String?
    private let currentVersion: String
    private let session: URLSession
    private static let dismissedVersionKey = "appUpdate.dismissedVersion"

    init(
        userDefaults: UserDefaults = .standard,
        bundleId: String? = Bundle.main.bundleIdentifier,
        currentVersion: String = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0",
        session: URLSession = .shared
    ) {
        self.userDefaults = userDefaults
        self.bundleId = bundleId
        self.currentVersion = currentVersion
        self.session = session
    }

    /// 起動時・フォアグラウンド復帰時に呼ぶ。通信失敗・未公開(結果0件)・
    /// 既に「後で」で閉じたバージョンはいずれも無視して良い(起動を妨げない)。
    func checkForUpdate() async {
        guard let bundleId, !bundleId.isEmpty,
              let url = URL(string: "https://itunes.apple.com/lookup?bundleId=\(bundleId)")
        else { return }
        do {
            let (data, _) = try await session.data(from: url)
            let lookup = try JSONDecoder().decode(ITunesLookupResponse.self, from: data)
            guard let result = lookup.results.first,
                  let storeURL = URL(string: result.trackViewUrl),
                  Self.isNewerVersion(result.version, than: currentVersion),
                  userDefaults.string(forKey: Self.dismissedVersionKey) != result.version
            else { return }
            availableUpdate = AppUpdateInfo(latestVersion: result.version, storeURL: storeURL)
        } catch {
            // 通信エラー・JSON形式不一致はいずれも「今回は案内しない」で良い。
        }
    }

    /// テスト用。実際のネットワーク取得(`checkForUpdate()`)を経由せず、
    /// 案内の表示・`dismiss()`だけを検証するために使う。
    func set(availableUpdate: AppUpdateInfo?) {
        self.availableUpdate = availableUpdate
    }

    /// 「後で」または「アップデート」を押した後に呼ぶ。同じバージョンでは
    /// 次回以降案内しない。
    func dismiss() {
        guard let version = availableUpdate?.latestVersion else { return }
        userDefaults.set(version, forKey: Self.dismissedVersionKey)
        availableUpdate = nil
    }

    /// "1.10.0" > "1.9.0"のようなドット区切りの数値比較(文字列の辞書順
    /// 比較だと"1.9.0" > "1.10.0"になってしまい誤る)。
    static func isNewerVersion(_ candidate: String, than current: String) -> Bool {
        let candidateParts = candidate.split(separator: ".").map { Int($0) ?? 0 }
        let currentParts = current.split(separator: ".").map { Int($0) ?? 0 }
        let count = max(candidateParts.count, currentParts.count)
        for index in 0..<count {
            let a = index < candidateParts.count ? candidateParts[index] : 0
            let b = index < currentParts.count ? currentParts[index] : 0
            if a != b { return a > b }
        }
        return false
    }
}

struct AppUpdateInfo: Equatable {
    let latestVersion: String
    let storeURL: URL
}

private struct ITunesLookupResponse: Decodable {
    let results: [ITunesLookupResult]
}

private struct ITunesLookupResult: Decodable {
    let version: String
    let trackViewUrl: String
}
