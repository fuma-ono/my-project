import Foundation

/// Navigation destinations pushed onto a tab's `NavigationStack`
/// (ui-screens.md §6 コア画面遷移):
/// Home → Event Detail → Movement Detail; Indicators → Indicator Detail →
/// Historical Event Detail → Indicator Detail; Indicator Detail →
/// Historical Comparison. Deliberately a flat enum rather than a
/// Router/Coordinator abstraction — each tab owns its own `NavigationPath`
/// and pushes these directly (HQ Phase 3 instruction: "過度なRouter抽象化
/// は避ける").
enum AppRoute: Hashable {
    case indicatorDetail(id: String)
    case eventDetail(id: String)
    case historicalEventDetail(id: String)
    /// SCR-011 Account, reached from Settings — HQ Frontend integration
    /// (2026-09-21): the only new route this round added, since the
    /// delivered UI package includes an Account screen with no prior
    /// production route to it.
    case account
    /// SCR-004/SCR-007's related FX pair rows carry enough already-fetched
    /// display context (symbol/indicator name/release datetime) to avoid an
    /// extra round trip just to re-render Movement Detail's header.
    /// `indicatorId` rides along too so Movement Detail can offer a direct
    /// "過去と比較する" jump to Historical Comparison without making the
    /// user re-search the indicator (Phase 5 instruction).
    case movementDetail(eventId: String, indicatorId: String, fxPairId: String, symbol: String, indicatorName: String, releaseDatetime: Date)
    case historicalComparison(indicatorId: String, indicatorName: String, fxPairId: String, fxPairSymbol: String)

    // MARK: - ui-screens.md v2.0 (2026-09-29 HQ承認, 2-b) 向けの新規ケース
    //
    // 新画面仕様(SCR-000〜SCR-028)のうち、実装本体がまだ存在しない画面への
    // 遷移先。すべて`AppRouteDestinationView`で`PlaceholderScreenView`(仮画面)
    // に解決される — デザインはまだ確定していないため、ここでは「遷移先と
    // 引き継ぐパラメータ」だけを定義する(ui-screens.md v2.0 §4.1)。

    /// SCR-011 チャート分析。ホームの通貨ペアカードから遷移する想定。
    case chartAnalysis(fxPairId: String, fxPairSymbol: String)
    /// SCR-012 経済指標カレンダー
    case calendar
    /// SCR-014 要人発言一覧(バックエンドAPI未実装、仮画面のみ)
    case speechList
    /// SCR-015 要人発言詳細(バックエンドAPI未実装、仮画面のみ)
    case speechDetail(id: String)
    /// SCR-028 ホーム通貨ペア編集(お気に入り通貨ペアAPI未実装、仮画面のみ)
    case homeCurrencyPairEditor
    /// SCR-002 新規会員登録(Loginから)
    case signUp
    /// SCR-003 パスワード再設定(Loginから)
    case passwordReset
}
