import Foundation

/// HQ決定(2026-10-21「起動の遅れの改善A1」): 前回取得した`/home`の応答を
/// 端末内に保存しておき、起動直後に鮮度表示付きで先に表示するための値。
/// サーバーには送らない。
struct HomeSnapshot: Codable, Equatable {
    let events: [HomeEventSummary]
    let majorFx: [MajorFxSummary]
    let speeches: [HomeSpeechSummary]
    /// 取得した端末時刻(壁時計)。使える条件(12時間以内)の判定に使う。
    let fetchedAt: Date
    /// 要求した`/home?date=`。
    let requestedDate: String
    /// 要求した`/home?timezone=`。
    let requestedTimezone: String
    /// 取得した利用者の`UserSession.userID`(文字列化したUUID)。
    let userID: String
}

/// `HomeSnapshotStore.load(...)`の結果。「使える」場合だけ`HomeSnapshot`を
/// 持ち、それ以外は理由だけを持つ(表示には使わない)。
enum HomeSnapshotLoadResult: Equatable {
    case usable(HomeSnapshot)
    case unusable(Outcome, ageSeconds: Double?)

    /// `LaunchDiagnostics.homeSnapshotOutcome`にそのまま記録する文字列。
    enum Outcome: String, Equatable {
        case used = "使った"
        case notFound = "保存なし"
        case decodeFailed = "読み込み失敗"
        case formatVersionMismatch = "形式の版が違う"
        case userMismatch = "利用者が違う"
        case dateMismatch = "日付が違う"
        case timezoneMismatch = "時間帯が違う"
        case expired = "期限切れ"
        /// ログイン中の利用者IDが(まだ)取れなかった — 前回データは使わない。
        case userIDUnavailable = "利用者ID未解決"
    }

    var outcome: Outcome {
        switch self {
        case .usable: return .used
        case .unusable(let outcome, _): return outcome
        }
    }

    var ageSeconds: Double? {
        switch self {
        case .usable(let snapshot): return -snapshot.fetchedAt.timeIntervalSinceNow
        case .unusable(_, let ageSeconds): return ageSeconds
        }
    }
}

/// 保存・読み込み・使える条件の判定・削除。`FavoritesStore`等と同じ
/// `.shared`シングルトンパターンだが、永続化先は`UserDefaults`ではなく
/// Cachesディレクトリの1ファイル(HQ決定: バックアップの対象外とする)。
@MainActor
final class HomeSnapshotStore {
    static let shared = HomeSnapshotStore()

    /// 保存データの形式の版。`HomeEventSummary`等の形が変わったら上げる
    /// (読み込み時に不一致なら使わず、理由を`.formatVersionMismatch`で返す)。
    private static let currentFormatVersion = 1
    /// HQ決定(2026-10-21): 取得後12時間以内のみ使える。
    static let maxAge: TimeInterval = 12 * 60 * 60

    private struct StoredSnapshot: Codable {
        let formatVersion: Int
        let snapshot: HomeSnapshot
    }

    private let fileURL: URL
    private let fileManager: FileManager

    /// `directory`はテスト用(本番は常にCachesディレクトリ)。
    init(fileManager: FileManager = .default, directory: URL? = nil) {
        self.fileManager = fileManager
        let base = directory ?? fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        self.fileURL = base.appendingPathComponent("home_snapshot.json")
    }

    /// `/home`の取得に成功したときだけ呼ぶ。失敗した応答・エラーは保存しない。
    func save(_ snapshot: HomeSnapshot) {
        let stored = StoredSnapshot(formatVersion: Self.currentFormatVersion, snapshot: snapshot)
        guard let data = try? JSONEncoder().encode(stored) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// 使える条件(すべて満たしたときだけ`.usable`): ①利用者IDが一致
    /// ②要求した`date`・`timezone`が今日・今の時間帯と一致(日付が変わったら
    /// 使わない) ③取得後12時間以内 ④保存の形式の版が一致 ⑤読み込み成功。
    func load(userID: String, requestedDate: String, requestedTimezone: String, now: Date = Date()) -> HomeSnapshotLoadResult {
        guard let data = try? Data(contentsOf: fileURL) else { return .unusable(.notFound, ageSeconds: nil) }
        guard let stored = try? JSONDecoder().decode(StoredSnapshot.self, from: data) else {
            return .unusable(.decodeFailed, ageSeconds: nil)
        }
        let snapshot = stored.snapshot
        let ageSeconds = now.timeIntervalSince(snapshot.fetchedAt)
        guard stored.formatVersion == Self.currentFormatVersion else {
            return .unusable(.formatVersionMismatch, ageSeconds: ageSeconds)
        }
        guard snapshot.userID == userID else { return .unusable(.userMismatch, ageSeconds: ageSeconds) }
        guard snapshot.requestedDate == requestedDate else { return .unusable(.dateMismatch, ageSeconds: ageSeconds) }
        guard snapshot.requestedTimezone == requestedTimezone else { return .unusable(.timezoneMismatch, ageSeconds: ageSeconds) }
        // 未来方向(端末時計が巻き戻った等)も不自然なため、0以上12時間以内のみ使える。
        guard ageSeconds >= 0, ageSeconds <= Self.maxAge else { return .unusable(.expired, ageSeconds: ageSeconds) }
        return .usable(snapshot)
    }

    /// ログアウト・アカウント削除・セッション期限切れ(ログイン画面表示)の
    /// すべてで呼ぶ。他の利用者に前の利用者の内容を見せないための削除。
    func clear() {
        try? fileManager.removeItem(at: fileURL)
    }
}
