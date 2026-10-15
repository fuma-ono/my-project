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
///
/// HQ指示(2026-10-13)の通知仕様(docs/projects/fx-event-analyzer/notification-inbox-spec.md):
/// - 既読は1件ずつ(行を開いたとき)と「すべて既読」。画面を開いただけでは既読にしない。
/// - 種類ごとの保存期間(`NotificationEntry.Kind.retentionDays`)を過ぎた通知は一覧から外す。
///   既読にしても保存期間内は残す。
/// - 同じイベント・同じ通知の種類(「発表5分前」と「発表時」は別の種類)は1件だけ残す(`targetKey`)。
/// - 端末のプッシュ通知(通知センター)とは別に持つので、プッシュを消しても既読・保存には影響しない。
@MainActor
final class NotificationsStore: ObservableObject {
    static let shared = NotificationsStore()

    /// 一覧に残す、届いた通知の上限(保存期間とは別の、端末の容量のための上限)。
    static let deliveredLimit = 200

    @Published private(set) var hasUnread: Bool = false
    /// 届いた通知と、これから届く予定の通知(`notifyAt`の昇順)。
    @Published private(set) var entries: [NotificationEntry] = []
    private(set) var lastReadAt: Date?
    /// 1件ずつ既読にした通知(`NotificationEntry.id`)。
    private(set) var readIDs: Set<String> = []

