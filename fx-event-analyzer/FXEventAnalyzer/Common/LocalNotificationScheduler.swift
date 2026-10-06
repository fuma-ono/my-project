import BackgroundTasks
import Foundation
import UserNotifications

/// `UNUserNotificationCenter`のうち、スケジューラーが使う部分。テストでは
/// 実際の通知センターの代わりに差し替える。
protocol UserNotificationCentering: AnyObject {
    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool
    func authorizationStatus() async -> UNAuthorizationStatus
    func pendingNotificationRequests() async -> [UNNotificationRequest]
    func removePendingNotificationRequests(withIdentifiers identifiers: [String])
    func add(_ request: UNNotificationRequest) async throws
}

extension UNUserNotificationCenter: UserNotificationCentering {
    func authorizationStatus() async -> UNAuthorizationStatus {
        await notificationSettings().authorizationStatus
    }
}

@MainActor
protocol LocalNotificationScheduling: AnyObject {
    /// 端末の通知許可を求める。許可済みならダイアログを出さずにtrue。
    func requestAuthorization() async -> Bool
    /// 端末の通知許可が拒否されているか(設定画面の注意書き用)。
    func isAuthorizationDenied() async -> Bool
    /// 通知予定を取り直して、端末のローカル通知を予約し直す。
    func refresh() async
}

/// HQ指示(2026-10-05)「通知の設定画面を…機能も一緒に作成して」。
///
/// 通知はプッシュサーバーを使わず、端末内のローカル通知で届ける(APNsの
/// 鍵をアプリにもサーバーにも持たせずに済む)。Backendが通知設定の条件で
/// 絞った`GET /notifications/upcoming`をもとに、通知時刻の
/// `UNCalendarNotificationTrigger`を予約する。アプリを開いたとき・
/// フォアグラウンドに戻ったとき・通知設定を保存したときに予約し直すので、
/// 発表時刻や設定の変更にも追従する。
///
/// 端末の通知許可が無い場合も、予定は`NotificationsStore`に記録するので、
/// 時刻を過ぎればホームの通知ベルの一覧には並ぶ。
@MainActor
final class LocalNotificationScheduler: LocalNotificationScheduling {
    static let identifierPrefix = "fxea.upcoming."
    /// iOSが1アプリに許すローカル通知の予約は64件まで。
    static let maxPendingRequests = 60

    private let service: NotificationService
    private let center: UserNotificationCentering
    private let store: NotificationsStore
    private let now: () -> Date
    private var isRefreshing = false

    init(
        apiClient: APIClient,
        center: UserNotificationCentering = UNUserNotificationCenter.current(),
        store: NotificationsStore = .shared,
        now: @escaping () -> Date = { Date() }
    ) {
        self.service = NotificationService(apiClient: apiClient)
        self.center = center
        self.store = store
        self.now = now
    }

    func requestAuthorization() async -> Bool {
        switch await center.authorizationStatus() {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied:
            return false
        case .notDetermined:
            return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        @unknown default:
            return false
        }
    }

    func isAuthorizationDenied() async -> Bool {
        await center.authorizationStatus() == .denied
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        let response: UpcomingNotificationsResponse
        do {
            response = try await service.fetchUpcoming()
        } catch {
            // 通信できないときは前回の予約をそのまま残す。
            store.refreshUnread(now: now())
            return
        }
        let current = now()
        let entries = response.items.map { NotificationEntry($0, leadMinutes: response.leadMinutes) }
        store.record(entries, now: current)

        let ours = await center.pendingNotificationRequests()
            .map(\.identifier)
            .filter { $0.hasPrefix(Self.identifierPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: ours)

        switch await center.authorizationStatus() {
        case .authorized, .provisional, .ephemeral: break
        default: return
        }
        // 記録に残った今後の分だけを予約する(既に届いた対象は除かれている)。
        for entry in store.entries.filter({ $0.notifyAt > current && $0.kind != .system }).prefix(Self.maxPendingRequests) {
            try? await center.add(Self.request(for: entry))
        }
    }

    /// ログアウト・アカウント削除で、予約と記録を消す。
    func reset() {
        store.removeAll()
        Task {
            let ours = await center.pendingNotificationRequests()
                .map(\.identifier)
                .filter { $0.hasPrefix(Self.identifierPrefix) }
            center.removePendingNotificationRequests(withIdentifiers: ours)
        }
    }

    static func request(for entry: NotificationEntry, calendar: Calendar = .current) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = entry.title
        content.body = entry.body
        content.sound = .default
        content.userInfo = ["kind": entry.kind.rawValue, "id": entry.targetID]
        let components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: entry.notifyAt)
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        return UNNotificationRequest(identifier: identifierPrefix + entry.id, content: content, trigger: trigger)
    }
}

/// アプリを開かない間も通知の予約を取り直す(HQ指示 2026-10-06「バックグラウンド
/// 更新を入れて」)。予約はアプリを開いたときにしか更新されず、何日も開かないと
/// 新しく追加された指標が通知されなかった。iOSが空き時間に起こしてくれる
/// `BGAppRefreshTask`で`refresh()`を呼ぶ(実行の頻度・時刻はiOSが決める)。
enum NotificationBackgroundRefresh {
    /// `project.yml`の`BGTaskSchedulerPermittedIdentifiers`と同じ値。
    static let identifier = "com.fumaono.fxeventanalyzer.notification-refresh"
    /// 次に起こしてもらう最短の間隔。
    static let interval: TimeInterval = 3 * 60 * 60

    /// アプリの起動処理中(`App.init`)に一度だけ呼ぶ。
    static func register(apiClient: APIClient) {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            // 次の回も予約しておく(1回ごとの予約しかできない)。
            schedule()
            let work = Task { @MainActor in
                await LocalNotificationScheduler(apiClient: apiClient).refresh()
                task.setTaskCompleted(success: !Task.isCancelled)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    /// アプリが裏に回ったときに呼ぶ。
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: interval)
        try? BGTaskScheduler.shared.submit(request)
    }
}

/// アプリを開いているときにも通知をバナーで出し、届いた通知を一覧の
/// 未読に反映する。
final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationPresenter()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        await MainActor.run { NotificationsStore.shared.refreshUnread() }
        return [.banner, .list, .sound]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        await MainActor.run { NotificationsStore.shared.refreshUnread() }
    }
}
