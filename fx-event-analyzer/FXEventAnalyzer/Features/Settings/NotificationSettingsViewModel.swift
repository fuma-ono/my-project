import Foundation

/// SCR-016 通知設定。参考画像(HQ指示 2026-10-05)に保存ボタンが無いため、
/// 変更のたびに少し待ってから`PATCH /settings`へ`notifications`だけを送る
/// (連続したタップは1回にまとめる)。保存できたら通知の予約をやり直す。
@MainActor
final class NotificationSettingsViewModel: ObservableObject {
    @Published private(set) var loadState: SettingsSectionLoadState = .loading
    @Published private(set) var saveState: SettingsSectionSaveState = .idle
    @Published private(set) var settings: NotificationSettings = .defaults
    @Published private(set) var fxPairSymbols: [String] = StaticFXPairCatalog.seededSymbols
    /// 端末の通知が許可されていない(届かない)ことを画面で知らせる。
    @Published private(set) var authorizationDenied = false

    private let service: SettingsService
    private let catalog: FXPairCatalog
    private let scheduler: LocalNotificationScheduling
    private let debounce: Duration
    private var saveTask: Task<Void, Never>?
    /// 送信中に次の変更が入ったら、古い応答で画面を戻さない。
    private var revision = 0
    private let store: NotificationsStore
    private let plan: PlanStore

    init(
        apiClient: APIClient,
        scheduler: LocalNotificationScheduling? = nil,
        catalog: FXPairCatalog? = nil,
        debounce: Duration = .milliseconds(400),
        store: NotificationsStore? = nil,
        plan: PlanStore? = nil
    ) {
        self.store = store ?? .shared
        self.plan = plan ?? .shared
        self.service = SettingsService(apiClient: apiClient)
        self.catalog = catalog ?? RemoteFXPairCatalog(apiClient: apiClient)
        self.scheduler = scheduler ?? LocalNotificationScheduler(apiClient: apiClient)
        self.debounce = debounce
    }

    func load() {
        loadState = .loading
        Task {
            do {
                settings = try await service.fetchSettings().notifications
                // 無料プランで使えない重要度・通貨ペアが残っていたら(プレミアムを
                // やめたときなど)、使える範囲にそろえて表示する。Backendも通知の
                // 対象を同じ範囲で絞る(api-design v1.15)。
                settings = Self.fitted(settings, to: plan.limits, defaultPair: fxPairSymbols.first ?? "USDJPY")
                loadState = .loaded
            } catch let error as APIError where error.isNotConfigured {
                loadState = .backendNotConfigured
                return
            } catch {
                loadState = .error("設定の取得に失敗しました。")
                return
            }
            if let symbols = try? await catalog.availableSymbols(), !symbols.isEmpty {
                fxPairSymbols = symbols
            }
            if settings.push {
                authorizationDenied = await scheduler.isAuthorizationDenied()
            }
        }
    }

    /// 端末の設定アプリから戻ったとき、通知の許可の状態を見直す。
    func recheckAuthorization() {
        guard loadState == .loaded, settings.push else { return }
        Task { authorizationDenied = await scheduler.isAuthorizationDenied() }
    }

    func update(_ change: (inout NotificationSettings) -> Void) {
        guard loadState == .loaded else { return }
        let wasPushOn = settings.push
        var next = settings
        change(&next)
        guard next != settings else { return }
        settings = next
        if !wasPushOn, next.push {
            Task {
                let granted = await scheduler.requestAuthorization()
                // 許可を待つ間にプッシュ通知をまたオフにしていたら、注意書きは出さない。
                if settings.push { authorizationDenied = !granted }
            }
        } else if !next.push {
            authorizationDenied = false
        }
        scheduleSave()
    }

    // MARK: - 個別の操作

    func setPush(_ isOn: Bool) { update { $0.push = isOn } }
    func setIndicators(_ isOn: Bool) { update { $0.indicators = isOn } }
    func setSpeeches(_ isOn: Bool) { update { $0.speeches = isOn } }

    /// 空(すべて外した)は「すべての通貨ペア」として扱う。
    // MARK: - 無料プランの範囲(HQ指示 2026-10-08)

    /// 無料プランで選べない重要度か(無料はHIGHだけ)。
    func isLocked(importance: String) -> Bool {
        !plan.limits.notificationImportances.contains(importance)
    }

