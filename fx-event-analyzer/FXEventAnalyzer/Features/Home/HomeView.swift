import SwiftUI

/// SCR-001 Home (ui-screens.md §5). Real `GET /home` data — SCHEDULED /
/// RELEASED events, each tappable to SCR-004 Event Detail.
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5Home` (fixed 234×491 coordinate space via
/// `V5Viewport`), reproduced as given. Still non-scrolling — `V5Viewport`
/// itself has no `ScrollView` — though the main content below the header
/// (see the 2026-10-02 note) now flows via a plain `VStack` instead of
/// absolute `.position()` placement for every card, since its card count
/// and heights are no longer fixed-slot. Hiding an absent section (`if
/// !items.isEmpty`) still never fabricates placeholder rows for missing
/// real data — only the mechanism changed, not the principle.
/// - `HQV5DemoRouter.push(...)` → real `AppRoute.eventDetail`
///   `NavigationLink`s.
/// - `tabSelection`: a real `Binding<Int>` threaded from `MainTabView`, so
///   `V5BottomBar` switches tabs for real.
///
/// HQ指示(2026-10-02)「ホーム画面の構成」→ HQから参考画像が直接共有され
/// 「UIはこれを再現してください」との指示(第2回)。画像は「今日の重要
/// イベント」「通貨ペア」の2カードのみを示しており(各カード: アイコン+
/// タイトル+右側アクションのヘッダー、区切り線付きの行リスト、最大3件)、
/// この画像のカード/行デザインに合わせて作り直した。合わせて判断した点:
/// - 画像の「今日の重要イベント」行は種別バッジ(経済指標=赤/要人発言=青/
///   中央銀行=紫)を持つ。これは前回版で別セクションにしていた「直近の
///   要人発言」を、別セクションではなくイベント行の種別タグとして統合する
///   という意図だと判断し、独立した「直近の要人発言」セクションは廃止した。
///   ただしバックエンドには指標発表イベントのAPIしか無く、要人発言/中央
///   銀行声明そのものを表すデータは存在しない(SCR-014/015は仮画面のみ、
///   `api-design.md`にも該当エンドポイントなし)ため、実際に表示される
///   行は常に「経済指標」バッジのみ — 画像にある「FOMCメンバー発言」
///   「ECB要人発言」のような行は実データが無く、捏造せず表示していない。
///   バックエンド側にその種のデータが追加された時点でバッジが自然に
///   増える設計。
/// - 行の予想/前回の数値は画像では「%」付きだが、`HomeEventSummary`に
///   単位情報が無く(指標によっては%でない値もあり得る)、他画面(Event
///   Detail等)も単位を付けずに数値のみ表示しているため、ここでも数値の
///   みとした(実際と異なる単位を捏造しないため)。
/// - 「通貨ペア」の価格変動色は画像の実測に合わせて反転した(上昇=赤/
///   下落=緑、日本の相場表示でよく使われる配色。既存の`fxBox`は逆
///   (上昇=緑)だったため、このカードでは使っていない)。
/// - 通貨ペアの2つの国旗は、画像にある「ベース通貨/決済通貨それぞれの
///   国旗」を表示するため、主要通貨→代表国(ISO 4217↔3166の客観的対応、
///   推測ではない)の変換を`CountryFlag.emoji(forCurrency:)`として追加。
/// - 「お気に入り」は画像に写っていないが(画像はおそらく画面上部のみの
///   抜粋)、同じカード/行デザインに揃えて残した(国旗+名称+重要度
///   バッジ、画像にある種別バッジ・2行目の数値は無し — イベント/指標
///   どちらも含むため種別を固定できない)。
/// - カードは`V5Card`のような固定高さ矩形ではなく、内容に応じて自然に
///   高さが決まる`VStack`ベースの新カード(`homeCard`)にした — 行数や
///   2行テキストの実際の高さを事前に正確な数値で予測できないため。
///   3カード全体をもう1つの`VStack`で縦に並べ、画面上部に固定オフセット
///   で配置している(個々の絶対y座標を手計算する前回方式はやめた)。
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

    // 参考画像から実測(Home画面全体のキャプチャに対する相対比率)。
    private static let economicIndicatorLabel = "経済指標"
    private static let economicIndicatorBadgeColor = Color(red: 150.0 / 255, green: 32.0 / 255, blue: 58.0 / 255)
    /// 日本の相場表示でよく使われる配色(上昇=赤/下落=緑)。既存の
    /// `Importance.v5Color`(他画面で使用中、変更していない)とは別に、
    /// このカード専用の重要度バッジ色として中程度だけ差し替える
    /// (HIGH/LOWは既存のred/blueのまま、MEDIUMだけ参考画像実測の琥珀色)。
    private static let mediumImportanceBadgeColor = Color(red: 196.0 / 255, green: 148.0 / 255, blue: 58.0 / 255)
    private static let changeUpColor = Color(red: 214.0 / 255, green: 83.0 / 255, blue: 109.0 / 255)
    private static let changeDownColor = Color(red: 46.0 / 255, green: 170.0 / 255, blue: 120.0 / 255)

    private static func importanceBadgeColor(_ importance: Importance) -> Color {
        importance == .medium ? mediumImportanceBadgeColor : importance.v5Color
    }

    private static var todayLabel: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "M/d（E）"
        formatter.locale = Locale(identifier: "ja_JP")
        return formatter.string(from: Date())
    }

    private var loadedScreen: some View {
        let topEvents = Array(mappedTodayEvents.prefix(3))
        let pairs = Array(mappedPairs.prefix(3))
        let favorites = Array(viewModel.favoriteItems.prefix(3))

        return V5Viewport {
            homeHeader

            VStack(alignment: .leading, spacing: 10) {
                if !topEvents.isEmpty {
                    homeCard {
                        cardHeader(icon: "calendar", title: "今日の重要イベント") {
                            NavigationLink(value: AppRoute.calendar) {
                                HStack(spacing: 2) {
                                    Text(Self.todayLabel).font(.system(size: 7)).foregroundStyle(V5P.muted)
                                    Image(systemName: "chevron.right").font(.system(size: 6)).foregroundStyle(V5P.muted)
                                }
                            }
                        }
                        ForEach(Array(topEvents.enumerated()), id: \.element.id) { idx, event in
                            if idx > 0 { Divider().overlay(V5P.line.opacity(0.4)) }
                            NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                                eventRow(event)
                            }.buttonStyle(.plain)
                        }
                    }
                }

                if !pairs.isEmpty {
                    homeCard {
                        cardHeader(icon: "chart.line.uptrend.xyaxis", title: "通貨ペア") {
                            Text("すべて見る").font(.system(size: 7)).foregroundStyle(V5P.muted)
                            Image(systemName: "chevron.right").font(.system(size: 6)).foregroundStyle(V5P.muted)
                        }
                        ForEach(Array(pairs.enumerated()), id: \.element.id) { idx, pair in
                            if idx > 0 { Divider().overlay(V5P.line.opacity(0.4)) }
                            NavigationLink(value: AppRoute.chartAnalysis(fxPairId: pair.id, fxPairSymbol: pair.symbol)) {
                                pairRow(pair)
                            }.buttonStyle(.plain)
                        }
                    }
                }

                if !favorites.isEmpty {
                    homeCard {
                        cardHeader(icon: "star.fill", title: "お気に入り") { EmptyView() }
                        ForEach(Array(favorites.enumerated()), id: \.element.id) { idx, item in
                            if idx > 0 { Divider().overlay(V5P.line.opacity(0.4)) }
                            favoriteRow(item)
                        }
                    }
                }
            }
            .padding(.top, 58)
            .frame(width: V5P.W, height: V5P.H, alignment: .top)

            V5BottomBar(selected: $tabSelection)
        }
    }

    /// 参考画像のカード(角丸の大きい矩形、アイコン+タイトル+右側アクション
    /// のヘッダー、区切り線付きの行リスト)。`V5Card`と違い高さを固定値で
    /// 指定せず、中身(行数・2行テキストの実際の高さ)に応じて自然に決まる
    /// `VStack`にした。
    @ViewBuilder private func homeCard(@ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            content()
        }
        .padding(10)
        .frame(width: 214, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(LinearGradient(colors: [V5P.panel2, V5P.panel], startPoint: .topLeading, endPoint: .bottomTrailing))
        )
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(V5P.line.opacity(0.75), lineWidth: 0.65))
    }

    @ViewBuilder private func cardHeader(icon: String, title: String, @ViewBuilder trailing: () -> some View) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 10, weight: .semibold)).foregroundStyle(V5P.cyan)
            Text(title).font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
            Spacer()
            trailing()
        }
        Divider().overlay(V5P.line.opacity(0.4))
    }

    @ViewBuilder private func eventRow(_ event: HomeEventSummary) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(ValueFormat.time(event.releaseDatetime))
                .font(.system(size: 8, weight: .medium))
                .foregroundStyle(V5P.muted)
                .frame(width: 24, alignment: .leading)

            VStack(spacing: 2) {
                Text(CountryFlag.emoji(for: event.countryCode)).font(.system(size: 14))
                Text(event.currencyCode).font(.system(size: 6, weight: .semibold)).foregroundStyle(V5P.muted)
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Text(Self.economicIndicatorLabel)
                        .font(.system(size: 6, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Self.economicIndicatorBadgeColor, in: Capsule())
                    Text(event.indicatorName).font(.system(size: 8, weight: .bold)).lineLimit(1)
                }
                if let subtitle = Self.eventSubtitle(event) {
                    Text(subtitle).font(.system(size: 6.5)).foregroundStyle(V5P.muted)
                }
            }

            Spacer(minLength: 4)

            VStack(spacing: 4) {
                V5Badge(text: event.importance.rawValue, color: Self.importanceBadgeColor(event.importance))
                Image(systemName: "chevron.right").font(.system(size: 6)).foregroundStyle(V5P.muted)
            }
        }
        .foregroundStyle(.white)
    }

    private static func eventSubtitle(_ event: HomeEventSummary) -> String? {
        var parts: [String] = []
        if let forecast = event.forecast { parts.append("予想 \(ValueFormat.number(forecast))") }
        if let previous = event.previous { parts.append("前回 \(ValueFormat.number(previous))") }
        return parts.isEmpty ? nil : parts.joined(separator: "　|　")
    }

    @ViewBuilder private func pairRow(_ pair: FXPairUI) -> some View {
        HStack(spacing: 8) {
            HStack(spacing: -6) {
                Text(CountryFlag.emoji(forCurrency: pair.baseCurrency)).font(.system(size: 14))
                Text(CountryFlag.emoji(forCurrency: pair.quoteCurrency)).font(.system(size: 14))
            }
            Text(pair.displaySymbol).font(.system(size: 9, weight: .bold))
            Spacer()
            Text(pair.price).font(.system(size: 11, weight: .bold))
            HStack(spacing: 2) {
                Image(systemName: pair.isUp ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 6))
                Text(pair.change).font(.system(size: 8, weight: .semibold))
            }
            .foregroundStyle(pair.isUp ? Self.changeUpColor : Self.changeDownColor)
            Image(systemName: "chevron.right").font(.system(size: 6)).foregroundStyle(V5P.muted)
        }
        .foregroundStyle(.white)
    }

    @ViewBuilder private func favoriteRow(_ item: HomeFavoriteItem) -> some View {
        switch item {
        case .event(let id, let countryCode, let currencyCode, let name, let importance):
            NavigationLink(value: AppRoute.eventDetail(id: id)) {
                favoriteRowContent(countryCode: countryCode, currencyCode: currencyCode, name: name, importance: importance)
            }.buttonStyle(.plain)
        case .indicator(let id, let countryCode, let currencyCode, let name, let importance):
            NavigationLink(value: AppRoute.indicatorDetail(id: id)) {
                favoriteRowContent(countryCode: countryCode, currencyCode: currencyCode, name: name, importance: importance)
            }.buttonStyle(.plain)
        }
    }

    @ViewBuilder private func favoriteRowContent(countryCode: String, currencyCode: String, name: String, importance: Importance) -> some View {
        HStack(spacing: 8) {
            VStack(spacing: 2) {
                Text(CountryFlag.emoji(for: countryCode)).font(.system(size: 14))
                Text(currencyCode).font(.system(size: 6, weight: .semibold)).foregroundStyle(V5P.muted)
            }
            Text(name).font(.system(size: 9, weight: .semibold)).lineLimit(1)
            Spacer()
            V5Badge(text: importance.rawValue, color: Self.importanceBadgeColor(importance))
            Image(systemName: "chevron.right").font(.system(size: 6)).foregroundStyle(V5P.muted)
        }
        .foregroundStyle(.white)
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

    var baseCurrency: String { String(symbol.prefix(3)) }
    var quoteCurrency: String { String(symbol.suffix(3)) }
    var displaySymbol: String { "\(baseCurrency)/\(quoteCurrency)" }
}
