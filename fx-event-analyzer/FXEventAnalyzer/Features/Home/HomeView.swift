import SwiftUI

/// SCR-004 ホーム画面。Real `GET /home` data.
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
/// 「今日の重要イベント」削除に伴い、Home経由でSCR-007 イベント詳細に
/// 遷移する唯一の導線(Homeのイベント行)が無くなった。SCR-007は
/// ui-screens.mdの必須画面であり続けるため、`IndicatorDetailView`の
/// 「次回発表予定」エリアから遷移できるよう新規配線した(実際に存在する
/// `nextScheduledEvent.id`を使うだけで、イベントやそのデータを捏造しては
/// いない)。UIの配線のみで、API/DB/ビジネスロジックは変更していない。
///
/// HQ指示(2026-10-03、画面構成全面更新)「Homeの通貨ペアカード/お気に入り
/// 通貨ペア → 現時点では遷移なし」: 旧SCR-011チャート分析(削除済み)への
/// 遷移を外し、表示のみの行にした(`pairRow`/`favoriteGridCard`の`.fxPair`
/// ケース参照)。通貨ペアそのものの詳細画面は今回追加しない。Homeに表示
/// する通貨ペアの編集はSCR-026(設定から遷移)で行う。
struct HomeView: View {
    @StateObject private var viewModel: HomeViewModel
    @Binding var path: NavigationPath
    @Binding var tabSelection: Int
    @ObservedObject private var notifications = NotificationsStore.shared
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
    ///
    /// HQ指示(2026-10-04)「デザインは変えずに、この画像のヘッダーとタブの
    /// 位置を固定としてください」: 新しいHome参考画像実測に基づき
    /// `V5PixelFrontend.swift`の`V5Header`側は`position(y:)`を40→37.8に
    /// 既に補正済みだが、Home画面はこの共有`V5Header`を使わず、ここの
    /// `homeHeader`という独自実装(ロゴ+ベル+アカウントアイコン)を持って
    /// おり、見落として未反映のままだった(実機キャプチャで「ホーム画面の
    /// ヘッダーだけ動いていない」ことに気づき修正)。`V5Header`と全く同じ
    /// 実測根拠(ヘッダー文字中心とコンテンツ1枚目カード上端の間隔、
    /// 参考画像27.8pt vs 旧実装24.2pt)のため、同じ量(-2.2pt=V5単位-2.15)
    /// だけ`position(y:)`を40→37.8に補正した。
    ///
    /// 追加調整(2026-10-04、HQ「ヘッダーをもう少し上に上げて欲しい」
    /// 「通知・アカウントアイコンを参考画像と同じデザイン・同じ大きさに」):
    /// 1. 位置: 37.8でもまだ参考画像より低いとのフィードバックを受け、
    ///    追加で3pt(V5単位1.75)引き上げて36.1に変更。
    /// 2. アイコン: 参考画像をPythonでピクセル実測した結果、
    ///    - ベルは白ではなくシアン(実測平均RGB(2,198,239)≒`V5P.cyan`)で、
    ///      右上に赤い通知ドット(実測平均RGB(252,40,85)、直径実測20px→
    ///      9.4pt)が付いている。現行実装は白一色・ドット無しだったため、
    ///      両方を追加した。
    ///    - サイズも実測し直した結果、ベル(実測高さ53px→25.0pt)の方が
    ///      アカウント(実測高さ50px→23.6pt)よりわずかに大きく、現行実装
    ///      (notifIconSize 18.2pt < accountIconSize 19.8pt、大小関係が逆)
    ///      とは大小関係ごと異なっていたため、両方の数値を実測値に置き換えた。
    ///    - アカウントアイコンの色も実測(平均RGB(133,175,233))すると白
    ///      ではなく薄い水色寄りだったため、専用の色に差し替えた。
    ///
    /// さらに追加(2026-10-04、HQ「通知があった場合に赤バッチがつく仕組みに
    /// して」): 常時表示だったドットを、`NotificationsStore.shared.hasUnread`
    /// がtrueの時だけ表示するよう変更した。通知機能自体はバックエンド未実装
    /// (`NotificationsStore`のドキュメントコメント参照)のため、現時点では
    /// 常にfalse=非表示のままになる。
    ///
    /// 4回目の調整(2026-10-04、HQ「アイコンとタイトルと通知マークとアイコン
    /// マークを参考画像と同じ位置に、もう少し上」「アイコンの大きさをもっと
    /// 大きく」「FXの文字が小さく見えるので大きく」): 参考画像を見直すと、
    /// 「FX」は「Event Analyzer」と同じ文字サイズの色違いではなく、はるかに
    /// 大きい独立したロゴ文字だった(実測: FX文字高さ64px→30.2pt、Event
    /// Analyzer文字高さ38px→17.9pt、比率≈1.68倍)。これまで両方とも同じ
    /// `.font()`を1回だけ適用していたため、「FX」が実際より小さく表示されて
    /// いた。Text連結の各セグメントに個別の`.font()`を付けられるSwiftUIの
    /// 性質を使い、「FX」だけ大きい専用フォントサイズに分離した。あわせて
    /// ベル・アカウント・ロゴアイコンも一回り拡大し、ヘッダー全体の位置も
    /// さらに2pt(V5単位1.16)上へ寄せた(36.1→34.9)。
    ///
    /// 直後に修正(2026-10-04、CI実機キャプチャで発覚): 上記の拡大で幅が
    /// 不足し、「Event Analyzer」が「Event Analy...」と省略記号で切れる
    /// 回帰が発生した。ロゴアイコン(30→22pt)・左右マージン(16→12pt)・
    /// ロゴとタイトルの間隔(6→4pt)・ベルとアカウントの間隔(12→8pt)を
    /// それぞれ詰めて必要な幅を確保した上、`.lineLimit(1)`+
    /// `.minimumScaleFactor(0.8)`を安全策として追加し、万一まだ収まらない
    /// 場合も省略記号ではなく等比縮小で収まるようにした。
    ///
    /// 5回目の調整(2026-10-04、HQ「アイコンもEvent AnalyzerもFXと同じ
    /// 大きさにして」): 参考画像の実測比率(FXがEvent Analyzerの約1.68倍)
    /// よりも、見た目の統一感を優先したいとのご指示のため、実測値ベースの
    /// 差を付けるのをやめ、タイトル文字(FX・Event Analyzerとも40pt)と
    /// アイコン(ベル・アカウント・ロゴとも40pt相当)を全て揃えた。402pt幅の
    /// ヘッダーに収めるため、左右マージン(12→8pt)・ロゴ/タイトル間隔
    /// (4→2pt)・ベル/アカウント間隔(8→4pt)をさらに詰めている。それでも
    /// 文字列全体(「FX Event Analyzer」)は40pt均一だと幅が足りないため、
    /// `.minimumScaleFactor`を0.8→0.55に広げ、必要な分だけ自動的に等比
    /// 縮小されるようにした(アイコン側は固定サイズのため、CI実機キャプチャ
    /// で実際に収まっているか要確認)。
    ///
    /// 6回目の調整(2026-10-04、HQ「通知アイコンとアカウントアイコンは
    /// 大きくしなくて良かった、戻して」「FX Event Analyzerは少し大きく」):
    /// ベル・アカウントは拡大前の、参考画像実測に基づく値(notifIconSize
    /// 25.0pt・accountIconSize 23.6pt、通知ドットも9.4ptへ)に戻した
    /// (ロゴアイコンは名指しされていないため40ptのまま)。逆にタイトル文字は
    /// (FX・Event Analyzerとも)40→44ptへ拡大。アイコン縮小で空いた幅を
    /// 活かし、左右マージン(8→12pt)・ロゴ/タイトル間隔(2→4pt)・
    /// ベル/アカウント間隔(4→8pt)も少し広げ直した。
    private static let accountIconColor = Color(red: 133.0 / 255, green: 175.0 / 255, blue: 233.0 / 255)
    private static let notificationDotColor = Color(red: 252.0 / 255, green: 40.0 / 255, blue: 85.0 / 255)

