import SwiftUI

/// HQ指示(2026-10-02)「今日の重要イベントのイベント種別は経済指標/要人
/// 発言/中央銀行をサポートする設計にする」。`HomeEventSummary`(指標発表
/// イベントAPI)自体にカテゴリ情報が無いため、`HomeEventSummary.homeCategory`
/// (このファイル下部)は常に`.economicIndicator`を返す — 他の2ケースは、
/// 将来要人発言/中央銀行声明のデータソースが追加された時にそのまま使える
/// 受け皿として定義している(存在しないデータを補完する目的ではない)。
enum HomeEventCategory {
    case economicIndicator
    case vipStatement
    case centralBank

    var label: String {
        switch self {
        case .economicIndicator: return "経済指標"
        case .vipStatement: return "要人発言"
        case .centralBank: return "中央銀行"
        }
    }

    var badgeColor: Color {
        switch self {
        case .economicIndicator: return Color(red: 150.0 / 255, green: 32.0 / 255, blue: 58.0 / 255)
        case .vipStatement: return Color(red: 40.0 / 255, green: 93.0 / 255, blue: 170.0 / 255)
        case .centralBank: return Color(red: 95.0 / 255, green: 48.0 / 255, blue: 212.0 / 255)
        }
    }
}

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
/// HQ指示(2026-10-02)「ホーム画面の構成」→ 参考画像共有「UIはこれを
/// 再現してください」(第2回)→ HQ訂正(第3回、2026-10-02)「直近の要人
/// 発言を今日の重要イベントに統合するのは誤り、4セクション構成を維持」。
/// 最終的に以下4セクションで確定:
/// 1. 今日の重要イベント — これから発生する重要イベント(経済指標/要人
///    発言/中央銀行イベント)。`HomeViewModel.upcomingEvents`(SCHEDULED)
///    のみで、既発表(RELEASED)のイベントは含まない。
/// 2. 通貨ペア — ユーザーが確認したい通貨ペア。
/// 3. お気に入り — ユーザーが保存した指標・イベント・通貨ペア。ホームは
///    最大3件、ヘッダーの「すべて見る」から`AppRoute.favoritesList`
///    (仮画面)へ。
/// 4. 直近の要人発言 — すでに発生した要人発言とその後の値動き(「発言→
///    値動き分析」への主要導線)。バックエンドに該当APIが無い
///    (SCR-014/015は仮画面のみ)ため`HomeViewModel.recentSpeeches`は
///    常に空 — 架空データは出さず、「現在表示できる要人発言はありません」
///    という空状態を表示する(セクション自体は常に表示し、将来API追加時に
///    そのまま埋まる構造)。
///
/// 参考画像由来のカード/行デザイン(アイコン+タイトル+右側アクションの
/// ヘッダー、区切り線付きの行リスト、種別/重要度バッジ、国旗)は維持。
/// 合わせて判断した点:
/// - イベント種別は`HomeEventCategory`として経済指標/要人発言/中央銀行の
///   3つをサポートする設計にしたが、`HomeEventSummary`(指標発表イベント
///   API)にはカテゴリ情報自体が無いため、実際に表示される行は常に
///   `.economicIndicator`のみ — 存在しないデータを補完・捏造していない。
/// - 重要度はHIGH/MEDIUM/LOWをバッジで右側に表示(星表示は使用しない)。
/// - 予想/前回の数値は単位を付けず数値のみ(`HomeEventSummary`に単位
///   情報が無いため)。将来イベントデータから単位を取得できるようになれば
///   `eventSubtitle`に反映する。
/// - 「通貨ペア」の価格変動色は参考画像の実測に合わせて反転(上昇=赤/
///   下落=緑、日本の相場表示でよく使われる配色)。通貨ペアの2つの国旗は
///   主要通貨→代表国(ISO 4217↔3166の客観的対応)の変換
///   `CountryFlag.emoji(forCurrency:)`で表示。
/// - お気に入りは指標・イベントに加え通貨ペアも概念上は対象(
///   `FavoritesStore.ItemType.fxPair`/`HomeFavoriteItem.fxPair`として型を
///   用意済み)だが、通貨ペアを★登録できる画面も単体取得APIも現状どこにも
///   無いため、実際にこの種類のお気に入りが生成されることはまだ無い。
/// - カードは`V5Card`のような固定高さ矩形ではなく、内容に応じて自然に
///   高さが決まる`VStack`ベースの新カード(`homeCard`)にした — 行数や
///   2行テキストの実際の高さを事前に正確な数値で予測できないため。
///   4カード全体をもう1つの`VStack`で縦に並べ、画面上部に固定オフセット
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
                        cardHeader(icon: "star.fill", title: "お気に入り") {
                            NavigationLink(value: AppRoute.favoritesList) {
                                HStack(spacing: 2) {
                                    Text("すべて見る").font(.system(size: 7)).foregroundStyle(V5P.muted)
                                    Image(systemName: "chevron.right").font(.system(size: 6)).foregroundStyle(V5P.muted)
                                }
                            }
                        }
                        ForEach(Array(favorites.enumerated()), id: \.element.id) { idx, item in
                            if idx > 0 { Divider().overlay(V5P.line.opacity(0.4)) }
                            favoriteRow(item)
                        }
                    }
                }

                // HQ指示(2026-10-02、訂正)「直近の要人発言は独立セクションの
                // まま維持、架空データは絶対に表示しないこと」。
                // `recentSpeeches`は常に空(`HomeSpeechSummary`参照)なので、
                // このカードは常に表示した上で空状態を出す(セクション自体を
                // 隠さない選択。「発言→値動き分析」への主要導線のため)。
                homeCard {
                    cardHeader(icon: "quote.bubble.fill", title: "直近の要人発言") {
                        NavigationLink(value: AppRoute.speechList) {
                            HStack(spacing: 2) {
                                Text("すべて見る").font(.system(size: 7)).foregroundStyle(V5P.muted)
                                Image(systemName: "chevron.right").font(.system(size: 6)).foregroundStyle(V5P.muted)
                            }
                        }
                    }
                    if viewModel.recentSpeeches.isEmpty {
                        Text("現在表示できる要人発言はありません")
                            .font(.system(size: 8)).foregroundStyle(V5P.muted)
                            .padding(.vertical, 4)
                    } else {
                        ForEach(Array(viewModel.recentSpeeches.prefix(3).enumerated()), id: \.element.id) { idx, speech in
                            if idx > 0 { Divider().overlay(V5P.line.opacity(0.4)) }
                            speechRow(speech)
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
                    Text(event.homeCategory.label)
                        .font(.system(size: 6, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(event.homeCategory.badgeColor, in: Capsule())
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
        case .fxPair(let id, let symbol, let price, let change, let isUp):
            NavigationLink(value: AppRoute.chartAnalysis(fxPairId: id, fxPairSymbol: symbol)) {
                favoriteFxPairRowContent(symbol: symbol, price: price, change: change, isUp: isUp)
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

    /// `HomeFavoriteItem.fxPair`のドキュメントコメント参照 — 現状このtypeの
    /// お気に入りは生成されないが、実装としては用意してある。
    @ViewBuilder private func favoriteFxPairRowContent(symbol: String, price: String, change: String, isUp: Bool) -> some View {
        HStack(spacing: 8) {
            Text(symbol).font(.system(size: 9, weight: .bold))
            Spacer()
            Text(price).font(.system(size: 10, weight: .bold))
            Text(change).font(.system(size: 8, weight: .semibold)).foregroundStyle(isUp ? Self.changeUpColor : Self.changeDownColor)
            Image(systemName: "chevron.right").font(.system(size: 6)).foregroundStyle(V5P.muted)
        }
        .foregroundStyle(.white)
    }

    /// `HomeSpeechSummary`のドキュメントコメント参照 — 実データは一切流れて
    /// 来ないため、CIキャプチャ等では描画されない。バックエンドに要人発言
    /// APIが追加された時にそのまま使える受け皿として用意している。
    @ViewBuilder private func speechRow(_ speech: HomeSpeechSummary) -> some View {
        NavigationLink(value: AppRoute.speechDetail(id: speech.id)) {
            HStack(alignment: .top, spacing: 6) {
                Text(ValueFormat.time(speech.statementDatetime))
                    .font(.system(size: 8, weight: .medium))
                    .foregroundStyle(V5P.muted)
                    .frame(width: 24, alignment: .leading)
                Text(CountryFlag.emoji(for: speech.countryCode)).font(.system(size: 14))
                VStack(alignment: .leading, spacing: 3) {
                    Text(speech.speakerName).font(.system(size: 8, weight: .bold))
                    Text(speech.headline).font(.system(size: 7)).foregroundStyle(V5P.muted).lineLimit(1)
                }
                Spacer(minLength: 4)
                if let symbol = speech.reactionFxSymbol, let change = speech.reactionChangePercent {
                    VStack(spacing: 2) {
                        Text(symbol).font(.system(size: 7, weight: .bold))
                        Text(ValueFormat.percent(change, signed: true))
                            .font(.system(size: 7, weight: .semibold))
                            .foregroundStyle(change >= 0 ? Self.changeUpColor : Self.changeDownColor)
                    }
                }
            }
            .foregroundStyle(.white)
        }.buttonStyle(.plain)
    }

    /// 「今日の重要イベント」: HQ指示(2026-10-02、訂正)「これから発生する
    /// 重要イベント」— 既発表(RELEASED)は含めず、`upcomingEvents`
    /// (SCHEDULED)のみを時刻順に並べる。
    private var mappedTodayEvents: [HomeEventSummary] {
        viewModel.upcomingEvents.sorted { $0.releaseDatetime < $1.releaseDatetime }
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

private extension HomeEventSummary {
    /// `HomeEventCategory`のドキュメントコメント参照 — 指標発表イベント
    /// APIにカテゴリ情報が無いため、常に経済指標として扱う。
    var homeCategory: HomeEventCategory { .economicIndicator }
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