    private let userDefaults: UserDefaults
    private let entriesKey = "notifications.entries"
    private let lastReadKey = "notifications.lastReadAt"
    private let readIDsKey = "notifications.readIDs"

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        if let data = userDefaults.data(forKey: entriesKey),
           let stored = try? JSONDecoder().decode([NotificationEntry].self, from: data) {
            entries = stored
        }
        lastReadAt = userDefaults.object(forKey: lastReadKey) as? Date
        readIDs = Set(userDefaults.stringArray(forKey: readIDsKey) ?? [])
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
        entries = sorted.filter { !$0.isExpired(now: now) }
        persist()
        refreshUnread(now: now)
    }

    /// サーバーの通知一覧(既読・保存期間はサーバーが管理)で、届いた経済指標・要人発言を置き換える。
    /// これから届く予定の通知と、端末だけのシステム通知はそのまま残す。
    func applyInbox(_ items: [InboxNotification], now: Date = Date()) {
        let server = items.compactMap { NotificationEntry($0) }
        let serverKeys = Set(server.map(\.targetKey))
        let kept = entries.filter { entry in
            if entry.notifyAt > now { return !serverKeys.contains(entry.targetKey) }
            return entry.kind == .system && entry.serverID == nil && !serverKeys.contains(entry.targetKey)
        }
        entries = (kept + server).sorted { $0.notifyAt < $1.notifyAt }
        for item in items {
            guard let entry = server.first(where: { $0.serverID == item.id }) else { continue }
            if item.readAt != nil { readIDs.insert(entry.id) }
        }
        userDefaults.set(Array(readIDs), forKey: readIDsKey)
        persist()
        objectWillChange.send()
        refreshUnread(now: now)
    }

    /// 保存期間を過ぎた通知を外す(アプリを開いたとき・一覧を開いたとき)。
    func pruneExpired(now: Date = Date()) {
        let kept = entries.filter { !$0.isExpired(now: now) }
        guard kept.count != entries.count else { return }
        entries = kept
        readIDs.formIntersection(kept.map(\.id))
        persist()
        refreshUnread(now: now)
    }

    /// アプリ内の出来事(通知設定の保存など)を、届いた通知として一覧に残す。
    /// 同じ`targetID`の前の記録は置き換える(続けて保存しても1件にまとめる)。
    func recordSystem(targetID: String, title: String, body: String, now: Date = Date()) {
        let item = NotificationEntry(kind: .system, targetID: targetID, title: title, body: body, notifyAt: now, scheduledAt: now, importance: "LOW")
        entries.removeAll { $0.targetKey == item.targetKey }
        entries.append(item)
        entries.sort { $0.notifyAt < $1.notifyAt }
        persist()
        refreshUnread(now: now)
    }

    /// まだ届いていない予定だけを消す(プッシュ通知をオフにしたとき)。
    func removeUpcoming(now: Date = Date()) {
        entries.removeAll { $0.notifyAt > now }
        persist()
    }

    /// 届いた通知(新しい順)。
    func delivered(now: Date = Date()) -> [NotificationEntry] {
        entries.filter { $0.notifyAt <= now && !$0.isExpired(now: now) }.reversed()
    }

    /// 届いた通知のうち未読の件数。
    func unreadCount(now: Date = Date()) -> Int {
        delivered(now: now).filter { isUnread($0) }.count
    }

    func isUnread(_ entry: NotificationEntry) -> Bool {
        if readIDs.contains(entry.id) { return false }
        guard let lastReadAt else { return true }
        return entry.notifyAt > lastReadAt
    }

    /// 1件だけ既読にする(一覧の行を開いたとき)。
    func markRead(_ entry: NotificationEntry, now: Date = Date()) {
        guard isUnread(entry) else { return }
        readIDs.insert(entry.id)
        userDefaults.set(Array(readIDs), forKey: readIDsKey)
        objectWillChange.send()
        refreshUnread(now: now)
    }

    /// 一覧を開いたときに呼ぶ。
    func markAllRead(now: Date = Date()) {
        lastReadAt = now
        userDefaults.set(now, forKey: lastReadKey)
        // `lastReadAt`より前のものは全部既読になるので、1件ずつの記録は要らない。
        readIDs = []
        userDefaults.removeObject(forKey: readIDsKey)
        objectWillChange.send()
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
        readIDs = []
        hasUnread = false
        userDefaults.removeObject(forKey: readIDsKey)
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
    /// 一覧の絞り込み(すべて/経済指標/要人発言/システム)の単位。
    enum Kind: String, Codable, CaseIterable {
        case indicator = "INDICATOR"
        case speech = "SPEECH"
        /// アプリ内の出来事(通知設定の更新など)。ローカル通知は出さない。
        case system = "SYSTEM"
        /// レートアラート(指定した価格を上回った・下回った)。サーバーの通知一覧から来る(HQ指示 2026-10-15)。
        case rateAlert = "RATE_ALERT"
        /// カレンダー更新(発表日時の変更・中止)。サーバーの通知一覧から来る(HQ指示 2026-10-15)。
        case calendarUpdate = "CALENDAR_UPDATE"

        init(_ kind: UpcomingNotification.Kind) {
            switch kind {
            case .indicator: self = .indicator
            case .speech: self = .speech
            }
        }

        var label: String {
            switch self {
            case .indicator: return "経済指標"
            case .speech: return "要人発言"
            case .system: return "システム"
            case .rateAlert: return "レート"
            case .calendarUpdate: return "カレンダー"
            }
        }

        /// 保存期間(日)。HQ指示(2026-10-13)の初期案。レートアラート・カレンダー更新(7日)は
        /// 通知自体がまだ無いので、足すときにここへ加える。
        var retentionDays: Int {
            switch self {
            case .indicator, .speech, .system: return 30
            case .rateAlert, .calendarUpdate: return 7
            }
        }
    }

    let kind: Kind
    /// 指標・発言のID(一覧から詳細画面を開く)。
    let targetID: String
    let title: String
    let body: String
    let notifyAt: Date
    let scheduledAt: Date
    /// HIGH / MEDIUM / LOW
    let importance: String
    /// 一覧の表示用(以前の記録には無いので任意)。要人発言の発言者、
    /// 指標・発言の名前(`title`は発言者付き)、国コード。
    var speakerName: String?
    var subject: String?
    var countryCode: String?
    /// 通知の種類(発表の何分前か。0は発表時)。同じイベントでも種類が違えば別の通知として残す。
    /// 古い記録と、種類の無いシステム通知はnil。
    var leadMinutes: Int?
    /// サーバーの通知一覧から来たものはそのID(既読をサーバーへ送るのに使う)。端末だけの記録はnil。
    var serverID: String?

    var id: String { "\(kind.rawValue).\(targetID).\(Int(notifyAt.timeIntervalSince1970))" }
    /// 重複を防ぐ単位(同じイベント・同じ通知の種類で1件)。
    var targetKey: String {
        leadMinutes.map { "\(kind.rawValue).\(targetID).\($0)" } ?? "\(kind.rawValue).\(targetID)"
    }

    func isExpired(now: Date) -> Bool {
        now.timeIntervalSince(notifyAt) > Double(kind.retentionDays) * 24 * 60 * 60
    }

    init(
        kind: Kind, targetID: String, title: String, body: String, notifyAt: Date, scheduledAt: Date, importance: String,
        speakerName: String? = nil, subject: String? = nil, countryCode: String? = nil, leadMinutes: Int? = nil
    ) {
        self.kind = kind
        self.leadMinutes = leadMinutes
        self.speakerName = speakerName
        self.subject = subject
        self.countryCode = countryCode
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
        // HQ指示(2026-10-13)「通知の名前も消費者物価指数（CPI）にそろえて」: 指標は全画面共通の表示名にする。
        let subject = item.kind == .indicator
            ? CountryFlag.indicatorDisplayText(item.title, countryCode: item.countryCode ?? "", displayName: item.displayName)
            : item.title
        var title = subject
        if item.kind == .speech, let speaker = item.speakerName, !title.contains(speaker) {
            title = "\(speaker)：\(title)"
        }
        self.init(
            kind: Kind(item.kind),
            targetID: item.id,
            title: title,
            body: "\(timing)（\(formatter.string(from: item.scheduledAt))\(noun)・重要度 \(level)）",
            notifyAt: item.notifyAt,
            scheduledAt: item.scheduledAt,
            importance: item.importance,
            speakerName: item.speakerName,
            subject: subject,
            countryCode: item.countryCode,
            leadMinutes: leadMinutes
        )
    }

    /// サーバーの通知一覧(`GET /notifications`)の1件から作る。アプリで扱わない種類はnil。
    init?(_ item: InboxNotification) {
        let kind: Kind
        switch item.kind {
        case "INDICATOR": kind = .indicator
        case "SPEECH": kind = .speech
        case "SYSTEM": kind = .system
        case "RATE_ALERT": kind = .rateAlert
        case "CALENDAR_UPDATE": kind = .calendarUpdate
        default: return nil
        }
        let subject = kind == .indicator
            ? CountryFlag.indicatorDisplayText(item.title, countryCode: item.countryCode ?? "", displayName: item.displayName)
            : item.title
        self.init(
            kind: kind,
            targetID: item.targetId,
            title: subject,
            body: item.body ?? "",
            notifyAt: item.notifyAt,
            scheduledAt: item.scheduledAt ?? item.notifyAt,
            importance: item.importance ?? "LOW",
            speakerName: item.speakerName,
            subject: subject,
            countryCode: item.countryCode,
            leadMinutes: item.leadMinutes
        )
        serverID = item.id
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
