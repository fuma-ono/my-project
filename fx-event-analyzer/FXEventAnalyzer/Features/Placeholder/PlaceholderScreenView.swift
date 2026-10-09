import SwiftUI

/// HQ承認(2-b, 2026-09-29): まだ実装していない画面(ui-screens.md v2.0の新規17
/// 画面)向けの、遷移確認専用の仮画面。
///
/// 「仮画面は完成扱いにしないこと」というHQ指示を満たすため、既存の実装済み画面
/// が使うV5デザイン言語(`V5Viewport`/`V5P`配色/`V5Card`等)を意図的に使わず、
/// システム標準の色・コンポーネントのみで構成し、実装済み画面と一目で区別できる
/// ようにしている。ビジュアルデザインはここでは独自に定義しない — 正式なUIは
/// 別途HQが画面ごとに提供するデザイン仕様に基づき、後続フェーズで実装する。
struct PlaceholderScreenView: View {
    let scrNumber: String
    let screenName: String
    var detail: String?

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "hammer.fill")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text(scrNumber)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(screenName)
                .font(.title2.bold())
                .multilineTextAlignment(.center)
            if let detail {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Text("この画面は遷移確認用の仮画面です。\n正式なUIはデザイン仕様確定後に実装します。")
                .font(.footnote)
                .foregroundStyle(.orange)
                .multilineTextAlignment(.center)
                .padding(.top, 4)
            Spacer()
            Spacer()
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

/// `SettingsSubRoute`(SCR-016〜024)を解決する。`AppRouteDestinationView`
/// と同じ役割の、設定配下サブ画面専用の解決ビュー。実装済みの画面は実画面へ、
/// 未実装の画面は仮画面へ振り分ける。
struct SettingsSubRouteDestinationView: View {
    let route: SettingsSubRoute
    let apiClient: APIClient
    @Binding var tabSelection: Int

    var body: some View {
        switch route {
        case .notificationSettings:
            NotificationSettingsView(apiClient: apiClient, tabSelection: $tabSelection)
        case .displaySettings:
            DisplaySettingsView(apiClient: apiClient, tabSelection: $tabSelection)
        case .subscriptionManagement:
            SubscriptionManagementView(apiClient: apiClient, tabSelection: $tabSelection)
        case .help:
            HelpView(apiClient: apiClient, tabSelection: $tabSelection)
        case .terms:
            LegalDocumentView(document: LegalDocuments.terms, tabSelection: $tabSelection)
        case .privacyPolicy:
            LegalDocumentView(document: LegalDocuments.privacy, tabSelection: $tabSelection)
        case .appInfo:
            AppInfoView(tabSelection: $tabSelection)
        case .accountDeletion:
            PlaceholderScreenView(scrNumber: route.scrNumber, screenName: route.title)
                .navigationTitle(route.title)
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}
