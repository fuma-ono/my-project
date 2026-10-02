import SwiftUI

/// SCR-018 通知設定(ui-screens.md v2.0 §3、api-design.md §24.4)。
///
/// HQ確定(2026-10-02): MVPでは通知対象の保存のみ行い、Push通知は送らない。
/// 重要度★と指標のLOW/MEDIUM/HIGHの対応は暫定マッピング(db-design.md §3.14)
/// のため画面には出していない。正式なUI画像の受領前の暫定レイアウト。
struct NotificationSettingsView: View {
    @StateObject private var viewModel: SettingsSectionViewModel<NotificationSettings>
    @Binding var tabSelection: Int

    init(apiClient: APIClient, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: SettingsSectionViewModel<NotificationSettings>(apiClient: apiClient))
        _tabSelection = tabSelection
    }

    var body: some View {
        SettingsSectionScaffold(title: "通知設定", viewModel: viewModel, tabSelection: $tabSelection, saveButtonY: 290) {
            SettingsCaption(text: "通知の種類").position(x: 117, y: 74)
            SettingsToggleRow(icon: "clock", title: "重要指標の発表前通知", isOn: $viewModel.draft.preRelease)
                .position(x: 117, y: 94)
            SettingsToggleRow(icon: "chart.bar", title: "重要指標の結果通知", isOn: $viewModel.draft.result)
                .position(x: 117, y: 128)
            SettingsToggleRow(icon: "star", title: "お気に入りイベント通知", isOn: $viewModel.draft.favorites)
                .position(x: 117, y: 162)

            SettingsCaption(text: "通知する重要度").position(x: 117, y: 194)
            SettingsFormRow(icon: "exclamationmark.circle", title: "★\(viewModel.draft.minImportance)以上") {
                SettingsStarPicker(minimum: $viewModel.draft.minImportance)
            }
            .position(x: 117, y: 214)

            SettingsNote(text: "選択した重要度以上の指標が通知の対象になります。\n※現在は設定の保存のみ行います。プッシュ通知は今後のアップデートで対応予定です。")
                .position(x: 117, y: 248)
        }
    }
}