    /// 「すべての通貨ペア」は上限のあるプランでは選べない。
    var isAllPairsLocked: Bool { plan.limits.notificationFxPairsMax != nil }

    /// 通貨ペアの行のタップ。上限1なら選び直し(1つだけ)、上限なしなら複数選べる。
    func tapFxPair(_ symbol: String) {
        if plan.limits.notificationFxPairsMax == 1 {
            setFxPairs([symbol])
            return
        }
        var next = settings.fxPairs ?? []
        if let index = next.firstIndex(of: symbol) {
            next.remove(at: index)
        } else {
            if let max = plan.limits.notificationFxPairsMax, next.count >= max { return }
            next.append(symbol)
        }
        setFxPairs(next)
    }

    static func fitted(_ settings: NotificationSettings, to limits: PlanLimits, defaultPair: String) -> NotificationSettings {
        var next = settings
        let allowed = limits.notificationImportances
        let importances = next.importances.filter(allowed.contains)
        next.importances = importances.isEmpty ? NotificationSettings.importanceOrder.filter(allowed.contains) : importances
        if let max = limits.notificationFxPairsMax {
            let pairs = next.fxPairs ?? [defaultPair]
            next.fxPairs = Array((pairs.isEmpty ? [defaultPair] : pairs).prefix(max))
        }
        return next
    }

    func setFxPairs(_ symbols: [String]?) {
        update { settings in
            guard let symbols, !symbols.isEmpty else { settings.fxPairs = nil; return }
            settings.fxPairs = fxPairSymbols.filter { symbols.contains($0) } + symbols.filter { !fxPairSymbols.contains($0) }
        }
    }

    /// 重要度は最低1つ残す。
    func toggleImportance(_ importance: String) {
        update { settings in
            var set = Set(settings.importances)
            if isLocked(importance: importance), !set.contains(importance) { return }
            if set.contains(importance) {
                guard set.count > 1 else { return }
                set.remove(importance)
            } else {
                set.insert(importance)
            }
            settings.importances = NotificationSettings.importanceOrder.filter { set.contains($0) }
        }
    }

    func setLeadMinutes(_ minutes: Int) { update { $0.leadMinutes = minutes } }
    func setQuietHours(_ isOn: Bool) { update { $0.quietHoursEnabled = isOn } }
    func setQuietStart(_ time: String) { update { $0.quietStart = time } }
    func setQuietEnd(_ time: String) { update { $0.quietEnd = time } }

    // MARK: - 表示

    var fxPairsLabel: String {
        guard let pairs = settings.fxPairs, !pairs.isEmpty else { return "すべての通貨ペア" }
        let names = pairs.map(FXPairSymbol.displayName)
        return names.count <= 2 ? names.joined(separator: "・") : "\(names[0]) ほか\(names.count - 1)件"
    }

    var importancesLabel: String {
        settings.importances.map(NotificationImportance.label).joined(separator: "・")
    }

    static func leadLabel(_ minutes: Int) -> String {
        minutes == 0 ? "発表時" : "発表の\(minutes)分前"
    }

    /// "07:00" → "7:00"
    static func timeLabel(_ time: String) -> String {
        time.hasPrefix("0") && time.count == 5 ? String(time.dropFirst()) : time
    }

    // MARK: - 保存

    private func scheduleSave() {
        revision += 1
        let target = revision
        let update = SettingsUpdate(notifications: settings)
        saveState = .saving
        saveTask?.cancel()
        saveTask = Task { [debounce] in
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled else { return }
            await send(update, revision: target)
        }
    }

    private func send(_ update: SettingsUpdate, revision target: Int) async {
        do {
            let response = try await service.updateSettings(update)
            guard target == revision else { return }
            settings = response.notifications
            saveState = .saved
            // 参考画像(HQ指示 2026-10-06)の「システム」通知。
            store.recordSystem(targetID: "notification-settings", title: "通知設定を更新しました", body: "通知の設定が正常に変更されました。")
            if !settings.push {
                // 予定の取り直しに失敗しても、オフにした後に通知が届かないよう先に消す。
                await scheduler.removeUpcoming()
            }
            await scheduler.refresh()
        } catch {
            guard target == revision else { return }
            saveState = .error("保存に失敗しました。通信環境を確認してください。")
        }
    }
}
