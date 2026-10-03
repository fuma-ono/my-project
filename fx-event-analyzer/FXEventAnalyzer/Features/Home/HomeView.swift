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

    /// HQ指摘(2026-10-03、6回目、新しい参考画像)で実測すると「経済指標」
    /// バッジは赤系ではなく鮮やかな青(RGB(0,118,234)前後)だった。旧実装は
    /// 別の参考画像を基準にしていたため赤系(RGB(150,32,58))になっていた —
    /// 今回の実測値に差し替え。vipStatement/centralBankは参考画像に実例が
    /// 無いため、economicIndicatorの実測トーンに合わせた色のまま維持。
    var badgeColor: Color {
        switch self {
        case .economicIndicator: return Color(red: 0.0 / 255, green: 118.0 / 255, blue: 234.0 / 255)
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

    private static let changeUpColor = Color(red: 214.0 / 255, green: 83.0 / 255, blue: 109.0 / 255)
    private static let changeDownColor = Color(red: 46.0 / 255, green: 170.0 / 255, blue: 120.0 / 255)

    /// HQ指摘(2026-10-02、3回目)「HIGHの文字の色や大きさも全然違います」:
    /// 旧実装は既存`V5Badge`(半透明塗り+枠線と同色の文字)を流用していたが、
    /// 参考画像を再実測すると実際は「濃い塗り+白に近い太字」という別物
    /// だった。このカード専用の塗りつぶしバッジ(`statusBadge`)に差し替えた。
    /// HQ指摘(2026-10-03、6回目、新しい参考画像)「HIGHやMEDIUMの文字が
    /// 大きいしフォントも違う」: 新しい参考画像を実測すると、塗り色自体も
    /// 前回の実測(別の参考画像基準)よりかなり明るく鮮やかだった
    /// (HIGH塗り≈RGB(185,13,60)、MEDIUM塗り≈RGB(190,135,20))。実測値に
    /// 差し替え、枠線もそれぞれの塗りを薄く明るくした色にした。
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

    /// 新しい参考画像実測(2026-10-03、6回目): バッジ文字自体の高さは
    /// 約18px≒V5換算5ユニットで、旧フォントサイズ8はそれよりかなり大きい
    /// (ユーザー指摘「文字が大きい」と一致)。7に縮小。
    @ViewBuilder private func statusBadge(_ text: String, colors: (fill: Color, border: Color)) -> some View {
        Text(text)
            .font(.system(size: 7, weight: .heavy))
            .foregroundStyle(.white)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(colors.fill, in: Capsule())
            .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
    }

    /// 参考画像のカルーセル/通貨ペアアイコン実測(上端≈RGB(120,185,250)寄りの
    /// 明るい水色→下端≈RGB(50,115,195)寄りの中間の青)。
    private static let iconGradient = LinearGradient(
        colors: [Color(red: 120.0 / 255, green: 185.0 / 255, blue: 250.0 / 255), Color(red: 50.0 / 255, green: 115.0 / 255, blue: 195.0 / 255)],
        startPoint: .top, endPoint: .bottom
    )

    /// HQ指摘(2026-10-02、3回目)「枠の形と色が違います」: 参考画像を
    /// Pythonでピクセル実測(カード幅938px≒V5の214ユニットから逆算した
    /// スケール0.2282を使用)した結果、枠のピーク輝度ピクセルはRGB(31-36,
    /// 46-52,69-77)という彩度の低いくすんだ紺色だった — という過去の実測
    /// だったが、HQ指摘(2026-10-03、6回目、新しい参考画像)「全体枠の形、
    /// 枠内の色が全く違います」で改めて実測すると、実際は彩度の低い紺色では
    /// なく発光する鮮やかなシアン系の枠線(ピーク≈RGB(0,116,168))だった。
    /// 当時の参考画像の解像度/圧縮でくすんで見えていた可能性が高い。今回の
    /// 実測値に差し替え、発光感を`.shadow`で近似した。
    /// 角丸も再実測すると半径≈16px(V5換算4.4ユニット)あり、旧cornerRadius
    /// 3はかなり角ばりすぎていた。5に変更。
    private static let cardBorderColor = Color(red: 0.0 / 255, green: 140.0 / 255, blue: 210.0 / 255)
    private static let cardCornerRadius: CGFloat = 5

    /// ヘッダーの日付/"すべて見る"リンクや各行末尾の chevron で共通に使う、
    /// 新しい参考画像実測の明るい水色(≈RGB(140,180,247))。旧実装は
    /// `V5P.muted`(RGB(153,178,209)、くすんだグレー寄り)を流用していたが、
    /// 実測するとどのchevron/リンクテキストも一貫してこの鮮やかな水色
    /// だった。
    private static let linkBlue = Color(red: 140.0 / 255, green: 180.0 / 255, blue: 247.0 / 255)

    private static var todayLabel: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "M/d（E）"
        formatter.locale = Locale(identifier: "ja_JP")
        return formatter.string(from: Date())
    }

    /// HQ指示(2026-10-02)「今日の重要イベントと通貨ペアを参考画像通りに」の
    /// 確認で、CI実機キャプチャにて`ValueFormat.time`(端末ロケール依存の
    /// `.timeStyle = .short`)がCIのロケールでは「11:21 AM」のように改行を
    /// 伴う形式になり、時刻列が2行に割れていた(参考画像は「21:30」の24時間
    /// 表記)。ロケールに依存しない24時間表記の専用フォーマッタに差し替えた。
    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.timeZone = .current
        return formatter
    }()

    private var loadedScreen: some View {
        let topEvents = Array(mappedTodayEvents.prefix(3))
        let pairs = Array(mappedPairs.prefix(3))
        let favorites = Array(viewModel.favoriteItems.prefix(3))

        return V5Viewport {
            homeHeader

            // HQ指摘(2026-10-03、6回目)「お気に入りを作成してください」で
            // 新規追加したグリッドカードにより、4カード合計の高さが
            // `V5Viewport`の固定キャンバス(234×491、スクロール無し)に
            // 収まりきらず、CI実機キャプチャで実際に「お気に入り」カードの
            // 下側と「直近の要人発言」カードが`V5BottomBar`の裏に隠れて
            // しまう不具合が実際に発生した(ピクセル実測で確認済み、数値上の
            // 見積もりではない)。他画面にも影響する`V5Viewport`自体や
            // `V5BottomBar`の仕様は変えず、Home固有のカード一覧だけを
            // `ScrollView`に包み、ヘッダーとタブバーの間の実高さに収める形に
            // した — ヘッダー/タブバーの位置・他画面の挙動は一切変えていない。
            ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 10) {
                if !topEvents.isEmpty {
                    homeCard {
                        cardHeader(title: "今日の重要イベント") {
                            Image(systemName: "calendar").font(.system(size: 11, weight: .bold)).foregroundStyle(Self.iconGradient).shadow(color: V5P.cyan.opacity(0.9), radius: 3)
                        } trailing: {
                            NavigationLink(value: AppRoute.calendar) {
                                headerLink(Self.todayLabel)
                            }
                        }
                        ForEach(Array(topEvents.enumerated()), id: \.element.id) { idx, event in
                            if idx > 0 { Divider().overlay(Self.cardBorderColor) }
                            NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                                eventRow(event)
                            }.buttonStyle(.plain)
                        }
                    }
                }

                if !pairs.isEmpty {
                    homeCard {
                        cardHeader(title: "通貨ペア") {
                            HomeChartIcon().foregroundStyle(Self.iconGradient).frame(width: 13, height: 12).shadow(color: V5P.cyan.opacity(0.9), radius: 3)
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

                if !favorites.isEmpty {
                    homeCard {
                        cardHeader(title: "お気に入り") {
                            Image(systemName: "star.fill").font(.system(size: 10, weight: .semibold)).foregroundStyle(V5P.cyan).shadow(color: V5P.cyan.opacity(0.9), radius: 3)
                        } trailing: {
                            NavigationLink(value: AppRoute.favoritesList) {
                                headerLink("すべて見る")
                            }
                        }
                        // HQ指摘(2026-10-03、6回目、新しい参考画像)「お気に入りの
                        // レイアウトが違う」: 参考画像は縦並びの行リストではなく、
                        // カード内に国旗+アウトライン星+名称+日付/価格+バッジを
                        // 持つ小カードを3列横並びにしたグリッドだった。
                        // `favoriteRow`(行リスト)を`favoriteGridCard`(3列グリッド)
                        // に差し替え。
                        HStack(alignment: .top, spacing: 4) {
                            ForEach(favorites) { item in
                                favoriteGridCard(item)
                            }
                        }
                    }
                }

                // HQ指示(2026-10-02、訂正)「直近の要人発言は独立セクションの
                // まま維持、架空データは絶対に表示しないこと」。
                // `recentSpeeches`は常に空(`HomeSpeechSummary`参照)なので、
                // このカードは常に表示した上で空状態を出す(セクション自体を
                // 隠さない選択。「発言→値動き分析」への主要導線のため)。
                homeCard {
                    cardHeader(title: "直近の要人発言") {
                        Image(systemName: "quote.bubble.fill").font(.system(size: 10, weight: .semibold)).foregroundStyle(V5P.cyan).shadow(color: V5P.cyan.opacity(0.9), radius: 3)
                    } trailing: {
                        NavigationLink(value: AppRoute.speechList) {
                            headerLink("すべて見る")
                        }
                    }
                    if viewModel.recentSpeeches.isEmpty {
                        V5JPFont.text("現在表示できる要人発言はありません", size: 8)
                            .foregroundStyle(V5P.muted)
                            .padding(.vertical, 4)
                    } else {
                        ForEach(Array(viewModel.recentSpeeches.prefix(3).enumerated()), id: \.element.id) { idx, speech in
                            if idx > 0 { Divider().overlay(Self.cardBorderColor) }
                            speechRow(speech)
                        }
                    }
                }
            }
            .padding(.bottom, 16)
            }
            .frame(width: V5P.W, height: Self.contentAreaHeight, alignment: .top)
            .padding(.top, 58)
            .frame(width: V5P.W, height: V5P.H, alignment: .top)

            V5BottomBar(selected: $tabSelection)
        }
    }

    /// 参考画像のカード(角丸の大きい矩形、アイコン+タイトル+右側アクション
    /// のヘッダー、区切り線付きの行リスト)。`V5Card`と違い高さを固定値で
    /// 指定せず、中身(行数・2行テキストの実際の高さ)に応じて自然に決まる
    /// `VStack`にした。
    /// HQ指摘(2026-10-02、4回目)「枠内の色が全然違うので参考画像と同じに
    /// してください」: 並行セッション(`claude/fx-settings-screens`)が同じ
    /// 参考画像のカード内部を100点実測して到達した最頻値`#061A35`
    /// (≈RGB 6,26,53、Settings/Account系カードに統一済み)と同じ値に
    /// 差し替えた。旧実装の`V5P.panel2→V5P.panel`グラデーション
    /// (≈RGB(4,25,47)→(2.5,19,37))は実測よりだいぶ暗く、色味も違って
    /// いた。
    /// HQ指摘(2026-10-03、5回目、新しい参考画像)「まだ枠内の色が参考画像と
    /// 異なっています」: 新しい参考画像をPythonでピクセル実測した結果、
    /// カード内部の最頻値は`#001730`(≈RGB 0,23,48、イベント/通貨ペア/
    /// お気に入りの3カードで一貫)で、`#061A35`より赤成分が強く明るすぎた。
    /// 実測値に差し替えた。
    private static let cardFill = Color(red: 0.0 / 255, green: 23.0 / 255, blue: 48.0 / 255)

    /// HQ指摘(2026-10-03、5回目)「サイズを合わせてください」: 新しい参考
    /// 画像をピクセル実測(画面全幅852px≒V5の234ユニットからスケール
    /// 3.64を算出し、カード実測幅806pxを逆算)すると、カード幅はV5換算で
    /// 約221ユニットだった(画面端からの余白が従来の214より狭い)。
    private static let cardWidth: CGFloat = 221

    /// 同じ実測(2026-10-03、5回目)で、行内の国旗の直径を画面全幅スケール
    /// から逆算すると約63px≒V5換算17ユニットで、従来の13より一回り大きい。
    /// イベント行・通貨ペア行・お気に入り行・要人発言行、全てこの値に統一。
    private static let flagDiameter: CGFloat = 17

    /// `loadedScreen`のカード一覧`ScrollView`に割り当てる実高さ。ヘッダー
    /// 下端(`padding(.top,58)`)から`V5BottomBar`上端(`V5P.H - bottomMargin
    /// (4) - barHeight(40)` = 447、`V5PixelFrontend.swift`参照)までの間を
    /// 使い、タブバーとの間に少し余白(5)を残す。
    private static let contentAreaHeight: CGFloat = 447 - 58 - 5

    /// HQ指摘(2026-10-03、7回目)「通貨ペアのタイトル部分の縦幅の枠が
    /// 大きい」: 原因をピクセル実測で特定した。`cardHeader`はヘッダーの
    /// `HStack`と`Divider()`を2つの別要素として返しており、これが
    /// `homeCard`の`VStack(spacing: 8)`の直接の子になる。`VStack`の
    /// `spacing`は子要素の「全ての」隣接ペアに効くため、区切り線1本につき
    /// 上下で8+8=16ユニットもの間隔が付いていた(通貨ペアカードは区切り線
    /// 3本分で間隔だけで48ユニット)。実際、参考画像をピクセル実測すると
    /// 通貨ペアカードのヘッダー部(カード上端から最初の区切り線まで)は
    /// 26.0ユニットなのに対し、旧実装は37.2ユニットあった。
    /// `spacing`を3に縮め、`padding`も10→8に詰めて実測値に近づけた。
    @ViewBuilder private func homeCard(@ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            content()
        }
        .padding(8)
        .frame(width: Self.cardWidth, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: Self.cardCornerRadius).fill(Self.cardFill))
        .overlay(
            RoundedRectangle(cornerRadius: Self.cardCornerRadius)
                .stroke(Self.cardBorderColor, lineWidth: 0.75)
                .shadow(color: Self.cardBorderColor.opacity(0.8), radius: 2)
        )
    }

    /// HQ指摘(2026-10-02、3回目)「通貨ペアや今日の重要イベントのアイコンが
    /// 全く違います」: アイコン名の`String`ではなく任意の`View`を受け取る形に
    /// 変更した — 「今日の重要イベント」は引き続きSF Symbol`calendar`だが
    /// `Self.iconGradient`で着色し直し、「通貨ペア」はSF Symbolに該当する
    /// グリフが無い(参考画像実測: 棒グラフ3本+上昇矢印の合成アイコンで、
    /// `chart.line.uptrend.xyaxis`のような座標軸は一切無い)ため、自前描画の
    /// `HomeChartIcon`に差し替えた。タイトルも`V5JPFont.text`(フッター/
    /// タブバーと同じ`NotoSansJP-SemiBold`)に統一。
    /// HQ指摘(2026-10-03、6回目、新しい参考画像)「今日の重要イベントの
    /// タイトルの文字の大きさが小さいです」: 実測するとタイトル文字の高さは
    /// 約51px≒V5換算14ユニットだったが、実機キャプチャで確認すると
    /// サイズ14は日付/chevronと並んだ時にカード幅に収まりきらず、
    /// `HStack`内の`Text`既定の挙動(折り返さず「...」で切り詰める)により
    /// タイトル自体が「今日の重要イベ...」と見切れてしまっていた。
    /// `.lineLimit(1).minimumScaleFactor(...)`で、収まりきらない時は
    /// 自動縮小して全文字を必ず表示する(切り詰めない)方式にした。
    @ViewBuilder private func cardHeader(title: String, @ViewBuilder icon: () -> some View, @ViewBuilder trailing: () -> some View) -> some View {
        HStack(spacing: 5) {
            icon()
            V5JPFont.text(title, size: 14, weight: .bold)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer()
            trailing()
        }
        Divider().overlay(Self.cardBorderColor)
    }

    /// HQ指摘(2026-10-03、6回目、新しい参考画像)「＞の大きさが全く違うので
    /// 大きくしてください」: 日付・「すべて見る」のリンクテキストと末尾の
    /// chevronをまとめた共通部品。実測するとchevronの見た目の高さは約24px
    /// (V5換算6.6ユニット)で、SF Symbolの実寸比(フォントサイズの約7割)から
    /// 逆算したフォントサイズは約9 — 旧6よりかなり大きい。色も旧`V5P.muted`
    /// (くすんだグレー)ではなく、実測した鮮やかな水色`linkBlue`に統一。
    @ViewBuilder private func headerLink(_ text: String) -> some View {
        HStack(spacing: 2) {
            V5JPFont.text(text, size: 7).foregroundStyle(Self.linkBlue)
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Self.linkBlue)
        }
    }

    /// HQ指摘(2026-10-03、6回目、新しい参考画像)で実測した修正4点:
    /// - 時刻の位置が上寄りだった → `HStack(alignment: .top)`をやめ`.center`
    ///   にし、行全体(国旗・カテゴリ/名称・バッジ)と縦中心を揃えた。
    /// - 時刻の文字が小さく色もくすんでいた → 実測(白・太字・約8pt相当)に
    ///   合わせ、色を`V5P.muted`→`.white`、ウェイトを`.medium`→`.heavy`に。
    /// - 「経済指標」バッジの横幅が参考画像より広く、名称
    ///   (「米国雇用統計(非農業部門雇用者数)」等)が`lineLimit(1)`で
    ///   見切れていた → 最初`lineLimit`指定なしで折り返しを狙ったが、
    ///   CI実機キャプチャで確認すると、バッジと同じ`HStack`内に置いた
    ///   `Text`はSwiftUIの既定動作で折り返さず「...」に切り詰められる
    ///   ままだった(`HStack`の子は、収まりきらない時デフォルトで折り返し
    ///   ではなく省略記号を選ぶ)。バッジと名称は参考画像通り同じ行に
    ///   残しつつ、名称側に`.fixedSize(horizontal: false, vertical: true)`
    ///   を付けることで「幅を切り詰めて1行に収めようとせず、必要なら行を
    ///   増やして折り返す」よう指示した — 短い名称は従来通り1行のまま、
    ///   長い名称の時だけその行が2行に伸びる(バッジを別行に分離する案も
    ///   試したが、全イベントの行が一律で高くなり`V5Viewport`の非スクロール
    ///   な固定キャンバス(234×491)に収まりきらずタブバーと重なってしまった
    ///   ため、高さへの影響が最小限なこちらを採用)。
    /// - ＞の位置がHIGH/MEDIUMバッジの下ではなく右端の横並びだった →
    ///   `VStack(badge, chevron)`から`HStack(badge, chevron)`に変更。
    @ViewBuilder private func eventRow(_ event: HomeEventSummary) -> some View {
        HStack(alignment: .center, spacing: 5) {
            Text(Self.timeFormatter.string(from: event.releaseDatetime))
                .font(.system(size: 8, weight: .heavy))
                .foregroundStyle(.white)
                .fixedSize(horizontal: true, vertical: false)
                .frame(width: 26, alignment: .leading)

            VStack(spacing: 2) {
                CountryFlagView(countryCode: event.countryCode, diameter: Self.flagDiameter)
                Text(event.currencyCode).font(.system(size: 6, weight: .semibold)).foregroundStyle(V5P.muted)
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .top, spacing: 5) {
                    V5JPFont.text(event.homeCategory.label, size: 6, weight: .bold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4).padding(.vertical, 2)
                        .background(event.homeCategory.badgeColor, in: Capsule())
                        .fixedSize()
                    V5JPFont.text(event.indicatorName, size: 9, weight: .bold)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let subtitle = Self.eventSubtitle(event) {
                    V5JPFont.text(subtitle, size: 6.5, weight: .regular).foregroundStyle(V5P.muted)
                }
            }
            // HQ指摘(2026-10-03、7回目)「きちんと計測し」を受けて実機
            // キャプチャをピクセル実測したところ、「FOMC政策金利」のような
            // 短い名称まで2行に折り返されていた。原因は`Spacer`が
            // `HStack`のレイアウト計算で最優先的に残り幅を確保する
            // ため、同じ優先度の名称`Text`が先に幅を切り詰められて
            // いたこと(実測: 折り返し位置の右に、名称があと2-3文字入る
            // 空白がそのまま空いていた)。この`VStack`に`.layoutPriority(1)`
            // を付け、`Spacer`より先に必要幅を確保させた。
            .layoutPriority(1)

            Spacer(minLength: 4)

            HStack(spacing: 6) {
                statusBadge(event.importance.rawValue, colors: Self.importanceBadgeColors(event.importance))
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Self.linkBlue)
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
        // HQ指示(2026-10-02)「通貨ペアを参考画像通りに」の確認で、CI実機
        // キャプチャにて価格("155.42"等)と変動率("+0.25%"等)が2行に
        // 折り返されていた(カード幅214に対しシンボル/価格/変動率/chevron
        // が収まりきらなかった)。折り返させたくないテキストに
        // `.fixedSize(horizontal: true, vertical: false)`を付け、合わせて
        // フォントサイズと間隔を詰めて実測で調整した。
        HStack(spacing: 5) {
            // HQ指摘(2026-10-02、4回目)「通貨ペアの国旗は重なってるので
            // 間隔を開けてください」: 負のスペーシング(-6)で2つの国旗が
            // 重なっていたのを、正のスペーシングに変更して離した。
            HStack(spacing: 3) {
                CountryFlagView(currencyCode: pair.baseCurrency, diameter: Self.flagDiameter)
                CountryFlagView(currencyCode: pair.quoteCurrency, diameter: Self.flagDiameter)
            }
            Text(pair.displaySymbol).font(.system(size: 8, weight: .bold)).fixedSize(horizontal: true, vertical: false)
            Spacer(minLength: 2)
            Text(pair.price).font(.system(size: 10, weight: .bold)).fixedSize(horizontal: true, vertical: false)
            // HQ指摘(2026-10-03、6回目、新しい参考画像)「🔺の位置は0.32%の
            // 右にして大きさも違う」: 三角アイコンが変動率の前にあったのを
            // 後ろに入れ替えた。
            HStack(spacing: 1) {
                Text(pair.change).font(.system(size: 7, weight: .semibold))
                Image(systemName: pair.isUp ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 7))
            }
            .fixedSize(horizontal: true, vertical: false)
            .foregroundStyle(pair.isUp ? Self.changeUpColor : Self.changeDownColor)
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Self.linkBlue)
        }
        .foregroundStyle(.white)
    }

    /// HQ指摘(2026-10-03、6回目、新しい参考画像)「お気に入りのアイコンが
    /// 全く違う」「通貨ペアの下にお気に入りを作成してください」: 参考画像の
    /// お気に入りは行リストではなく、カード内に国旗+アウトライン星+名称+
    /// 日付(または価格)+バッジ(または変動率)を持つ小カード3枚を横並びに
    /// したグリッドだった。`favoriteGridCard`に全面差し替え。
    /// お気に入り自体を表示させるには`FavoritesStore`(端末ローカル)に
    /// 実際に1件以上登録されている必要がある — `ScreenshotTests.swift`で
    /// 実際に★をタップしてから戻る操作を追加し、架空データではなく実在の
    /// モックイベントを本当にお気に入り登録する形にした。
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
        .frame(width: (Self.cardWidth - 16 - 8) / 3, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 4).fill(Self.cardFill))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Self.cardBorderColor.opacity(0.7), lineWidth: 0.5))
    }

    /// `HomeSpeechSummary`のドキュメントコメント参照 — 実データは一切流れて
    /// 来ないため、CIキャプチャ等では描画されない。バックエンドに要人発言
    /// APIが追加された時にそのまま使える受け皿として用意している。
    @ViewBuilder private func speechRow(_ speech: HomeSpeechSummary) -> some View {
        NavigationLink(value: AppRoute.speechDetail(id: speech.id)) {
            HStack(alignment: .top, spacing: 5) {
                Text(Self.timeFormatter.string(from: speech.statementDatetime))
                    .font(.system(size: 7, weight: .medium))
                    .foregroundStyle(V5P.muted)
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(width: 19, alignment: .leading)
                CountryFlagView(countryCode: speech.countryCode, diameter: Self.flagDiameter)
                VStack(alignment: .leading, spacing: 3) {
                    V5JPFont.text(speech.speakerName, size: 8, weight: .bold)
                    V5JPFont.text(speech.headline, size: 7, weight: .regular).foregroundStyle(V5P.muted).lineLimit(1)
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

/// HQ指摘(2026-10-02、3回目)「通貨ペアや今日の重要イベントのアイコンが
/// 全く違います」の通貨ペア側。参考画像を実測すると、座標軸の無い
/// 「上昇する棒グラフ3本+その上に重なる上昇ジグザグ折れ線(先端が矢尻)」
/// という合成グリフで、SF Symbolsに一致するものが無かった(以前`V5BottomBar`
/// の「分析」タブアイコンで座標軸付きの`chart.line.uptrend.xyaxis`が却下
/// された時と同じ理由)。`V5PixelFrontend.swift`の`V5BarsIcon`/
/// `V5AnalysisIcon`と同じ発想(棒+ジグザグ矢印の自前描画)だが、どちらも
/// その`private`なためこのファイルから再利用できず、Home専用に新規作成した。
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
