import Combine
import Foundation

enum SettingsSectionLoadState: Equatable {
    case loading
    case backendNotConfigured
    case loaded
    case error(String)
}

enum SettingsSectionSaveState: Equatable {
    case idle
    case saving
    case saved
    case error(String)
}

/// SCR-018 / SCR-019 共通(SCR-016は`NotificationSettingsViewModel`): `GET /settings`で読み込み、画面が担当する
/// 1セクションを`draft`として編集し、`PATCH /settings`へそのセクションだけを送る。
/// HQ指示(2026-10-06)の参考画像に保存ボタンが無いため、`update(_:)`で変えると
/// 少し待ってから自動で保存する(連続した変更は1回にまとめる)。保存・読み込み
/// のたびに`AppPreferences`へ反映する。
///
/// 3画面とも読み込み〜保存の流れは同じで、違うのは編集するセクションだけな
/// ので、セクションの型で特殊化した1つのViewModelにしている。
@MainActor
final class SettingsSectionViewModel<Section: SettingsSection>: ObservableObject {
    @Published private(set) var loadState: SettingsSectionLoadState = .loading
    @Published private(set) var saveState: SettingsSectionSaveState = .idle
    /// 画面上で編集中の値。
    @Published var draft: Section = Section.defaults {
        didSet { if saveState == .saved, draft != saved { saveState = .idle } }
    }
    /// Backendに保存済みの値。
    @Published private(set) var saved: Section = Section.defaults

    private let service: SettingsService
    private let section: KeyPath<SettingsResponse, Section>
    private let makeUpdate: (Section) -> SettingsUpdate
    private let debounce: Duration
    private var autoSaveTask: Task<Void, Never>?
    /// 保存できたときの後処理(変更前, 変更後)。
    private let onSaved: ((Section, Section) -> Void)?

    init(
        apiClient: APIClient,
        section: KeyPath<SettingsResponse, Section>,
        debounce: Duration = .milliseconds(400),
        onSaved: ((Section, Section) -> Void)? = nil,
        makeUpdate: @escaping (Section) -> SettingsUpdate
    ) {
        self.service = SettingsService(apiClient: apiClient)
        self.section = section
        self.debounce = debounce
        self.onSaved = onSaved
        self.makeUpdate = makeUpdate
    }

    var hasChanges: Bool { draft != saved }
    var canSave: Bool { loadState == .loaded && hasChanges && saveState != .saving }

    func load() {
        loadState = .loading
        Task { await fetch() }
    }

    func save() {
        guard canSave else { return }
        saveState = .saving
        let sent = draft
        Task { await send(sent) }
    }

    /// 画面からの変更。少し待ってから自動で保存する。
    func update(_ change: (inout Section) -> Void) {
        guard loadState == .loaded else { return }
        var next = draft
        change(&next)
        guard next != draft else { return }
        draft = next
        scheduleAutoSave()
    }

    private func scheduleAutoSave() {
        autoSaveTask?.cancel()
        autoSaveTask = Task { [debounce] in
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled else { return }
            save()
        }
    }

    private func fetch() async {
        do {
            let settings = try await service.fetchSettings()
            AppPreferences.shared.apply(settings)
            apply(settings)
            loadState = .loaded
        } catch let error as APIError where error.isNotConfigured {
            loadState = .backendNotConfigured
        } catch {
            loadState = .error("設定の取得に失敗しました。")
        }
    }

    private func send(_ sent: Section) async {
        do {
            let response = try await service.updateSettings(makeUpdate(sent))
            AppPreferences.shared.apply(response)
            let previous = saved
            saved = response[keyPath: section]
            onSaved?(previous, saved)
            if draft == sent {
                draft = saved
            } else {
                // 送信中に次の変更が入ったら、それも続けて保存する。
                scheduleAutoSave()
            }
            saveState = .saved
        } catch APIError.server(code: .validationError, message: _, httpStatus: _) {
            saveState = .error("入力内容を保存できませんでした。値を確認してください。")
            retryPendingEdit(after: sent)
        } catch {
            saveState = .error("保存に失敗しました。もう一度お試しください。")
            retryPendingEdit(after: sent)
        }
    }

    /// 保存の失敗中に次の変更が入っていたら、その変更を保存し直す(一度だけ。
    /// 同じ内容でまた失敗したら、ここでは繰り返さない)。
    private func retryPendingEdit(after sent: Section) {
        if draft != sent { scheduleAutoSave() }
    }

    private func apply(_ response: SettingsResponse) {
        saved = response[keyPath: section]
        draft = saved
    }
}

extension SettingsSectionViewModel where Section == DisplaySettings {
    convenience init(apiClient: APIClient) {
        self.init(
            apiClient: apiClient,
            section: \.display,
            // 通知しない時間帯と通知の本文の時刻はタイムゾーンに従うので、
            // タイムゾーンを変えたら通知を予約し直す。
            onSaved: { previous, saved in
                guard previous.timezone != saved.timezone else { return }
                Task { await LocalNotificationScheduler(apiClient: apiClient).refresh() }
            }
        ) { SettingsUpdate(display: $0) }
    }
}

extension SettingsSectionViewModel where Section == ChartSettings {
    convenience init(apiClient: APIClient) {
        self.init(apiClient: apiClient, section: \.chart) { SettingsUpdate(chart: $0) }
    }
}
