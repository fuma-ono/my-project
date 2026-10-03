import SwiftUI

/// SCR-001 Home (ui-screens.md §5). Real `GET /home` data.
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5Home` (fixed 234×491 coordinate space via
/// `V5Viewport`), reproduced as given.
///
/// HQ指示(2026-10-03、9回目、新しい参考画像+詳細レイアウト仕様)「今回の
/// ホーム画面UIは添付した参考画像を基準に実装してください」「今日の重要
/// イベントはホームから削除します」: これまでの4セクション構成(今日の
/// 重要イベント/通貨ペア/お気に入り/直近の要人発言)から「今日の重要
/// イベント」を完全に削除し、3セクション構成に変更した:
/// 1. 通貨ペア
/// 2. お気に入り
/// 3. 直近の要人発言(スクロール後に表示)
///
/// HQ指定の参考画像(852×1846px)のレイアウト値を、画面全幅852px≒V5の
/// 234ユニットから算出したスケール3.641(852/234)で比例変換して反映して
/// いる — 絶対pxをそのままSwiftUIに入れてはいない。各カードのwidth/
/// height/corner radius等、変換後の値は各定数のコメントに記載。
///
/// 「今日の重要イベント」削除に伴い、Home経由でSCR-004 Event Detailに
/// 遷移する唯一の導線(Homeのイベント行)が無くなった。SCR-004は
/// ui-screens.mdの必須画面であり続けるため、`IndicatorDetailView`の
/// 「次回発表予定」エリアから遷移できるよう新規配線した(実際に存在する
/// `nextScheduledEvent.id`を使うだけで、イベントやそのデータを捏造しては
/// いない)。UIの配線のみで、API/DB/ビジネスロジックは変更していない。
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
        case .loaded(_, let majorFx) where majorFx.isEmpty:
            loadingScaffold { FXEmptyState(icon: "chart.bar", title: "表示できる通貨ペアがありません", message: "しばらくしてから再度お試しください。") }
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

    /// HQ「ヘッダー最終調整」(2026-10-01、4回目)。既存の正式仕様として
    /// 変更せず維持(HQ指示(2026-10-03、9回目)「既存のSplash/Login/
    /// Header/Footerのデザインルールと矛盾する部分がある場合は、既存の
    /// 正式仕様を優先してください」に従う)。
    private var homeHeader: some View {
        let logoTitleGap = V5P.ptToV5(6)
        let iconGap = V5P.ptToV5(12)
        let margin = V5P.ptToV5(16)
        let logoHeight = V5P.ptToV5(24)
        let logoWidth = logoHeight * (805.0 / 480.0)
        let notifIconSize = V5P.ptToV5(18.2)
        let accountIconSize = V5P.ptToV5(19.8)
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

    private static let changeUpColor = Color(red: 214.0 / 255, green: 83.0 / 255, blue: 109.0 / 255)
    private static let changeDownColor = Color(red: 46.0 / 255, green: 170.0 / 255, blue: 120.0 / 255)

    private static func importanceBadgeColors(_ importance: Importance) -> (fill: Color, border: Color) {
        switch importance {
        case .high:
            return (Color(red: 185.0 / 255, green: 13.0 / 255, blue: 60.0 / 255), Color(red: 230.0 / 255, green: 80.0 / 255, blue: 120.0 / 255))
        case .medium:
            return (Color(red: 190.0 / 255, green: 135.0 / 255, blue: 20.0 / 255), Color(red: 230.0 / 255, green: 180.0 / 255, blue: 70.0 / 255))
        case .low:
            return (Color(red: 15.0 / 255, green: 42.0 / 255, blue: 85.0 / 255), Color(red: 50.0 / 255, green: 100.0 / 255, blue: 180.0 / 255))
        }
    }

    @ViewBuilder private func statusBadge(_ text: String, colors: (fill: Color, border: Color)) -> some View {
        Text(text)
            .font(.system(size: 7, weight: .heavy))
            .foregroundStyle(.white)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(colors.fill, in: Capsule())
            .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
            .fixedSize()
    }

    /// HQ指摘(2026-10-03、8回目)「アイコンの色が全然違う」の実測値
    /// (RGB(0,226,251)≒`V5P.cyan`)をそのまま維持。
    private static let iconGlowShadow: (color: Color, radius: CGFloat) = (V5P.cyan.opacity(0.55), 1.2)

    private static let cardBorderColor = Color(red: 0.0 / 255, green: 140.0 / 255, blue: 210.0 / 255)

    private static let linkBlue = Color(red: 140.0 / 255, green: 180.0 / 255, blue: 247.0 / 255)

    private static let cardFill = Color(red: 0.0 / 255, green: 23.0 / 255, blue: 48.0 / 255)

    /// HQ指示(2026-10-03、9回目)の詳細レイアウト仕様より、852px幅の参考
    /// 画像からスケール3.641(852/234)で変換したV5ユニット値。
    /// コンテンツ幅782px→214.8≒215。
    private static let cardWidth: CGFloat = 215
    /// 角丸22px→6.04≒6(3カード共通)。
    private static let cardCornerRadius: CGFloat = 6

    private static let flagDiameter: CGFloat = 15

    // MARK: 通貨ペアカード (x=26,y=180,width=782,height=527 → height 527/3.641≒145)

    private static let pairsCardHeight: CGFloat = 145
    /// ヘッダー約102px→28.0。
    private static let pairsHeaderHeight: CGFloat = 28
    /// (527-102)px/3行/3.641≒38.9≒39。
    private static let pairRowHeight: CGFloat = 39

    // MARK: お気に入りカード (y=735,height=375 → 375/3.641≒103)

    private static let favoritesCardHeight: CGFloat = 103
    /// ヘッダー約114px→31.3≒31。
    private static let favoritesHeaderHeight: CGFloat = 31
    /// カード間約16px→4.4。
    private static let favoriteCardGap: CGFloat = 4.4
    /// 各カードwidth≈247px→67.8≒68、height≈242px→66.5≒66、
    /// corner radius≈18px→4.9≒5。
    private static let favoriteSubCardWidth: CGFloat = 68
    private static let favoriteSubCardHeight: CGFloat = 66
    private static let favoriteSubCardCornerRadius: CGFloat = 5

    // MARK: 直近の要人発言 (y=1139,height=481 → 481/3.641≒132)

    private static let speechesCardHeight: CGFloat = 132
    /// ヘッダー約96px→26.4≒26。
    private static let speechesHeaderHeight: CGFloat = 26
    /// 各行約128px→35.2≒35。
    private static let speechRowHeight: CGFloat = 35

    /// セクション間の余白。参考画像実測(カード1下端707px→カード2上端
    /// 735pxの差28px、カード2下端1110px→カード3上端1139pxの差29px)を
    /// 3.641で変換すると7.7-8.0ユニットで一貫している。
    private static let sectionGap: CGFloat = 8

    /// `loadedScreen`のカード一覧`ScrollView`に割り当てる実高さ。HQ指示
    /// 「画面を開いた時点で通貨ペア・お気に入りが見え、スクロールすると
    /// 直近の要人発言が見える」を満たすよう、通貨ペア+間隔+お気に入りの
    /// 合計がちょうど収まり、直近の要人発言はスクロールしないと現れない
    /// 高さにしている。
    private static let contentAreaHeight: CGFloat = pairsCardHeight + sectionGap + favoritesCardHeight + 4

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.timeZone = .current
        return formatter
    }()

    private var loadedScreen: some View {
        let pairs = Array(mappedPairs.prefix(3))
        let favorites = Array(viewModel.favoriteItems.prefix(3))
        let speeches = Array(viewModel.recentSpeeches.prefix(3))

        return V5Viewport {
            homeHeader

            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Self.sectionGap) {
                    if !pairs.isEmpty {
                        pairsCard(pairs)
                    }
                    if !favorites.isEmpty {
                        favoritesCard(favorites)
                    }
                    speechesCard(speeches)
                }
                .padding(.bottom, 16)
            }
            .frame(width: V5P.W, height: Self.contentAreaHeight, alignment: .top)
            .padding(.top, 53)
            .frame(width: V5P.W, height: V5P.H, alignment: .top)

            V5BottomBar(selected: $tabSelection)
        }
    }

    /// カードの外枠(塗り・枠線・角丸)。高さは呼び出し側が明示的に固定値で
    /// 渡す(HQ仕様のカードサイズをそのまま反映するため、内容に応じて
    /// 自然に伸縮する旧`homeCard`とは異なる)。
    @ViewBuilder private func cardShell(height: CGFloat, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .padding(.horizontal, 4)
        .frame(width: Self.cardWidth, height: height, alignment: .top)
        .background(RoundedRectangle(cornerRadius: Self.cardCornerRadius).fill(Self.cardFill))
        .overlay(
            RoundedRectangle(cornerRadius: Self.cardCornerRadius)
                .stroke(Self.cardBorderColor, lineWidth: 0.75)
                .shadow(color: Self.cardBorderColor.opacity(0.8), radius: 2)
        )
    }

    @ViewBuilder private func cardHeaderRow(title: String, height: CGFloat, @ViewBuilder icon: () -> some View, @ViewBuilder trailing: () -> some View) -> some View {
        HStack(spacing: 5) {
            icon()
            V5JPFont.text(title, size: 14, weight: .bold)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer()
            trailing()
        }
        .frame(height: height, alignment: .center)
        Divider().overlay(Self.cardBorderColor)
    }

    @ViewBuilder private func headerLink(_ text: String) -> some View {
        HStack(spacing: 2) {
            V5JPFont.text(text, size: 8).foregroundStyle(Self.linkBlue)
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Self.linkBlue)
        }
    }

    // MARK: - 通貨ペアカード

    @ViewBuilder private func pairsCard(_ pairs: [FXPairUI]) -> some View {
        cardShell(height: Self.pairsCardHeight) {
            cardHeaderRow(title: "通貨ペア", height: Self.pairsHeaderHeight) {
                HomeChartIcon().foregroundStyle(V5P.cyan).frame(width: 13, height: 12).shadow(color: Self.iconGlowShadow.color, radius: Self.iconGlowShadow.radius)
            } trailing: {
                headerLink("すべて見る")
            }
            ForEach(Array(pairs.enumerated()), id: \.element.id) { idx, pair in
                if idx > 0 { Divider().overlay(Self.cardBorderColor) }
                NavigationLink(value: AppRoute.chartAnalysis(fxPairId: pair.id, fxPairSymbol: pair.symbol)) {
                    pairRow(pair)
                }.buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private func pairRow(_ pair: FXPairUI) -> some View {
        HStack(spacing: 6) {
            HStack(spacing: 3) {
                CountryFlagView(currencyCode: pair.baseCurrency, diameter: Self.flagDiameter)
                CountryFlagView(currencyCode: pair.quoteCurrency, diameter: Self.flagDiameter)
            }
            Text(pair.displaySymbol).font(.system(size: 9, weight: .bold)).fixedSize()
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 2) {
                Text(pair.price).font(.system(size: 11, weight: .bold)).fixedSize()
                HStack(spacing: 1) {
                    Text(pair.change).font(.system(size: 7, weight: .semibold))
                    Image(systemName: pair.isUp ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 7))
                }
                .foregroundStyle(pair.isUp ? Self.changeUpColor : Self.changeDownColor)
            }
            .fixedSize()
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Self.linkBlue)
        }
        .foregroundStyle(.white)
        .frame(height: Self.pairRowHeight)
    }

    // MARK: - お気に入りカード

    @ViewBuilder private func favoritesCard(_ favorites: [HomeFavoriteItem]) -> some View {
        cardShell(height: Self.favoritesCardHeight) {
            cardHeaderRow(title: "お気に入り", height: Self.favoritesHeaderHeight) {
                Image(systemName: "star.fill").font(.system(size: 10, weight: .semibold)).foregroundStyle(V5P.cyan).shadow(color: Self.iconGlowShadow.color, radius: Self.iconGlowShadow.radius)
            } trailing: {
                NavigationLink(value: AppRoute.favoritesList) {
                    headerLink("すべて見る")
                }
            }
            HStack(alignment: .top, spacing: Self.favoriteCardGap) {
                ForEach(favorites) { item in
                    favoriteGridCard(item)
                }
            }
            .padding(.top, 3)
        }
    }

    @ViewBuilder private func favoriteGridCard(_ item: HomeFavoriteItem) -> some View {
        switch item {
        case .event(let id, let countryCode, _, let name, let importance, let releaseDatetime):
            NavigationLink(value: AppRoute.eventDetail(id: id)) {
                favoriteGridCardContent(countryCode: countryCode, name: name) {
                    dateRow(releaseDatetime)
                } footer: {
                    statusBadge(importance.rawValue, colors: Self.importanceBadgeColors(importance))
                }
            }.buttonStyle(.plain)
        case .indicator(let id, let countryCode, _, let name, let importance):
            NavigationLink(value: AppRoute.indicatorDetail(id: id)) {
                favoriteGridCardContent(countryCode: countryCode, name: name) {
                    EmptyView()
                } footer: {
                    statusBadge(importance.rawValue, colors: Self.importanceBadgeColors(importance))
                }
            }.buttonStyle(.plain)
        case .fxPair(let id, let symbol, let price, let change, let isUp):
            NavigationLink(value: AppRoute.chartAnalysis(fxPairId: id, fxPairSymbol: symbol)) {
                favoriteGridCardContent(countryCode: nil, name: symbol) {
                    Text(price).font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                } footer: {
                    HStack(spacing: 1) {
                        Text(change).font(.system(size: 7, weight: .semibold))
                        Image(systemName: isUp ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 7))
                    }
                    .foregroundStyle(isUp ? Self.changeUpColor : Self.changeDownColor)
                }
            }.buttonStyle(.plain)
        }
    }

    @ViewBuilder private func dateRow(_ date: Date) -> some View {
        HStack(spacing: 3) {
            Image(systemName: "calendar").font(.system(size: 7)).foregroundStyle(V5P.muted)
            Text(Self.favoriteDateFormatter.string(from: date)).font(.system(size: 7, weight: .medium)).foregroundStyle(V5P.muted)
        }
    }

    private static let favoriteDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "M/d HH:mm"
        formatter.timeZone = .current
        return formatter
    }()

    @ViewBuilder private func favoriteGridCardContent(
        countryCode: String?,
        name: String,
        @ViewBuilder subtitle: () -> some View,
        @ViewBuilder footer: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                if let countryCode {
                    CountryFlagView(countryCode: countryCode, diameter: Self.flagDiameter)
                }
                Spacer()
                Image(systemName: "star").font(.system(size: 10)).foregroundStyle(V5P.muted)
            }
            V5JPFont.text(name, size: 8, weight: .bold).foregroundStyle(.white).lineLimit(1)
            subtitle()
            footer()
        }
        .padding(5)
        .frame(width: Self.favoriteSubCardWidth, height: Self.favoriteSubCardHeight, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: Self.favoriteSubCardCornerRadius).fill(Self.cardFill))
        .overlay(RoundedRectangle(cornerRadius: Self.favoriteSubCardCornerRadius).stroke(Self.cardBorderColor.opacity(0.7), lineWidth: 0.5))
    }

    // MARK: - 直近の要人発言

    /// `HomeSpeechSummary`のドキュメントコメント参照 — `recentSpeeches`は
    /// バックエンドに該当APIが無いため常に空。このセクションは常に表示した
    /// 上で空状態を出す(架空データは出さない)。
    @ViewBuilder private func speechesCard(_ speeches: [HomeSpeechSummary]) -> some View {
        cardShell(height: Self.speechesCardHeight) {
            cardHeaderRow(title: "直近の要人発言", height: Self.speechesHeaderHeight) {
                Image(systemName: "quote.bubble.fill").font(.system(size: 10, weight: .semibold)).foregroundStyle(V5P.cyan).shadow(color: Self.iconGlowShadow.color, radius: Self.iconGlowShadow.radius)
            } trailing: {
                NavigationLink(value: AppRoute.speechList) {
                    headerLink("すべて見る")
                }
            }
            if speeches.isEmpty {
                V5JPFont.text("現在表示できる要人発言はありません", size: 8)
                    .foregroundStyle(V5P.muted)
                    .frame(maxWidth: .infinity, minHeight: Self.speechesCardHeight - Self.speechesHeaderHeight, alignment: .center)
            } else {
                ForEach(Array(speeches.enumerated()), id: \.element.id) { idx, speech in
                    if idx > 0 { Divider().overlay(Self.cardBorderColor) }
                    speechRow(speech)
                }
            }
        }
    }

    /// 表示内容は参考画像指定(左:国旗/発言者/発言要約/日時、右:対象通貨
    /// ペア/値動き/chevron)のうち、`HomeSpeechSummary`に実在するフィールド
    /// のみを使っている。「発言前価格」「現在価格」「中央銀行」は現在の
    /// モデルに無く、この回はAPI/DB/ビジネスロジックを変更しない方針の
    /// ため追加していない(存在しないデータを捏造しない原則を優先)。
    @ViewBuilder private func speechRow(_ speech: HomeSpeechSummary) -> some View {
        NavigationLink(value: AppRoute.speechDetail(id: speech.id)) {
            HStack(spacing: 6) {
                CountryFlagView(countryCode: speech.countryCode, diameter: Self.flagDiameter)
                VStack(alignment: .leading, spacing: 2) {
                    V5JPFont.text(speech.speakerName, size: 8, weight: .bold)
                    V5JPFont.text(speech.headline, size: 7, weight: .regular).foregroundStyle(V5P.muted).lineLimit(1)
                    Text(Self.timeFormatter.string(from: speech.statementDatetime)).font(.system(size: 6, weight: .medium)).foregroundStyle(V5P.muted)
                }
                Spacer(minLength: 4)
                if let symbol = speech.reactionFxSymbol, let change = speech.reactionChangePercent {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(symbol).font(.system(size: 7, weight: .bold))
                        Text(ValueFormat.percent(change, signed: true))
                            .font(.system(size: 7, weight: .semibold))
                            .foregroundStyle(change >= 0 ? Self.changeUpColor : Self.changeDownColor)
                    }
                }
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Self.linkBlue)
            }
            .foregroundStyle(.white)
            .frame(height: Self.speechRowHeight)
        }.buttonStyle(.plain)
    }

    private var mappedPairs: [FXPairUI] {
        viewModel.majorFxList.map(FXPairUI.init(major:))
    }
}

/// HQ指摘(2026-10-02、3回目)「通貨ペアや今日の重要イベントのアイコンが
/// 全く違います」の通貨ペア側。参考画像を実測すると、座標軸の無い
/// 「上昇する棒グラフ3本+その上に重なる上昇ジグザグ折れ線(先端が矢尻)」
/// という合成グリフで、SF Symbolsに一致するものが無かった。自前描画。
private struct HomeChartIcon: View {
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            HStack(alignment: .bottom, spacing: 1.3) {
                bar(heightFraction: 0.38)
                bar(heightFraction: 0.66)
                bar(heightFraction: 1.0)
            }
            trendLine
        }
    }

    @ViewBuilder private func bar(heightFraction: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 0.6)
            .fill(.foreground)
            .frame(width: 2.6, height: 11 * heightFraction)
    }

    private var trendLine: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let tail = CGPoint(x: 0, y: h * 0.66)
            let peak = CGPoint(x: w * 0.38, y: h * 0.30)
            let valley = CGPoint(x: w * 0.62, y: h * 0.46)
            let tip = CGPoint(x: w * 1.05, y: h * -0.08)
            let arrowBack = CGPoint(x: tip.x - w * 0.22, y: tip.y + h * 0.12)
            let arrowBelow = CGPoint(x: tip.x - w * 0.05, y: tip.y + h * 0.30)

            ZStack {
                Path { path in
                    path.move(to: tail)
                    path.addLine(to: peak)
                    path.addLine(to: valley)
                    path.addLine(to: tip)
                }
                .stroke(.foreground, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))

                Path { path in
                    path.move(to: tip)
                    path.addLine(to: arrowBack)
                    path.addLine(to: arrowBelow)
                    path.closeSubpath()
                }
                .fill(.foreground)
            }
        }
        .frame(width: 13, height: 12)
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
