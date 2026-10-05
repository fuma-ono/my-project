import Foundation

/// Navigation destinations pushed onto a tab's `NavigationStack`.
///
/// HQ指示(2026-10-03、画面構成全面更新)に伴う新SCR番号(27画面、SCR-000〜
/// 026)でのコア画面遷移:
/// SCR-004 ホーム → SCR-007 イベント詳細 → SCR-008 相場反応詳細;
/// SCR-005 指標一覧 → SCR-006 指標詳細 → SCR-007 イベント詳細;
/// SCR-006 指標詳細 → SCR-009 過去イベント比較 → SCR-008 相場反応詳細
/// (過去の発表回を選んだ場合も同じSCR-008に集約、旧「過去イベント詳細」
/// 独立画面は削除);
/// SCR-012 要人発言一覧 → SCR-013 要人発言詳細 → SCR-008 相場反応詳細。
/// Deliberately a flat enum rather than a Router/Coordinator abstraction —
/// each tab owns its own `NavigationPath` and pushes these directly (HQ
/// Phase 3 instruction: "過度なRouter抽象化は避ける")。
enum AppRoute: Hashable {
    /// SCR-006 指標詳細。
    case indicatorDetail(id: String)
    /// SCR-007 イベント詳細。
    case eventDetail(id: String)
    /// SCR-015 アカウント情報、Settingsから遷移 — HQ Frontend integration
    /// (2026-09-21): the only new route this round added, since the
    /// delivered UI package includes an Account screen with no prior
    /// production route to it.
    case account
    /// SCR-008 相場反応詳細。SCR-007/SCR-013の関連通貨ペア行が既に取得済みの
    /// 表示情報(symbol/indicator name/release datetime)を渡すことで、画面
    /// 再描画のための追加往復を避けている。`indicatorId`も渡し、SCR-009
    /// 過去イベント比較への「過去と比較する」直接ジャンプに使う(Phase 5
    /// instruction)。HQ指示(2026-10-03)により、旧「過去イベント詳細」独立
    /// 画面の役割もこのSCR-008に集約された — SCR-009の各行もこのcaseへ
    /// (過去の`eventId`で)遷移する。
    case movementDetail(eventId: String, indicatorId: String, fxPairId: String, symbol: String, indicatorName: String, releaseDatetime: Date)
    /// SCR-009 過去イベント比較。
    case historicalComparison(indicatorId: String, indicatorName: String, fxPairId: String, fxPairSymbol: String)

    // MARK: - ui-screens.md v2.0 (2026-09-29 HQ承認, 2-b) 向けの新規ケース
    //
    // 新画面仕様のうち、実装本体がまだ存在しない画面への遷移先。すべて
    // `AppRouteDestinationView`で`PlaceholderScreenView`(仮画面)に解決される
    // — デザインはまだ確定していないため、ここでは「遷移先と引き継ぐ
    // パラメータ」だけを定義する。

    /// SCR-010 経済カレンダー。HQ指示(2026-10-03)でメインタブ3番目
    /// (`CalendarTabView`)として新設。このcaseはタブ外(他画面からの
    /// プッシュ遷移)から到達する場合のために残しているが、現時点では
    /// 呼び出し元がない。
    case calendar
    /// SCR-012 要人発言一覧(バックエンドAPI未実装、仮画面のみ)。
    case speechList
    /// SCR-013 要人発言詳細(バックエンドAPI未実装、仮画面のみ)。
    case speechDetail(id: String)
    /// SCR-026 ホーム通貨ペア編集。HQ指示(2026-10-03)により「設定→
    /// ホーム通貨ペア編集→表示する通貨ペアを選択→Homeの『通貨ペア』
    /// セクションに反映」という導線で、Settingsから遷移する(通貨ペア
    /// そのものの詳細画面ではない)。お気に入り通貨ペアAPI未実装のため
    /// 仮画面のみ。
    case homeCurrencyPairEditor
    /// HQ指示(2026-10-02)「お気に入りはホームで最大3件、『すべて見る』から
    /// 全件を確認できる構成に」。ui-screens.mdに該当SCR番号が無い新規画面
    /// (指標・イベント・通貨ペアのお気に入りを横断する一覧)。
    case favoritesList
    /// SCR-002 新規会員登録(Loginから)。
    case signUp
    /// SCR-003 パスワード再設定(Loginから)。
    case passwordReset
}