    /// 8回目の調整(2026-10-04、HQ「ロゴ削除・FXの文字を大きく、Event
    /// Analyzerを少し小さく・ヘッダー部分の背景を同じにして」): 参考画像を
    /// 見直すと、「FX」の左にあった山形チャートのロゴマーク(`BrandMark`)は
    /// 実在せず、「FX」の文字自体(グラデーション)がロゴを兼ねていると
    /// 判明したため削除した。あわせて参考画像を改めてピクセル実測
    /// (FX文字高さ61px→28.8pt、Event Analyzer文字高さ36px→17.0pt、
    /// 比率≈1.69倍 — 4回目の調整時の実測1.68倍とほぼ一致)した結果に基づき、
    /// 5回目の調整で統一した「FX・Event Analyzerとも44pt」をやめ、
    /// FXを44→56pt・Event Analyzerを44→34ptに変更した(ロゴ削除で空いた
    /// 幅も活用)。背景の斜めの光の筋はヘッダー部分専用の装飾として
    /// `homeHeaderStreak`を新設し、ヘッダーの背後(カード類より下のレイヤー)
    /// に重ねている(アプリ全体の背景は2026-10-02のHQ指示により単色のまま
    /// — ヘッダーのみのスコープとして実装)。
    ///
    /// 9回目の調整(2026-10-04、HQ「Event Analyzerが参考画像より大きい」
    /// 「Event AnalyzerをFXの中心に」「Xの後にスペース」「通知・アカウント
    /// アイコンのサイズを揃えて、間隔も広げて」「背景色を揃えて」): 参考画像
    /// をCI実機キャプチャと同じ手法で再実測し、ズレを数値で特定した。
    /// - FX:Event Analyzerの高さ比は参考画像で1.69倍だが、実機キャプチャでは
    ///   1.26倍(Event Analyzerが相対的に大きすぎた)。FXは変えず、Event
    ///   Analyzerのみ34→25ptに縮小して比率を揃えた。
    /// - 文字の連結(`Text`の`+`演算子)は共通ベースラインで揃うため、
    ///   フォントサイズの違う「FX」と「Event Analyzer」を混ぜると
    ///   Event Analyzerの見た目の中心がFXより下にずれる(実測20pxのズレ)。
    ///   `HStack(alignment: .center)`で別々の`Text`に分離し、各要素の中心を
    ///   揃える構成に変更した。
    /// - X-Event Analyzer間の間隔は参考画像実測27px→12.7pt(V5単位7.4)。
    ///   文字列内の半角スペース1文字ではなく、明示的な`.padding(.leading)`
    ///   に置き換えた。
    /// - ベル・アカウントアイコンは参考画像実測で高さ44px・幅40pxと完全に
    ///   同一(実測25.0pt/23.6ptという従来値は別の参考画像由来の誤差だった)。
    ///   実測値20.8ptに統一。間隔も実測50px→23.6pt(旧8ptから大幅に拡大)。
    /// - 背景色は参考画像実測RGB(1,21,41)に対し、現行`BackgroundPrimary`
    ///   (ダークモード)はRGB(10,14,26)で明確に異なっていたため、色定義
    ///   (`Resources/Assets.xcassets/BackgroundPrimary.colorset`)を実測値に
    ///   更新した(全画面共通のためHome以外にも反映される — 2026-10-02の
    ///   「単色背景にする」方針自体は変更せず、その単色の値を実測し直した
    ///   という位置づけ)。
    /// - 「FXの文字色がSplash画面と違う気がする」との指摘は、実機キャプチャの
    ///   ピクセル値を比較した結果、HomeとLogin/Splashの「FX」は
    ///   `brandTitleAccentF`/`X`トークンを共有しており実測RGB値も完全一致
    ///   (F=(5,250,255)、X側も一致)していることを確認した。コード上の相違は
    ///   無いため、ここでは変更していない(新しい光の筋の装飾が近くに
    ///   表示されるようになったことで、対比効果により視覚的な印象が変わった
    ///   可能性がある)。
    /// 11回目の調整(2026-10-04、HQ「通知マークとアイコンマークをもう少し
    /// 大きくして」「アイコンマークを通知マークに近づけて」「通知マークの
    /// 位置は固定」): ベル・アカウントとも20.8→23.0ptへ拡大し、間隔を
    /// 23.6→14.0ptへ詰めた。
    ///
    /// 「通知マークの位置は固定」の対応として、レイアウト構造を変更した。
    /// 旧実装は`HStack`内で`Spacer()`の後にベル→アカウントの順に並べ、
    /// 末尾のアカウントがフレーム右端にフラッシュする形で両者まとめて
    /// 右寄せされていた — この構成だと、間隔(`iconGap`)やアカウントの
    /// サイズを変えるとベルの位置もフレーム右端からの相対距離が変わって
    /// 一緒に動いてしまう(Spacerが伸縮して全体を押し出すため)。
    /// ベルだけ位置を固定したまま間隔だけ詰めるには、両者を独立して
    /// 右端からの距離で配置する必要があるため、タイトル行の`HStack`からは
    /// 完全に切り離し、`.overlay(alignment: .trailing)`配下の
    /// `ZStack(alignment: .trailing)`で各アイコンに個別の
    /// `.padding(.trailing:)`を与える方式に変更した。`bellTrailingMargin`
    /// (旧間隔23.6pt+旧アカウントサイズ20.8pt=44.4pt、フレーム右端から
    /// ベル右端までの距離)は拡大前と完全に同じ値のまま変えていないため、
    /// ベルの画面上の位置(右端)は今回のサイズ変更・間隔変更の影響を受けず
    /// 固定されている。アカウント側は`bellTrailingMargin`から新しい間隔・
    /// 新しいサイズを差し引いた値を使い、結果としてベルに近づく形になる。
    private var homeHeader: some View {
        let xToTitleGap = V5P.ptToV5(7.4)
        let margin = V5P.ptToV5(12)
        let fxTextSize = V5P.ptToV5(56.0)
        let titleTextSize = V5P.ptToV5(25.0)
        let notifIconSize = V5P.ptToV5(23.0)
        let accountIconSize = V5P.ptToV5(23.0)
        let notificationDotSize = V5P.ptToV5(9.4)
        let bellTrailingMargin = V5P.ptToV5(44.4)
        let iconGap = V5P.ptToV5(14.0)
        let accountTrailingMargin = bellTrailingMargin - iconGap - accountIconSize
        return HStack(alignment: .center, spacing: 0) {
            (
                Text("F").font(.system(size: fxTextSize, weight: .heavy)).foregroundStyle(DesignTokens.Colors.brandTitleAccentF)
                + Text("X").font(.system(size: fxTextSize, weight: .heavy)).foregroundStyle(DesignTokens.Colors.brandTitleAccentX)
            )
            Text("Event Analyzer")
                .font(.system(size: titleTextSize, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.leading, xToTitleGap)
            Spacer()
        }
        .lineLimit(1)
        .minimumScaleFactor(0.55)
        .foregroundStyle(.white)
        .frame(width: V5P.W - margin * 2, height: V5P.ptToV5(44))
        .overlay(alignment: .trailing) {
            ZStack(alignment: .trailing) {
                Image(systemName: "bell")
                    .font(.system(size: notifIconSize, weight: .semibold))
                    .foregroundStyle(V5P.cyan)
                    .overlay(alignment: .topTrailing) {
                        if notifications.hasUnread {
                            Circle()
                                .fill(Self.notificationDotColor)
                                .frame(width: notificationDotSize, height: notificationDotSize)
                                .offset(x: notificationDotSize * 0.3, y: -notificationDotSize * 0.1)
                        }
                    }
                    .padding(.trailing, bellTrailingMargin)
                Image(systemName: "person")
                    .font(.system(size: accountIconSize, weight: .semibold))
                    .foregroundStyle(Self.accountIconColor)
                    .padding(.trailing, accountTrailingMargin)
            }
        }
        .position(x: V5P.W / 2, y: 34.9)
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

    /// `loadedScreen`のカード一覧`ScrollView`に割り当てる実高さ — ヘッダー
    /// 下端(y=53、`padding(.top, 53)`と同じ値)からフッター上端
    /// (`V5BottomBar`の`barHeight`(40)+`bottomMargin`(4)より
    /// y=491-4-40=447)までのキャンバス残り全域(447-53=394)。
    ///
    /// HQ指摘(2026-10-03、9回目キャプチャ後)「お気に入りの下、タブバーの
    /// 上に大きな空白ができている」の調査で判明した構造的な制約と、それに
    /// 対するHQの最終方針(2026-10-03、10回目):
    ///
    /// 「通貨ペア+お気に入り」の合計高さ(256)はこのキャンバス残り全域
    /// (394)よりかなり小さく、その差(138)を「直近の要人発言を折り返し線
    /// より下に強制的に押し出す」ために空けると、ScrollViewの内側・外側
    /// どちらに置いても実機キャプチャ(静止画)上は同じ大きさの空白として
    /// 見えてしまう(ピクセル比較で確認済み)。HQの最終判断は「カード寸法・
    /// セクション間余白の実測精度を優先し、直近の要人発言を初期表示から
    /// 隠すための空白は作らない。Home全体を縦スクロール可能な構造にして
    /// おけば、スクロール位置の厳密な調整(何が初期表示で見えるか)は
    /// 今回求めない」というもの。
    ///
    /// そのため`loadedScreen`では高さを人為的に引き伸ばさず、3カードを
    /// 自然な順序で流し込んでいる。ScrollViewの表示領域はキャンバス全域
    /// (394)まで広げてあり、合計コンテンツ高さ(412、下部余白16込み)との
    /// 差はわずか18のみ — 将来お気に入りが3件に増える、直近の要人発言API
    /// が実装されて行数が増える等でコンテンツがこの高さを超えた場合は、
    /// このScrollViewがそのまま正しくスクロール可能になる(寸法は常に
    /// 現在のカードデザイン通りで変化しない)。
    private static let contentAreaHeight: CGFloat = 394

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
                // HQ指示(2026-10-03、画面構成全面更新)「Homeの通貨ペアカード
                // → 現時点では遷移なし」: 旧`.chartAnalysis`(削除済み)への
                // 遷移を外し、表示のみの行にした。通貨ペアそのものの詳細画面は
                // 今回追加しない方針(SCR-026ホーム通貨ペア編集は表示する通貨
                // ペアを選ぶ設定画面であり、通貨ペア詳細画面ではない)。
                pairRow(pair)
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
        case .fxPair(_, let symbol, let price, let change, let isUp):
            // HQ指示(2026-10-03、画面構成全面更新)「お気に入りの通貨ペア →
            // 現時点では遷移なし」: 旧`.chartAnalysis`(削除済み)への遷移を
            // 外した(このケース自体、`FavoritesStore.ItemType.fxPair`の
            // ドキュメントコメント参照の通り単体取得API/★が無く現状未使用)。
            favoriteGridCardContent(countryCode: nil, name: symbol) {
                Text(price).font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
            } footer: {
                HStack(spacing: 1) {
                    Text(change).font(.system(size: 7, weight: .semibold))
                    Image(systemName: isUp ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 7))
                }
                .foregroundStyle(isUp ? Self.changeUpColor : Self.changeDownColor)
            }
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

