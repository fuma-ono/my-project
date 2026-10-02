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
/// - The hero "Upcoming Events" card is real `HomeViewModel.upcomingEvents`
///   `.first`, shown only `if let` (a real day can have none; HQ's demo
///   always shows one).
/// - HQ's 4 hardcoded "Recent Events" rows and 3 hardcoded "主要FX" boxes
///   are real `ForEach`s bound to the real lists, `.prefix`-ed to the same
///   4/3 slot counts HQ's fixed coordinates provision for (174+idx*53 for
///   4 rows; 3 side-by-side boxes) — extra real items beyond that are not
///   shown (Home is a preview; the full lists live on the Indicators tab
///   and are not cut off there), fewer real items just leave the
///   remaining fixed slots empty, never inventing rows to fill them.
/// - `HQV5DemoRouter.push(...)` → real `AppRoute.eventDetail`
///   `NavigationLink`s.
/// - `tabSelection`: a real `Binding<Int>` threaded from `MainTabView`, so
///   `V5BottomBar` switches tabs for real.
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

    private var loadedScreen: some View {
        V5Viewport {
            homeHeader

            if let hero = mappedEvents.upcoming.first {
                NavigationLink(value: AppRoute.eventDetail(id: hero.id)) {
                    V5Card(CGRect(x: 10, y: 58, width: 214, height: 94)) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Upcoming Events").font(.system(size: 11, weight: .bold))
                            Text("Today  \(ValueFormat.time(hero.releaseDatetime))").font(.system(size: 7)).foregroundStyle(V5P.muted)
                            V5EventRow(home: hero)
                        }
                    }
                }.buttonStyle(.plain)
            }

            Text("Recent Events").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                .position(x: 49, y: 162)
            ForEach(Array(mappedEvents.rest.prefix(4).enumerated()), id: \.element.id) { idx, event in
                NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                    V5Card(CGRect(x: 10, y: 174 + CGFloat(idx) * 53, width: 214, height: 48)) {
                        V5EventRow(home: event)
                    }
                }.buttonStyle(.plain)
            }

            if !mappedPairs.isEmpty {
                Text("主要FX").font(.system(size: 11, weight: .bold)).foregroundStyle(.white).position(x: 35, y: 395)
                HStack(spacing: 5) {
                    // 2026-09-29 HQ承認(2-b): 既存の通貨ペアカードをそのまま
                    // NavigationLinkでラップし、SCR-011 チャート分析(仮画面)への
                    // 遷移を確認できるようにした。見た目(fxBox)は変更していない。
                    ForEach(mappedPairs.prefix(3)) { pair in
                        NavigationLink(value: AppRoute.chartAnalysis(fxPairId: pair.id, fxPairSymbol: pair.symbol)) {
                            fxBox(pair)
                        }.buttonStyle(.plain)
                    }
                }.frame(width: 214).position(x: 117, y: 421)
            }

            V5BottomBar(selected: $tabSelection)
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

    private var mappedEvents: (upcoming: [HomeEventSummary], rest: [HomeEventSummary]) {
        let upcoming = viewModel.upcomingEvents.sorted { $0.releaseDatetime < $1.releaseDatetime }
        let rest = (viewModel.upcomingEvents.dropFirst() + viewModel.recentEvents)
            .sorted { $0.releaseDatetime < $1.releaseDatetime }
        return (upcoming, rest)
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

extension V5EventRow {
    init(home event: HomeEventSummary) {
        self.init(
            flag: CountryFlag.emoji(for: event.countryCode),
            name: event.indicatorName,
            code: event.currencyCode,
            badge: event.importance.rawValue.capitalized,
            badgeColor: event.importance.v5Color,
            forecast: event.forecast.map { ValueFormat.number($0) } ?? "-",
            actual: event.status == .released ? (event.actual.map { ValueFormat.number($0) } ?? "-") : "-",
            previous: event.previous.map { ValueFormat.number($0) } ?? "-"
        )
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
