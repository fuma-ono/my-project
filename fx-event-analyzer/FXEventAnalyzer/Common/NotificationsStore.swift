import Foundation

/// 通知一覧(ホームの通知ベル → `NotificationListView`)と、ベルの赤バッジ
/// (HQ指示 2026-10-04「通知があった場合に赤バッチがつく仕組みにして」)の
/// 元になる、端末内の通知の記録。
///
/// HQ指示(2026-10-05)で通知は端末内のローカル通知として実際に届けるように
/// なった。`LocalNotificationScheduler`が`GET /notifications/upcoming`の結果を
/// `record(_:now:)`で渡し、通知時刻(`notifyAt`)を過ぎたものが「届いた通知」
/// として一覧に並ぶ。端末の通知許可が無くても一覧には残るので、ベルから確認
/// できる。`lastReadAt`より後に届いたものがあれば未読(赤バッジ)。
@MainActor
final class NotificationsStore: ObservableObject {
    static let shared = NotificationsStore()

    /// 一覧に残す、届いた通知の上限。
    static let deliveredLimit = 50

    @Published private(set) var hasUnread: Bool = false
    /// 届いた通知と、これから届く予定の通知(`notifyAt`の昇順)。
    @Published private(set) var entries: [NotificationEntry] = []
    private(set) var lastReadAt: Date?

    private let userDefaults: UserDefaults
    private let entriesKey = "notifications.entries"
    private let lastReadKey = "notifications.lastReadAt"

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        if let data = userDefaults.data(forKey: entriesKey),
           let stored = try? JSONDecoder().decode([NotificationEntry].self, from: data) {
            entries = stored
        }
        lastReadAt = userDefaults.object(forKey: lastReadKey) as? Date
        refreshUnread()
    }

    func setUnread(_ hasUnread: Bool) {
        self.hasUnread = hasUnread
    }

    /// 最新の通知予定を取り込む。届いた通知はそのまま残し、まだ届いていない
    /// 予定は`upcoming`で置き換える(設定の変更や発表時刻の変更に追従する)。
    func record(_ upcoming: [NotificationEntry], now: Date = Date()) {
        let delivered = entries.filter { $0.notifyAt <= now }
        // 届いた指標・発言は、取り直して通知時刻がずれても(発表時刻の変更など)
        // 二重に並べない。
        let deliveredTargets = Set(delivered.map(\.targetKey))
        let merged = delivered + upcoming.filter { !deliveredTargets.contains($0.targetKey) }
        var sorted = merged.sorted { $0.notifyAt < $1.notifyAt }
        let deliveredCount = sorted.filter { $0.notifyAt <= now }.count
        if deliveredCount > Self.deliveredLimit {
            sorted.removeFirst(deliveredCount - Self.deliveredLimit)
        }
        entries = sorted
        persist()
        refreshUnread(now: now)
    }

    /// 届いた通知(新しい順)。
    func delivered(now: Date = Date()) -> [NotificationEntry] {
        entries.filter { $0.notifyAt <= now }.reversed()
    }

    func isUnread(_ entry: NotificationEntry) -> Bool {
        guard let lastReadAt else { return true }
        return entry.notifyAt > lastReadAt
    }

    /// 一覧を開いたときに呼ぶ。
    func markAllRead(now: Date = Date()) {
        lastReadAt = now
        userDefaults.set(now, forKey: lastReadKey)
        refreshUnread(now: now)
    }

    /// 時間の経過で予定が「届いた通知」に変わるので、定期的・フォアグラウンド
    /// 復帰時・通知の受信時にも呼ぶ。
    func refreshUnread(now: Date = Date()) {
        let unread = entries.contains { $0.notifyAt <= now && isUnread($0) }
        if hasUnread != unread { hasUnread = unread }
    }

    /// ログアウト・アカウント削除で、前のユーザーの通知を残さない。
    func removeAll() {
        entries = []
        lastReadAt = nil
        hasUnread = false
        userDefaults.removeObject(forKey: entriesKey)
        userDefaults.removeObject(forKey: lastReadKey)
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(entries) {
            userDefaults.set(data, forKey: entriesKey)
        }
    }
}

/// 通知1件。ローカル通知の本文と、一覧の1行を兼ねる。
struct NotificationEntry: Codable, Equatable, Identifiable {
    let kind: UpcomingNotification.Kind
    /// 指標・発言のID(一覧から詳細画面を開く)。
    let targetID: String
    let title: String
    let body: String
    let notifyAt: Date
    let scheduledAt: Date
    /// HIGH / MEDIUM / LOW
    let importance: String

    /// 同じ指標・発言でも、通知タイミングを変えると別の通知になる。
    var id: String { "\(kind.rawValue).\(targetID).\(Int(notifyAt.timeIntervalSince1970))" }
    /// 通知の対象(指標・発言)。1つの対象は一度だけ届ける。
    var targetKey: String { "\(kind.rawValue).\(targetID)" }

    init(kind: UpcomingNotification.Kind, targetID: String, title: String, body: String, notifyAt: Date, scheduledAt: Date, importance: String) {
        self.kind = kind
        self.targetID = targetID
        self.title = title
        self.body = body
        self.notifyAt = notifyAt
        self.scheduledAt = scheduledAt
        self.importance = importance
    }

    /// 「発表の5分前です（21:30発表・重要度 高）」。要人発言は「発言」。
    init(_ item: UpcomingNotification, leadMinutes: Int, timeZone: TimeZone = .current) {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = timeZone
        formatter.dateFormat = "M/d H:mm"
        let noun = item.kind == .speech ? "発言" : "発表"
        let timing = leadMinutes == 0 ? "まもなく\(noun)です" : "\(noun)の\(leadMinutes)分前です"
        let level = NotificationImportance.label(item.importance)
        var title = item.title
        if item.kind == .speech, let speaker = item.speakerName, !title.contains(speaker) {
            title = "\(speaker)：\(title)"
        }
        self.init(
            kind: item.kind,
            targetID: item.id,
            title: title,
            body: "\(timing)（\(formatter.string(from: item.scheduledAt))\(noun)・重要度 \(level)）",
            notifyAt: item.notifyAt,
            scheduledAt: item.scheduledAt,
            importance: item.importance
        )
    }
}

enum NotificationImportance {
    static func label(_ raw: String) -> String {
        switch raw {
        case "HIGH": return "高"
        case "MEDIUM": return "中"
        case "LOW": return "低"
        default: return raw
        }
    }
}
