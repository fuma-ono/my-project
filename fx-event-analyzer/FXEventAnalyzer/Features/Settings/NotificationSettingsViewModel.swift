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

    init(
        apiClient: APIClient,
        scheduler: LocalNotificationScheduling? = nil,
        catalog: FXPairCatalog? = nil,
        debounce: Duration = .milliseconds(400)
    ) {
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

    func update(_ change: (inout NotificationSettings) -> Void) {
        guard loadState == .loaded else { return }
        let wasPushOn = settings.push
        var next = settings
        change(&next)
        guard next != settings else { return }
        settings = next
        if !wasPushOn, next.push {
            Task { authorizationDenied = !(await scheduler.requestAuthorization()) }
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

    // MARK: - 表示

    /// 行の右端は幅が狭いので短く出す(「すべて」「USD/JPY」「3ペア」)。
    var fxPairsLabel: String {
        guard let pairs = settings.fxPairs, !pairs.isEmpty else { return "すべて" }
        return pairs.count == 1 ? FXPairSymbol.displayName(pairs[0]) : "\(pairs.count)ペア"
    }

    var importancesLabel: String {
        settings.importances.map(NotificationImportance.label).joined(separator: "・")
    }

    static func leadLabel(_ minutes: Int) -> String {
        minutes == 0 ? "発表時" : "発表の\(minutes)分前"
    }

    /// 行の右端用(「5分前」)。
    static func shortLeadLabel(_ minutes: Int) -> String {
        minutes == 0 ? "発表時" : "\(minutes)分前"
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
            await scheduler.refresh()
        } catch {
            guard target == revision else { return }
            saveState = .error("保存に失敗しました。通信環境を確認してください。")
        }
    }
}
