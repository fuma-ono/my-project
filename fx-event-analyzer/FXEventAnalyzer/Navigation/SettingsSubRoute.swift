import Foundation

/// SCR-014 設定配下の未実装サブ画面(SCR-016〜SCR-024)。HQ指示(2026-10-03、
/// 画面構成全面更新)の新27画面番号に合わせて更新(旧SCR-018〜026から-2)。
/// いずれも仮画面のみで、実データもUI仕様も持たない。
///
/// `AppRoute`とは別のenumに分離しているのは、これらを`AppRoute`に混ぜると画面
/// グループの異なるケースが一つの巨大なenumに積み上がってしまうため(2026-09-29
/// HQ承認: 「AppRouteを巨大なenumにすることを前提とせず、必要に応じて画面
/// グループごとにルートを整理すること」)。SCR番号+画面名だけで表現できる、
/// パラメータを運ばない単純なケースのみここに置く。
enum SettingsSubRoute: String, CaseIterable, Hashable {
    case notificationSettings   // SCR-016 通知設定
    case subscriptionManagement // SCR-017 プラン・購読管理
    case displaySettings        // SCR-018 表示・地域設定
    case help                   // SCR-020 ヘルプ・お問い合わせ
    case terms                  // SCR-021 利用規約
    case privacyPolicy          // SCR-022 プライバシーポリシー
    case appInfo                // SCR-023 アプリ情報
    case accountDeletion        // SCR-024 アカウント削除

    var scrNumber: String {
        switch self {
        case .notificationSettings: return "SCR-016"
        case .subscriptionManagement: return "SCR-017"
        case .displaySettings: return "SCR-018"
        case .help: return "SCR-020"
        case .terms: return "SCR-021"
        case .privacyPolicy: return "SCR-022"
        case .appInfo: return "SCR-023"
        case .accountDeletion: return "SCR-024"
        }
    }

    var title: String {
        switch self {
        case .notificationSettings: return "通知設定"
        case .subscriptionManagement: return "プラン・購読管理"
        case .displaySettings: return "表示・地域設定"
        case .help: return "ヘルプ・お問い合わせ"
        case .terms: return "利用規約"
        case .privacyPolicy: return "プライバシーポリシー"
        case .appInfo: return "アプリ情報"
        case .accountDeletion: return "アカウント削除"
        }
    }
}
