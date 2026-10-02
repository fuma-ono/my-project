import SwiftUI

/// SCR-001 Home (ui-screens.md §5). Real `GET /home` data — SCHEDULED /
/// RELEASED events, each tappable to SCR-004 Event Detail.
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5Home` (fixed 234×491 coordinate space via
/// `V5Viewport`, absolute-positioned cards), reproduced as given.
/// Adaptations, all wiring, not redesign:
/// - HQ's `V5Home` has no `ScrollView` at all — the whole screen is one
///   fixed, non-scrolling composition, unlike the prior HQV5 integration.
///   Because every element here is placed with `.position()` (not normal
///   flow layout), hiding an absent element never shifts anything else —
///   so "no real data → hidden, never fabricated" is layout-safe by
///   construction, not a coordinate change.
/// - `HQV5DemoRouter.push(...)` → real `AppRoute.eventDetail`
///   `NavigationLink`s.
/// - `tabSelection`: a real `Binding<Int>` threaded from `MainTabView`, so
///   `V5BottomBar` switches tabs for real.
///
/// HQ指示(2026-10-02)「ホーム画面の構成」: 画面構成を4セクションに再編した
/// (今日の重要イベント/通貨ペア/お気に入り/直近の要人発言)。固定のピクセル
/// 参考画像は無いため、以下はこちらの判断で決めたレイアウトであり、HQの
/// レビュー待ち:
/// - 全セクション共通で最大3件表示(指示通り)。
/// - 旧「Upcoming Events」の大きいヒーローカード(予想/結果/前回の数値付き)
///   は廃止し、「今日の重要イベント」「お気に入り」はどちらも国旗/通貨/
///   名称/重要度バッジだけのコンパクトな行にした — 非スクロールの固定
///   234×491キャンバスに4セクション×3件を収めるため、数値メトリクス行の
///   スペースが確保できなかった(詳細な予想/結果/前回はEvent Detail側で
///   引き続き見られる)。
/// - 各セクションは実際の件数ぶんだけ高さを使い、次のセクションへ続く
///   (0件なら見出しごと非表示、3件未満なら空きスロットを残さず詰める) —
///   お気に入りや通貨ペアは0件から始まり得るため、固定スロットを常に
///   確保する旧方式ではなく動的スタッキングにした。
/// - 「お気に入り」は`FavoritesStore`(端末ローカル)の登録順(新しい順)を
///   `HomeViewModel`が購読し、最大3件を`GET /events/{id}`・
///   `GET /indicators/{id}`で解決。指標/イベントどちらもタップで該当の
///   詳細画面に遷移する。
/// - 「直近の要人発言」はバックエンドAPIが存在しない(SCR-014/015は仮画面
///   のみ、`docs/projects/fx-event-analyzer/api-design.md`にも該当エンド
///   ポイントなし)。実データが無い項目を捏造しない方針のため、見出しと
///   「準備中」の注記のみ表示し、ダミーの発言は一切表示していない。
struct HomeView: View {
    @StateObject private var viewModel: HomeViewModel
    @Binding var path: NavigationPath
    @Binding var tabSelection: Int
    private let apiClient: APIClient

    init(apiClient: APIClient, path: Binding<NavigationPath>, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: HomeViewModel(apiClient: apiClient))
        _path = path
        _tabSelection = tabSelection
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: AppRoute.self) { route in
                    AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
                }
        }
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "経済指標データはまだ利用できません。実装が完了次第、ここに表示されます。") }
        case .loaded(let events, let majorFx) where events.isEmpty && majorFx.isEmpty:
            loadingScaffold { FXEmptyState(icon: "calendar", title: "本日のイベントはありません", message: "本日発表予定の経済指標はありません。") }
        case .loaded:
            loadedScreen
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: () -> some View) -> some View {
        ZStack {
            // HQ指示(2026-10-02): 中身の背景をSplash/Loginのグラデーションから切り離し、
            // 単色(backgroundPrimary)に変更(詳細はV5Backgroundのドキュメントコメント参照)。
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea()
            content()
        }
    }

    /// HQ「ヘッダー最終調整」(2026-10-01、4回目)。Homeは他のメインタブと
    /// 違い独自レイアウト(ロゴ+タイトル+通知/アカウントアイコン)を持つため
    /// `V5Header`は使わず、ここで直接組んでいる。
    /// - ロゴはSplashView/LoginViewが使っている実物のブランドマーク
    ///   `BrandMark`(`BrandMarkGraphic`画像アセット)をそのまま再利用する。
    ///   画像の実寸比率(805:480)を保ったまま目標の高さ(24pt相当)に合わせて
    ///   `width`を逆算している。
    /// - タイトルの「F」「X」は、Splash/Loginの「FX」ワードマークと同じ
    ///   `DesignTokens.Colors.brandTitleAccentF`/`brandTitleAccentX`で着色
    ///   し、Home独自の色は使っていない。
    /// - 通知・アカウントアイコンは、単純な絶対pt値ではなく
    ///   `V5Header`のお気に入り★(`star.fill`、12pt)と「見た目のサイズ」が
    ///   揃うようCI実機キャプチャで実測調整した値(`notifIconSize`/
    ///   `accountIconSize`)を使っている。SF Symbolはシンボルごとに外形が
    ///   異なり単純に同じpt数を指定しても揃わないため。
    /// - アカウントアイコン(`person`、Settingsの「アカウント情報」行と同じ
    ///   SF Symbol)は仕様が明示的に要求しているため新規追加したが、今回も
    ///   サイズ・レイアウトのみが指示範囲のため、タップ時の画面遷移は配線
    ///   していない(ベルアイコンも既存から非機能のまま)。
    private var homeHeader: some View {
        let logoTitleGap = V5P.ptToV5(6)
        let iconGap = V5P.ptToV5(12)
        let margin = V5P.ptToV5(16)
        let logoHeight = V5P.ptToV5(24)
        let logoWidth = logoHeight * (805.0 / 480.0)
        // ★(star.fill, 12pt)と視覚的な大きさを揃えるための実測値。1巡目は
        // 同じ12ptから出発したが、CI実機キャプチャで実測した結果
        // star.fillは12ptで約56px四方(bellは12ptで約37px、personは約34px)
        // と、同じpt数でも外形サイズがSF Symbolごとに大きく異なっていた。
        // star.fillの実測高さを基準に逆算した値(bell: 12×56/37≈18.2pt、
        // person: 12×56/34≈19.8pt)に調整。
        let notifIconSize = V5P.ptToV5(18.2)
        let accountIconSize = V5P.ptToV5(19.8)
        // HQ指示(2026-10-02)「ロゴの位置をもう少し上に、ロゴの下部分がFの
        // 下部分と一致するように」。中心合わせ(2.5pt)まで適用した直後の
        // CI実機キャプチャを再実測した結果、ロゴ単体の下端(y=291px)が
        // 「F」1文字だけの下端(y=278px、"Analyzer"のディセンダーを含む
        // テキスト全体ではなく"F"単体で計測)より13px(実寸約4.33pt)下に
        // はみ出していた。中心合わせ時の+2.5ptからさらに4.33pt分ロゴを
        // 上へ補正(2.5 - 13/3 = -11/6pt)し、ロゴ下端とF下端が一致するよう
        // にした。
        let logoVerticalCorrection = V5P.ptToV5(-11.0 / 6.0)
        return HStack(spacing: 0) {
            BrandMark(width: logoWidth)
                .offset(y: logoVerticalCorrection)
            (
                Text("F").foregroundStyle(DesignTokens.Colors.brandTitleAccentF)
                + Text("X").foregroundStyle(DesignTokens.Colors.brandTitleAccentX)
                + Text(" Event Analyzer").foregroundStyle(.white)
            )
            .font(.system(size: V5P.ptToV5(24), weight: .semibold))
            .padding(.leading, logoTitleGap)
            Spacer()
            Image(systemName: "bell").font(.system(size: notifIconSize, weight: .semibold))
            Image(systemName: "person").font(.system(size: accountIconSize, weight: .semibold)).padding(.leading, iconGap)
        }
        .foregroundStyle(.white)
        .frame(width: V5P.W - margin * 2, height: V5P.ptToV5(44))
        .position(x: V5P.W / 2, y: 40)
    }

    // レイアウト定数(HQの固定参考画像は無いため、4セクション×最大3件を
    // 非スクロールの234×491キャンバスに収める目的で決めた値)。
    private static let contentTop: CGFloat = 58
    private static let headingGap: CGFloat = 12
    private static let rowHeight: CGFloat = 30
    private static let rowPitch: CGFloat = 34
    private static let sectionGap: CGFloat = 14
    private static let pairsBoxHeight: CGFloat = 55

    /// `count`件のコンパクト行セクション(見出し+行)の下端yを返す。0件なら
    /// 見出しごと非表示にするため、セクションの footprint は無し(`start`を
    /// そのまま返す)。
    private static func rowsSectionBottom(start: CGFloat, count: Int) -> CGFloat {
        guard count > 0 else { return start }
        let rowsTop = start + headingGap
        return rowsTop + CGFloat(count - 1) * rowPitch + rowHeight
    }

    private var loadedScreen: some View {
        let topEvents = Array(mappedTodayEvents.prefix(3))
        let pairs = Array(mappedPairs.prefix(3))
        let favorites = Array(viewModel.favoriteItems.prefix(3))

        let eventsHeadingY = Self.contentTop
        let eventsBottomY = Self.rowsSectionBottom(start: eventsHeadingY, count: topEvents.count)

        let pairsHeadingY = eventsBottomY + Self.sectionGap
        let pairsBottomY = pairs.isEmpty ? pairsHeadingY : pairsHeadingY + Self.headingGap + Self.pairsBoxHeight

        let favoritesHeadingY = pairsBottomY + Self.sectionGap
        let favoritesBottomY = Self.rowsSectionBottom(start: favoritesHeadingY, count: favorites.count)

        let speechesHeadingY = favoritesBottomY + Self.sectionGap

        return V5Viewport {
            homeHeader

            if !topEvents.isEmpty {
                sectionHeading("今日の重要イベント", y: eventsHeadingY)
                ForEach(Array(topEvents.enumerated()), id: \.element.id) { idx, event in
                    NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                        V5Card(CGRect(x: 10, y: eventsHeadingY + Self.headingGap + CGFloat(idx) * Self.rowPitch, width: 214, height: Self.rowHeight)) {
                            compactRow(
                                flag: CountryFlag.emoji(for: event.countryCode),
                                code: event.currencyCode,
                                name: event.indicatorName,
                                badge: event.importance.rawValue.capitalized,
                                badgeColor: event.importance.v5Color
                            )
                        }
                    }.buttonStyle(.plain)
                }
            }

            if !pairs.isEmpty {
                sectionHeading("通貨ペア", y: pairsHeadingY)
                HStack(spacing: 5) {
                    // 2026-09-29 HQ承認(2-b): 既存の通貨ペアカードをそのまま
                    // NavigationLinkでラップし、SCR-011 チャート分析(仮画面)への
                    // 遷移を確認できるようにした。見た目(fxBox)は変更していない。
                    ForEach(pairs) { pair in
                        NavigationLink(value: AppRoute.chartAnalysis(fxPairId: pair.id, fxPairSymbol: pair.symbol)) {
                            fxBox(pair)
                        }.buttonStyle(.plain)
                    }
                }.frame(width: 214).position(x: 117, y: pairsHeadingY + Self.headingGap + Self.pairsBoxHeight / 2)
            }

            if !favorites.isEmpty {
                sectionHeading("お気に入り", y: favoritesHeadingY)
                ForEach(Array(favorites.enumerated()), id: \.element.id) { idx, item in
                    favoriteRow(item, y: favoritesHeadingY + Self.headingGap + CGFloat(idx) * Self.rowPitch)
                }
            }

            // 「直近の要人発言」: バックエンドAPIが無く(SCR-014/015は仮画面
            // のみ)、実データを捏造できないため、見出しと準備中の注記のみ。
            sectionHeading("直近の要人発言", y: speechesHeadingY)
            Text("バックエンドAPI未実装のため準備中です").font(.system(size: 8)).foregroundStyle(V5P.muted)
                .frame(width: 214, alignment: .leading).position(x: 117, y: speechesHeadingY + Self.headingGap)

            V5BottomBar(selected: $tabSelection)
        }
    }

    @ViewBuilder private func sectionHeading(_ title: String, y: CGFloat) -> some View {
        Text(title).font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
            .frame(width: 214, alignment: .leading).position(x: 117, y: y)
    }

    @ViewBuilder private func compactRow(flag: String, code: String, name: String, badge: String, badgeColor: Color) -> some View {
        HStack(spacing: 5) {
            Text(flag).font(.system(size: 13))
            VStack(alignment: .leading, spacing: 1) {
                Text(code).font(.system(size: 7, weight: .bold))
                Text(name).font(.system(size: 8, weight: .semibold)).lineLimit(1)
            }
            Spacer()
            V5Badge(text: badge, color: badgeColor)
            Image(systemName: "chevron.right").font(.system(size: 7)).foregroundStyle(V5P.muted)
        }
        .foregroundStyle(.white)
    }

    @ViewBuilder private func favoriteRow(_ item: HomeFavoriteItem, y: CGFloat) -> some View {
        switch item {
        case .event(let id, let countryCode, let currencyCode, let name, let importance):
            NavigationLink(value: AppRoute.eventDetail(id: id)) {
                V5Card(CGRect(x: 10, y: y, width: 214, height: Self.rowHeight)) {
                    compactRow(flag: CountryFlag.emoji(for: countryCode), code: currencyCode, name: name, badge: importance.rawValue.capitalized, badgeColor: importance.v5Color)
                }
            }.buttonStyle(.plain)
        case .indicator(let id, let countryCode, let currencyCode, let name, let importance):
            NavigationLink(value: AppRoute.indicatorDetail(id: id)) {
                V5Card(CGRect(x: 10, y: y, width: 214, height: Self.rowHeight)) {
                    compactRow(flag: CountryFlag.emoji(for: countryCode), code: currencyCode, name: name, badge: importance.rawValue.capitalized, badgeColor: importance.v5Color)
                }
            }.buttonStyle(.plain)
        }
    }

    @ViewBuilder private func fxBox(_ pair: FXPairUI) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text(pair.symbol).font(.system(size: 7, weight: .bold)); Spacer(); Circle().fill(pair.isUp ? V5P.green : V5P.red).frame(width: 4, height: 4) }
            Text(pair.price).font(.system(size: 12, weight: .bold))
            Text(pair.change).font(.system(size: 7, weight: .semibold)).foregroundStyle(pair.isUp ? V5P.green : V5P.red)
        }
        .foregroundStyle(.white)
        .padding(6).frame(width: 68, height: 55, alignment: .topLeading)
        .background(V5P.panel, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(V5P.line.opacity(0.6), lineWidth: 0.5))
    }

    /// 「今日の重要イベント」: 当日のSCHEDULED/RELEASEDイベントを時刻順に
    /// 結合した1本のリスト(旧「Upcoming Events」ヒーロー+「Recent Events」
    /// リストの統合)。
    private var mappedTodayEvents: [HomeEventSummary] {
        (viewModel.upcomingEvents + viewModel.recentEvents).sorted { $0.releaseDatetime < $1.releaseDatetime }
    }

    private var mappedPairs: [FXPairUI] {
        viewModel.majorFxList.map(FXPairUI.init(major:))
    }
}

private extension HomeViewModel {
    var majorFxList: [MajorFxSummary] {
        guard case .loaded(_, let majorFx) = state else { return [] }
        return majorFx
    }
}

extension Importance {
    var v5Color: Color {
        switch self {
        case .high: return V5P.red
        case .medium: return V5P.green
        case .low: return V5P.blue
        }
    }
}

private extension FXPairUI {
    init(major fx: MajorFxSummary) {
        self.init(
            id: fx.fxPairId,
            symbol: fx.symbol,
            price: ValueFormat.number(fx.price, fractionDigits: fx.symbol.contains("JPY") ? 2 : 4),
            change: ValueFormat.percent(fx.changePercent, signed: true),
            isUp: (fx.changePercent ?? 0) >= 0
        )
    }
}
