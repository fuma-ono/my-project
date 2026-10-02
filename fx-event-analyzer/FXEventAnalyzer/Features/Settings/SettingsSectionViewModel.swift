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

/// SCR-018 / SCR-020 / SCR-021 共通: `GET /settings`で読み込み、画面が担当する
/// 1セクションを`draft`として編集し、「保存する」で`PATCH /settings`へその
/// セクションだけを送る(ui-screens.md: 保存後は同じ画面に留まる)。
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

    init(apiClient: APIClient, section: KeyPath<SettingsResponse, Section>, makeUpdate: @escaping (Section) -> SettingsUpdate) {
        self.service = SettingsService(apiClient: apiClient)
        self.section = section
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
        let update = makeUpdate(draft)
        Task { await send(update) }
    }

    private func fetch() async {
        do {
            apply(try await service.fetchSettings())
            loadState = .loaded
        } catch let error as APIError where error.isNotConfigured {
            loadState = .backendNotConfigured
        } catch {
            loadState = .error("設定の取得に失敗しました。")
        }
    }

    private func send(_ update: SettingsUpdate) async {
        do {
            apply(try await service.updateSettings(update))
            saveState = .saved
        } catch APIError.server(code: .validationError, message: _, httpStatus: _) {
            saveState = .error("入力内容を保存できませんでした。値を確認してください。")
        } catch {
            saveState = .error("保存に失敗しました。もう一度お試しください。")
        }
    }

    private func apply(_ response: SettingsResponse) {
        saved = response[keyPath: section]
        draft = saved
    }
}

extension SettingsSectionViewModel where Section == NotificationSettings {
    convenience init(apiClient: APIClient) {
        self.init(apiClient: apiClient, section: \.notifications) { SettingsUpdate(notifications: $0) }
    }
}

extension SettingsSectionViewModel where Section == DisplaySettings {
    convenience init(apiClient: APIClient) {
        self.init(apiClient: apiClient, section: \.display) { SettingsUpdate(display: $0) }
    }
}

extension SettingsSectionViewModel where Section == ChartSettings {
    convenience init(apiClient: APIClient) {
        self.init(apiClient: apiClient, section: \.chart) { SettingsUpdate(chart: $0) }
    }
}
