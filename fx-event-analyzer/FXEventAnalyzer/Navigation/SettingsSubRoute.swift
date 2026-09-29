import Foundation

/// SCR-016 設定配下の未実装サブ画面(SCR-018〜SCR-026)、ui-screens.md v2.0 §3。
/// いずれも2026-09-29 HQ承認(2-b)時点では仮画面のみで、実データもUI仕様も持たない。
///
/// `AppRoute`とは別のenumに分離しているのは、これらを`AppRoute`に混ぜると画面
/// グループの異なるケースが一つの巨大なenumに積み上がってしまうため(2026-09-29
/// HQ承認: 「AppRouteを29画面分の巨大なenumにすることを前提とせず、必要に応じて
/// 画面グループごとにルートを整理すること」)。SCR番号+画面名だけで表現できる、
/// パラメータを運ばない単純なケースのみここに置く。
enum SettingsSubRoute: String, CaseIterable, Hashable {
    case notificationSettings   // SCR-018 通知設定
    case subscriptionManagement // SCR-019 プラン・購読管理
    case displaySettings        // SCR-020 表示・地域設定
    case chartSettings          // SCR-021 チャート設定
    case help                   // SCR-022 ヘルプ・お問い合わせ
    case terms                  // SCR-023 利用規約
    case privacyPolicy          // SCR-024 プライバシーポリシー
    case appInfo                // SCR-025 アプリ情報
    case accountDeletion        // SCR-026 アカウント削除

    var scrNumber: String {
        switch self {
        case .notificationSettings: return "SCR-018"
        case .subscriptionManagement: return "SCR-019"
        case .displaySettings: return "SCR-020"
        case .chartSettings: return "SCR-021"
        case .help: return "SCR-022"
        case .terms: return "SCR-023"
        case .privacyPolicy: return "SCR-024"
        case .appInfo: return "SCR-025"
        case .accountDeletion: return "SCR-026"
        }
    }

    var title: String {
        switch self {
        case .notificationSettings: return "通知設定"
        case .subscriptionManagement: return "プラン・購読管理"
        case .displaySettings: return "表示・地域設定"
        case .chartSettings: return "チャート設定"
        case .help: return "ヘルプ・お問い合わせ"
        case .terms: return "利用規約"
        case .privacyPolicy: return "プライバシーポリシー"
        case .appInfo: return "アプリ情報"
        case .accountDeletion: return "アカウント削除"
        }
    }
}
