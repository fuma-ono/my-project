import SwiftUI

/// SCR-004 ホーム画面。Real `GET /home` data.
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5Home` (fixed 234×491 coordinate space via
/// `V5Viewport`), reproduced as given.
///
/// HQ指示(2026-10-03、9回目、新しい参考画像+詳細レイアウト仕様)「今回の
/// ホーム画面UIは添付した参考画像を基準に実装してください」「今日の重要
/// イベントはホームから削除します」: 当時はこれまでの4セクション構成
/// (今日の重要イベント/通貨ペア/お気に入り/直近の要人発言)から「今日の
/// 重要イベント」を完全に削除し、3セクション構成に変更していた。
///
/// HQ指示(2026-10-06、15回目)「ホーム画面での上からの表示順は今日の重要
/// イベントと通貨ペアとお気に入り、直近の要人発言が来るようにして
/// ください」: 「今日の重要イベント」セクションを復元し、4セクション構成
/// に戻した。
/// 1. 今日の重要イベント — これから発生する重要イベント(`HomeViewModel.
///    upcomingEvents`、SCHEDULEDのみ)。
/// 2. 通貨ペア
/// 3. お気に入り
/// 4. 直近の要人発言(スクロール後に表示)
///
/// `HomeViewModel.upcomingEvents`自体は9回目の変更時もView側が参照を
/// やめただけで削除されておらず、データ層は変更していない(新規API呼び出し
/// 無し)。行のデザイン(時刻・国旗・種別バッジ・名称・予想/前回・重要度
/// バッジ・chevron)は削除前の実装を、現行のカード共通部品(`cardShell`/
/// `cardHeaderRow`)に合わせて再構成した。タップでSCR-007 イベント詳細
/// (`AppRoute.eventDetail`)へ遷移する導線も復元した — 9回目の変更で
/// `IndicatorDetailView`の「次回発表予定」エリアに新設した遷移はそのまま
/// 残しており、Home側の行が2つ目の実在する導線として追加される形になる
/// (片方を置き換えるものではない)。
///
/// HQ指定の参考画像(852×1846px)のレイアウト値を、画面全幅852px≒V5の
/// 234ユニットから算出したスケール3.641(852/234)で比例変換して反映して
/// いる — 絶対pxをそのままSwiftUIに入れてはいない。各カードのwidth/
/// height/corner radius等、変換後の値は各定数のコメントに記載。「今日の
/// 重要イベント」カードは9回目の削除時点で参考画像に対応する実測値が
/// 存在しなかったため、他3カードの実測値(ヘッダー高さ28、行の縦積み
/// テキストを収める行高さ)に合わせて再構成した数値を使っている。
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

    /// HQ指示(2026-10-05、22回目)「背景画像とヘッダーとタブを全画面に反映して」:
    /// 読み込み中・エラー・未設定状態は単色(`backgroundPrimary`)のみで
    /// `V5Viewport`(背景画像)・ヘッダー・タブバーを経由しておらず、`.loaded`
    /// 状態とは見た目が分断されていた(12回目の全画面背景展開がこの分岐には
    /// 反映されていなかった)。`homeHeader`はロード済みデータに依存しないため
    /// そのまま使い回し、`V5Viewport`/`V5BottomBar`で`loadedScreen`と同じ外枠に
    /// 揃えた。
    @ViewBuilder private func loadingScaffold(@ViewBuilder content: @escaping () -> some View) -> some View {
        V5Viewport {
            homeHeader
            content()
                .frame(width: V5P.W, height: Self.contentAreaHeight, alignment: .center)
                .padding(.top, 53)
                .frame(width: V5P.W, height: V5P.H, alignment: .top)
            V5BottomBar(selected: $tabSelection)
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
                // HQ指示(2026-10-05): ベルから通知一覧を開く。
                NavigationLink(value: AppRoute.notifications) {
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
                }
                .buttonStyle(.plain)
                .accessibilityLabel("通知")
                .accessibilityValue(notifications.hasUnread ? "未読あり" : "")
                .padding(.trailing, bellTrailingMargin)
                Image(systemName: "person")
                    .font(.system(size: accountIconSize, weight: .semibold))
                    .foregroundStyle(Self.accountIconColor)
                    .padding(.trailing, accountTrailingMargin)
            }
        }
        .position(x: V5P.W / 2, y: 34.9)
    }

    /// HQ指示(2026-10-05、23回目)「赤文字と緑文字が薄いので参考画像にして」
    /// で一旦`V5P.red`/`V5P.green`(アプリ共通トークン)に統一し、続くHQ
    /// 再指摘(2026-10-05)「+0.25%の赤文字と緑文字を濃くして」でさらに濃い
    /// (暗い)専用色(210,18,55)/(0,160,125)に変更していたが、HQ再指摘
    /// (2026-10-05、4回目)「もう少し発行(発光)色みたいに明るくさせて、
    /// 薄くさせるのではない」で方向転換: 「濃い=暗い」ではなく「明るい・
    /// 鮮やか」を求めていたと判明したため、ネオンのような高輝度の色に
    /// 変更した(`pairRow`側に追加したグローシャドウは、HQ再指摘
    /// (2026-10-05、5回目)「-0.14%のグローが強いから無くして」で削除済み)。
    private static let changeUpColor = Color(red: 255.0 / 255, green: 45.0 / 255, blue: 95.0 / 255)
    private static let changeDownColor = Color(red: 20.0 / 255, green: 235.0 / 255, blue: 165.0 / 255)

    static func importanceBadgeColors(_ importance: Importance) -> (fill: Color, border: Color) {
        switch importance {
        case .high:
            return (Color(red: 185.0 / 255, green: 13.0 / 255, blue: 60.0 / 255), Color(red: 230.0 / 255, green: 80.0 / 255, blue: 120.0 / 255))
        case .medium:
            return (Color(red: 190.0 / 255, green: 135.0 / 255, blue: 20.0 / 255), Color(red: 230.0 / 255, green: 180.0 / 255, blue: 70.0 / 255))
        case .low:
            return (Color(red: 15.0 / 255, green: 42.0 / 255, blue: 85.0 / 255), Color(red: 50.0 / 255, green: 100.0 / 255, blue: 180.0 / 255))
        }
    }

    /// HQ再指摘(2026-10-05)「文字サイズを小さくするのではなく間隔を狭めて
    /// 外枠を短くしてと言っている」: それまでの2回はフォントサイズ自体を
    /// 縮小(7→6→5.5)していたが、それは指摘の意図ではなかった。文字サイズは
    /// 判読できる大きさ(7/.bold、最初の値)に戻し、外枠(カプセル)だけを
    /// 左右パディングの圧縮(5.5→2.5)で短くする方針に変更した。
    ///
    /// さらにHQ再指摘(2026-10-05)「MEDIUMとHIGHの文字間隔を狭めて、縦幅を
    /// 少し広くして」: `.tracking(-0.4)`で字間を詰めて横幅をさらに短縮し、
    /// 縦パディングを1.5→3に広げた。
    ///
    /// 続くHQ指示(AskUserQuestionでの確認、2026-10-05)「HIGHと同じ大きさに
    /// 揃えて」: それまでは`.fixedSize()`で各バッジが自身のテキスト幅に
    /// ぴったり合わせていたため、"HIGH"(4文字)より"MEDIUM"(6文字)の方が
    /// 明らかに横長になっていた。`.fixedSize()`をやめ、"MEDIUM"が収まる
    /// 固定幅(32)を両方に与えてテキストを中央揃えにすることで、HIGH/
    /// MEDIUM/LOWのバッジが同じ横幅になるようにした。
    ///
    /// HQ指摘(2026-10-06)「お気に入り内のHIGHの枠の縦幅をもう少し短く
    /// して」: `verticalPadding`を追加し、お気に入りの小カード(`favoriteGridCard`)
    /// からだけ3→2で呼び出す — 今日の重要イベント(`eventRow`)側のバッジは
    /// 対象外のためデフォルト値(3)のまま変更していない。
    /// HQ再指摘(2026-10-07、CIキャプチャで再確認)「もう少し短くして」:
    /// 2→1へさらに縮小。
    ///
    /// HQ指示(2026-10-06)「英字を含む文字もNotoText(Common/NotoText.swift)
    /// で表示して」: "HIGH"/"MEDIUM"/"LOW"は英字のみだが対象に含め、
    /// `NotoText.text`に変更した。`NotoText`はウェイト指定を持たない
    /// (`NotoSansJP-SemiBold`固定、`V5JPFont`と同じ制約)ため、元の
    /// `.bold`から見た目のウェイトがやや軽いSemiBoldに変わる。
    @ViewBuilder private func statusBadge(_ text: String, colors: (fill: Color, border: Color), verticalPadding: CGFloat = 3) -> some View {
        NotoText.text(text, size: 7)
            .tracking(-0.4)
            .foregroundStyle(.white)
            .frame(width: 32)
            .padding(.vertical, verticalPadding)
            .background(colors.fill, in: Capsule())
            .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
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

    /// HQ再指摘(2026-10-05)「国旗の丸をもう少し大きくして」: 15→19に拡大。
    ///
    /// HQ指摘(2026-10-06、参考画像との実測比較)「国旗の位置や余白が違う」
    /// への調査で判明: 参考画像の通貨ペア行の国旗直径はカード幅(215ユニット)
    /// 基準で実測すると約22.6ユニット(85px/カード幅809pxから逆算)なのに
    /// 対し、実装の`flagDiameter`(19)は実機キャプチャで同様に実測すると
    /// 約20ユニットと、約13%小さかった。当初`pairRow`専用の
    /// `pairFlagDiameter`として分離し19×1.13≒21.5に拡大したが、HQ指示
    /// (2026-10-06)「通貨ペア内の国旗マークも今日の重要イベントの国旗
    /// マークとサイズをそろえて」により、共通の`flagDiameter`自体を21.5に
    /// 引き上げて`eventRow`/`pairRow`両方で揃えた(`pairFlagDiameter`は
    /// 廃止)。
    ///
    /// HQ指示(2026-10-08)「ホームの通貨ペアとホーム通貨ペア編集画面の国旗と
    /// USD/JPYの大きさを編集画面にそろえて」で通貨ペア行を16にし、続けて
    /// 「今日の重要イベントの国旗も合わせて」で共通の`flagDiameter`自体を
    /// 21.5→16にした(SCR-026の`PairFlags`と同じ。行の高さは変えない)。
    private static let flagDiameter: CGFloat = 16

    /// HQ再指摘(2026-10-05)「お気に入り内の国旗の丸のサイズは少し小さく
    /// して」: お気に入りの小カードは幅68と他カードの行より狭く、共通の
    /// `flagDiameter`(19)のままだと窮屈だったため、お気に入り専用の
    /// 少し小さいサイズを別途定義した。
    private static let favoriteFlagDiameter: CGFloat = 15

    /// HQ指摘(2026-10-06、要人発言をピクセル単位で再確認)「国旗サイズを
    /// 小さくして(お気に入りの国旗マークより少し大きめ)」: それまでは
    /// 共通の`flagDiameter`(21.5)を使っていたが、参考画像を実測すると
    /// 要人発言の国旗(直径約61px)は`favoriteFlagDiameter`相当の
    /// お気に入りの国旗(約58px)とほぼ同じで、`flagDiameter`(21.5)は
    /// 3割近く大きすぎた。`favoriteFlagDiameter`(15)より一回り大きい
    /// 専用サイズを別途定義した。
    private static let speechFlagDiameter: CGFloat = 16

    // MARK: 通貨ペアカード (x=26,y=180,width=782,height=527 → height 527/3.641≒145)

    /// HQ再指摘(2026-10-05)「通貨ペアの各行の縦幅をもう少し狭めて」で
    /// `pairRowHeight`を39→33に縮小したのに合わせ、カード全体の高さも
    /// ヘッダー(28)+行×3(33×3=99)=127に再計算(元の145のままだと行の下に
    /// 余白が残ってしまうため)。
    private static let pairsCardHeight: CGFloat = 127
    /// ヘッダー約102px→28.0。
    private static let pairsHeaderHeight: CGFloat = 28
    private static let pairRowHeight: CGFloat = 33

    // MARK: お気に入りカード (y=735,height=375 → 375/3.641≒103)

    // HQ再指摘(2026-10-06)「お気に入りのHIGHの下に少し余白を設けて、
    // そしてお気に入りの下枠との余白を狭めて」: ミニカード内のHIGHバッジ
    // 下の余白を確保するため`favoriteSubCardHeight`を60→65に広げ(中身は
    // `.topLeading`なので増えた分はそのまま下側の余白になる)、それに伴い
    // カード全体とミニカード下端の間の余白が広がりすぎないよう
    // `favoritesCardHeight`も97→95に詰めた。
    // HQ再指摘(2026-10-07)「米国CPI枠線の下部分をもう少しHIGH側に寄せて」:
    // CIキャプチャ実測でHIGHバッジ下端からミニカード下端の枠線まで約8.5
    // ユニット(意図していた下パディング4の倍以上)空いていたため、
    // `favoriteSubCardHeight`を65→61に詰めた。ミニカード下端の空きが
    // 広がりすぎないよう`favoritesCardHeight`も95→91に合わせて詰めた。
    private static let favoritesCardHeight: CGFloat = 91
    /// ヘッダー約114px→31.3≒31。
    /// HQ再指摘(2026-10-05、4回目)「お気に入りタイトルの下に空白があるから
    /// 下の米国CPIの枠を上にあげて」: ヘッダー下の`Divider()`を非表示にした
    /// (`showDivider: false`)際、区切り線の分だけ空いていた余白をこの
    /// ヘッダー高さ自体はそのままにしていたため、タイトルとミニカードの間に
    /// 不要な空白が残っていた。31→27に縮小して詰めた。
    private static let favoritesHeaderHeight: CGFloat = 27
    /// カード間約16px→4.4。
    private static let favoriteCardGap: CGFloat = 4.4
    /// 各カードwidth≈247px→67.8≒68、height≈242px→66.5≒66、
    /// corner radius≈18px→4.9≒5。
    private static let favoriteSubCardWidth: CGFloat = 68
    private static let favoriteSubCardHeight: CGFloat = 61
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
    /// 下端(y=53、`padding(.top, 53)`と同じ値)からフッター上端までの
    /// キャンバス残り全域。
    ///
    /// HQ指摘(2026-10-03、9回目キャプチャ後)「お気に入りの下、タブバーの
    /// 上に大きな空白ができている」の調査で判明した構造的な制約と、それに
    /// 対するHQの最終方針(2026-10-03、10回目):
    ///
    /// 「通貨ペア+お気に入り」の合計高さ(256)はこのキャンバス残り全域
    /// よりかなり小さく、その差を「直近の要人発言を折り返し線より下に
    /// 強制的に押し出す」ために空けると、ScrollViewの内側・外側どちらに
    /// 置いても実機キャプチャ(静止画)上は同じ大きさの空白として見えて
    /// しまう(ピクセル比較で確認済み)。HQの最終判断は「カード寸法・
    /// セクション間余白の実測精度を優先し、直近の要人発言を初期表示から
    /// 隠すための空白は作らない。Home全体を縦スクロール可能な構造にして
    /// おけば、スクロール位置の厳密な調整(何が初期表示で見えるか)は
    /// 今回求めない」というもの。
    ///
    /// そのため`loadedScreen`では高さを人為的に引き伸ばさず、カードを
    /// 自然な順序で流し込んでいる。ScrollViewの表示領域はキャンバス全域
    /// まで広げてあるため、将来コンテンツがこの高さを超えた場合もそのまま
    /// 正しくスクロール可能になる(寸法は常に現在のカードデザイン通りで
    /// 変化しない)。
    ///
    /// 15回目の変更(2026-10-06、「今日の重要イベント」復元)でカードが
    /// 3枚→4枚に増えたことで合計コンテンツ高さは`contentAreaHeight`を
    /// 上回るようになったが、上記の通り元々スクロール前提の設計のため
    /// 挙動は変わらない(4枚目以降は下にスクロールして閲覧する)。
    ///
    /// 16回目の修正(2026-10-05、HQ「タブの枠は上の線の部分で切って、今
    /// 上の線の少し上までがタブ枠になっている」): 元の値394は
    /// `V5BottomBar`が旧デザイン(浮遊カプセル、`barHeight`40+
    /// `bottomMargin`4→フッター上端y=491-4-40=447)だった頃の実測から
    /// 算出されたまま、10回目のタブバー全面刷新(画面幅いっぱいの帯、
    /// `barHeight`39・`bottomMargin`無し→フッター上端y=491-39=452)後も
    /// 更新されていなかった。そのため`ScrollView`のクリップ境界(旧:
    /// y=53+394=447)が実際のタブバー上端・区切り線(y=452)より5ユニット
    /// (実機キャプチャ換算約26px)手前で止まっており、クリップされた
    /// お気に入りカードの縁がその隙間に浮いて見えていた。`V5BottomBar`の
    /// 現行寸法に合わせて447→452(=491-39)の差分だけ`contentAreaHeight`を
    /// 394→399へ拡大し、クリップ境界がタブバーの区切り線とちょうど一致する
    /// ようにした。
    private static let contentAreaHeight: CGFloat = 399

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
        let speeches = Array(viewModel.recentSpeeches.prefix(3))

        return V5Viewport {
            homeHeader

            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: Self.sectionGap) {
                    if !topEvents.isEmpty {
                        todayEventsCard(topEvents)
                    }
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
    ///
    /// HQ再指摘(2026-10-05、2回目)「各カードの枠内の左右の余白をもう少し
    /// 広げて、それに合わせて内側に寄せて」: 左右パディングを4→8に拡大
    /// (中身は全てこの`content()`経由で配置されるため、パディングを
    /// 広げるだけで内側の要素も自動的に内側へ寄る)。
    @ViewBuilder private func cardShell(height: CGFloat, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .padding(.horizontal, 8)
        .frame(width: Self.cardWidth, height: height, alignment: .top)
        .background(RoundedRectangle(cornerRadius: Self.cardCornerRadius).fill(Self.cardFill))
        .overlay(
            RoundedRectangle(cornerRadius: Self.cardCornerRadius)
                .stroke(Self.cardBorderColor, lineWidth: 0.75)
                .shadow(color: Self.cardBorderColor.opacity(0.8), radius: 2)
        )
    }

    /// HQ指示(2026-10-05、23回目)「今日の重要イベント、通貨ペア、お気に入り、
    /// 直近の要人発言の文字が大きすぎるので参考画像に合わせて小さくして」
    /// 「フォントが太いので参考画像に合わせて」: 参考画像(852×1846px)の
    /// 「通貨ペア」ヘッダーをカード幅基準でピクセル実測(カード幅814px/215
    /// ユニット→スケール3.786px/ユニット)するとテキスト高さ40px→10.62
    /// ユニット。現行実装(size 14)の実機キャプチャ側を同様に実測すると
    /// 高さ67px/5.1488px/ユニット=13.01ユニットで、14pt→0.929ユニット/pt。
    /// 10.62ユニットに必要なsizeは10.62/0.929≒11.4→11に縮小。太さも.bold→
    /// .semibold(V5JPFontは日本語ランを常にSemiBoldで描画するため、英数字
    /// ランの太さをそれに揃える目的)。
    /// HQ再指摘(2026-10-05)「各アイコンをもう少し右に移動させ、サイズを
    /// 大きくして」「文字もアイコンと同様に右に移動し、少しサイズを大きく
    /// して」でいったん`.padding(.leading, 4)`を追加したが、HQ再指摘
    /// (2026-10-05、5回目)「各カードのアイコンのサイズを1大きくして、左の
    /// 空白付近に来るように揃えて」でアイコンを左の余白(カードの
    /// パディング)付近に揃え直したいとの指示を受け、その`.padding(.leading,
    /// 4)`を削除した(アイコンサイズは呼び出し側で13→14にさらに拡大)。
    ///
    /// HQ再指摘(2026-10-05)「お気に入りの文字の下の線はいらない」: 全カード
    /// 共通で表示していたヘッダー下の`Divider()`を、呼び出し側から
    /// `showDivider: false`を渡せるようにしてお気に入りカードだけ非表示に
    /// できるようにした(他3カードは`showDivider`省略でこれまで通り表示)。
    @ViewBuilder private func cardHeaderRow(title: String, height: CGFloat, showDivider: Bool = true, @ViewBuilder icon: () -> some View, @ViewBuilder trailing: () -> some View) -> some View {
        HStack(spacing: 5) {
            icon()
            V5JPFont.text(title, size: 12, weight: .semibold)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer()
            trailing()
        }
        .frame(height: height, alignment: .center)
        if showDivider {
            Divider().overlay(Self.cardBorderColor)
        }
    }

    /// HQ再指摘(2026-10-05)「すべて見るの文字サイズを10/5(月)と同じサイズに
    /// して」でいったん7→9.5に拡大したが、再指摘(2026-10-05、4回目)
    /// 「すべて見るのサイズを8にして」で8へ調整(「10/5(月)」も同回に
    /// 9.5→9へ調整、`todayEventsDateFormatter`呼び出し側参照)。
    @ViewBuilder private func headerLink(_ text: String) -> some View {
        HStack(spacing: 2) {
            V5JPFont.text(text, size: 8).foregroundStyle(Self.linkBlue)
            Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold)).foregroundStyle(Self.linkBlue)
        }
    }

    // MARK: - 今日の重要イベントカード

    /// 15回目の変更(2026-10-06)で復元。ヘッダー高さ(28)は他3カードの実測値
    /// (`pairsHeaderHeight`等)と揃え、行高さ(44)は時刻+国旗+種別バッジ+
    /// 名称+予想/前回を2行で収める実装上の必要値として設定した(この
    /// カード自体は9回目の削除時点で参考画像の実測対象から外れており、
    /// 対応する実測値が存在しないため)。
    private static let todayEventsCardHeight: CGFloat = 28 + 3 * 44
    private static let todayEventsHeaderHeight: CGFloat = 28
    private static let eventRowHeight: CGFloat = 44

    /// `HomeEventSummary`(指標発表イベントAPI)にはイベント種別そのものを
    /// 表すフィールドが無く、このAPIが返す行は実質的にすべて経済指標発表
    /// イベントのため、バッジは固定で「経済指標」を表示する(削除前の実装が
    /// 持っていた`HomeEventCategory`列挙型は要人発言/中央銀行の2ケースを
    /// 実データ無しで備えていただけだったため、実在する種別分だけに単純化
    /// して復元した)。色は削除前の実測値(RGB(0,118,234))をそのまま流用。
    private static let economicIndicatorBadgeColor = Color(red: 0.0 / 255, green: 118.0 / 255, blue: 234.0 / 255)

    /// HQ指示(2026-10-05、23回目)「今日の重要イベントの右側はすべて見る
    /// ではなく日付（曜日）です」(当初「ミル」と記載されていたが、続く
    /// 「すべて見るのこと」+`AskUserQuestion`での確認で「今日の重要イベント
    /// カードの右側がすべて見る＞になっているから10/5(月)＞みたいにして」と
    /// 確定): 他3カードの「すべて見る」リンク(`headerLink`、一覧画面への
    /// 遷移)とは違い、このカードの右側は今日の日付+曜日を「10/5(月)」の
    /// ように表示する。カレンダーへの遷移導線自体は維持する(表示テキストの
    /// 差し替えのみ)。
    private static let todayEventsDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "M/d(E)"
        formatter.timeZone = .current
        return formatter
    }()

    @ViewBuilder private func todayEventsCard(_ events: [HomeEventSummary]) -> some View {
        cardShell(height: Self.todayEventsCardHeight) {
            cardHeaderRow(title: "今日の重要イベント", height: Self.todayEventsHeaderHeight) {
                // HQ再指摘(2026-10-05、6回目)「通貨ペアのタイトルの開始を
                // 他と縦を合わせて」: 各カードのアイコン自体の幅(SF Symbolの
                // calendar/star/quote.bubbleと自前描画のHomeChartIconとで
                // 幅が異なる)がそのままタイトルの開始位置の差になっていた
                // ため、4カード共通で`.frame(width: 16, alignment: .center)`
                // の箱に揃え、箱の中でアイコンを中央揃えにすることでタイトル
                // の開始位置を統一した。
                Image(systemName: "calendar").font(.system(size: 14, weight: .bold)).foregroundStyle(V5P.cyan).shadow(color: Self.iconGlowShadow.color, radius: Self.iconGlowShadow.radius)
                    .frame(width: 16, alignment: .center)
            } trailing: {
                // HQ指示(2026-10-05)「日付10/5(月)の文字を大きくして」でいったん
                // 10に拡大したが、再指摘(2026-10-05)「10/5(月)文字サイズを0.5
                // 下げて」で10→9.5に調整(「すべて見る」もこのサイズに統一、
                // `headerLink`参照)。
                NavigationLink(value: AppRoute.calendar) {
                    HStack(spacing: 2) {
                        Text(Self.todayEventsDateFormatter.string(from: Date()))
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(Self.linkBlue)
                        Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(Self.linkBlue)
                    }
                }
            }
            ForEach(Array(events.enumerated()), id: \.element.id) { idx, event in
                if idx > 0 { Divider().overlay(Self.cardBorderColor) }
                NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                    eventRow(event)
                }.buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private func eventRow(_ event: HomeEventSummary) -> some View {
        HStack(spacing: 5) {
            // HQ再指摘(2026-10-05、5回目)「今日の重要イベントの時刻の位置が
            // 上下でバラバラなので縦はきちんと揃えて、サイズを10に下げて」:
            // サイズは11→10に調整。位置のバラつきは、予想/前回の有無で
            // タイトル+予想/前回の`VStack`の高さが行ごとに変わり(1行 or
            // 2行)、それに伴い行全体の自然な高さも変わって、固定高さ
            // (`eventRowHeight`)の中でのセンタリング位置が行ごとにズレて
            // いたことが原因だった。この`VStack`に`.frame(minHeight:
            // ..., alignment: .top)`を付け、予想/前回が無い行でも2行分の
            // 高さを確保することで、行全体の自然な高さを常に一定にし、
            // 時刻を含む他の要素の縦位置が行によってズレないようにした。
            // HQ再指摘(2026-10-06)「時刻の文字間隔が広すぎるから狭めて、
            // 縦が揃っていない」: 文字間隔は+0.5でもまだ広いとの指摘を受け
            // -0.2まで詰めた。縦のズレは、この`Text`が`.fixedSize`+
            // `.frame(width:)`(横幅のみ指定)だったため、行全体の実高さが
            // タイトル列の`minHeight: 38`の影響で間接的にしか決まらず、
            // 行ごとに時刻の中心位置が微妙にブレていたことが原因だった。
            // `.frame(height: Self.eventRowHeight, alignment: .center)`を
            // 明示することで、タイトル列の高さ計算とは独立に、常に行全体
            // (44)の中央に揃うようにした。
            // HQ指示(2026-10-06)「国旗マーク、USD、経済指標、指標名、予想、
            // 前回をまとめてもう少し左に配置して」: 時刻の文字間隔を詰めた
            // ことで実際の文字幅には余裕があるため、時刻列の固定幅を
            // 30→26に縮め、後続の国旗+内容のグループ全体を左に寄せた
            // (内部の間隔(`HStack(spacing: 5)`や`VStack`内の間隔)は
            // 変えていない)。
            Text(Self.timeFormatter.string(from: event.releaseDatetime))
                .font(.system(size: 9, weight: .bold))
                .tracking(-0.2)
                .foregroundStyle(.white)
                .fixedSize(horizontal: true, vertical: false)
                .frame(width: 26, alignment: .leading)
                .frame(height: Self.eventRowHeight, alignment: .center)

            // HQ指示(2026-10-05、23回目)「今日の重要指標の国旗の下にUSDや
            // JPYなどを記載して」。HQ再指摘(2026-10-05)「USDやJPYの文字が
            // 小さい」で5.5→7へ拡大。さらにHQ再指摘(2026-10-05、3回目)
            // 「USDやJPYの文字色を白にして」でグレー(`V5P.muted`)から
            // 白に変更。
            VStack(spacing: 1) {
                CountryFlagView(countryCode: event.countryCode, diameter: Self.flagDiameter)
                // HQ指示(2026-10-06)「英字を含む文字もNotoTextで表示して」
                NotoText.text(event.currencyCode, size: 7).foregroundStyle(.white)
            }

            // HQ再指摘(2026-10-05、6回目)「経済指標の下に指標名でその下に
            // 予想と前回として並びを変えてみて、縦幅を大きくしてはいけ
            // ない」: 「経済指標」バッジ+タイトルを横に並べていた構成を
            // やめ、バッジ→指標名→予想/前回を縦3行に積む構成に変更した。
            // `eventRowHeight`(行全体の高さ)自体は変えず、3行分の高さが
            // 国旗+通貨コードの高さ(flagDiameter+通貨コード1行)とほぼ
            // 同じ範囲に収まるよう、バッジの文字間隔・外枠も合わせて
            // 詰めた(「経済指標の文字間隔を狭めて、外枠の横幅も少し
            // 狭めて」: tracking追加、パディング4/2→3/1.5)。
            // HQ指示(2026-10-08、案B)「ホームでは短い名前だけ出す。その分見やすい
            // ように文字サイズを調整して」: 指標名はカッコの前まで(「米国雇用統計」
            // 「日本CPI」。正式名は詳細画面)にし、1行に収まるので名前を8.5、
            // 予想・前回を6.3に大きくした。以前のカッコを2行目に分ける形と、
            // 名前の長さで文字サイズを変える分岐はなくした。
            VStack(alignment: .leading, spacing: 1.5) {
                let subtitle = Self.eventSubtitle(event)
                V5JPFont.text("経済指標", size: 5.3, weight: .semibold)
                    .tracking(-0.4)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 3).padding(.vertical, 1.5)
                    .background(Self.economicIndicatorBadgeColor, in: Capsule())
                    .fixedSize()
                V5JPFont.text(Self.shortIndicatorName(event.indicatorName), size: 8.5, weight: .semibold)
                    .tracking(-0.3)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if let subtitle {
                    V5JPFont.text(subtitle, size: 6.3, weight: .regular)
                        .foregroundStyle(Self.linkBlue)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            .frame(minHeight: 38, alignment: .center)
            .layoutPriority(1)

            Spacer(minLength: 4)

            HStack(spacing: 6) {
                statusBadge(event.importance.rawValue, colors: Self.importanceBadgeColors(event.importance))
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(Self.linkBlue)
            }
            .fixedSize()
        }
        .foregroundStyle(.white)
        .frame(height: Self.eventRowHeight)
    }

    /// 予想・前回のみ(`HomeEventSummary`に単位情報が無いため数値のみ)。
    private static func eventSubtitle(_ event: HomeEventSummary) -> String? {
        var parts: [String] = []
        // HQ指示(2026-10-08)「予想・前回に単位を付けて」: APIの`unit`で表示する。
        if let forecast = event.forecast { parts.append("予想 \(ValueFormat.withUnit(forecast, unit: event.unit))") }
        if let previous = event.previous { parts.append("前回 \(ValueFormat.withUnit(previous, unit: event.unit))") }
        // 単位が付いて長くなった分、区切りの全角スペースを半角にした。
        return parts.isEmpty ? nil : parts.joined(separator: " | ")
    }

    /// ホームに出す短い指標名。「米国雇用統計(非農業部門雇用者数)」→「米国雇用統計」。
    static func shortIndicatorName(_ name: String) -> String {
        guard let split = splitParenthetical(name) else { return name }
        let main = split.main.trimmingCharacters(in: .whitespaces)
        return main.isEmpty ? name : main
    }

    /// HQ指示(2026-10-06)「米国雇用統計の場合は（）部分を2行目にし」:
    /// 指標名を最初の全角/半角開き括弧の直前で本文/カッコ注記に分割する。
    /// 括弧が無ければnil。
    private static func splitParenthetical(_ name: String) -> (main: String, paren: String)? {
        guard let openIndex = name.firstIndex(where: { $0 == "(" || $0 == "（" }) else { return nil }
        let main = String(name[name.startIndex..<openIndex])
        let paren = String(name[openIndex...])
        return (main, paren)
    }

    // MARK: - 通貨ペアカード

    @ViewBuilder private func pairsCard(_ pairs: [FXPairUI]) -> some View {
        cardShell(height: Self.pairsCardHeight) {
            cardHeaderRow(title: "通貨ペア", height: Self.pairsHeaderHeight) {
                // HQ再指摘(2026-10-05、6回目)「通貨ペアのアイコンをもう少し
                // 大きくして」: 14×13→16×15に拡大(他カードとのタイトル
                // 開始位置の共通箱16幅ともちょうど合う)。
                HomeChartIcon().foregroundStyle(V5P.cyan).frame(width: 16, height: 15).shadow(color: Self.iconGlowShadow.color, radius: Self.iconGlowShadow.radius)
            } trailing: {
                // HQ指示(2026-10-08)「すべて見るは通貨ペア編集画面へつないで」:
                // SCR-026 ホーム通貨ペア編集へ遷移する。
                NavigationLink(value: AppRoute.homeCurrencyPairEditor) {
                    headerLink("すべて見る")
                }
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

    /// HQ指示(2026-10-05、23回目)「通貨ペアの数字の位置が違います。参考
    /// 画像にして。また、赤文字と緑文字が薄いので参考画像にして」: 価格
    /// テキストを参考画像でピクセル実測(22px、カード幅基準スケール
    /// 3.786px/ユニット→5.84ユニット)し、現行実装(size 11)の実機
    /// キャプチャ実測(42px/5.1488px/ユニット→8.16ユニット、11pt→0.742
    /// ユニット/pt)から逆算(5.84/0.742≒7.9)して11→8に縮小。これにより
    /// 価格ブロックが行の中で肥大化して見えていた位置ズレも解消する
    /// (シンボル・変化率も合わせて縮小・.semibold化)。色は
    /// `changeUpColor`/`changeDownColor`(上で`V5P.red`/`V5P.green`に統一済み)
    /// を使用。
    /// HQ再指摘(2026-10-05、2回目)の4点を反映:
    /// 1.「USD/JPYの文字サイズを0.5大きく」「USD/JPY 155.42 +0.25%▲の
    ///    全て文字サイズを同一にして」: シンボル・価格・変化率をすべて
    ///    9.5に統一(シンボルは9→9.5)。
    /// 2.「155.42の文字の位置をUSD/JPYと+0.25%の等間隔に配置し、縦の
    ///    155.42と1.0821と168.24の位置はきちんとそろえて」「+0.25%▲の
    ///    文字の位置をもう少し右に寄せて」: それまでは`Spacer()`と
    ///    `.fixedSize()`の組み合わせで各行ごとに価格ブロックの位置が
    ///    テキスト幅に応じて微妙にズレていた(シンボル・価格とも文字数は
    ///    同じでも、プロポーショナルフォントでは字形幅が文字種によって
    ///    異なるため)。シンボル/価格/変化率の3列をそれぞれ固定幅の
    ///    `.frame(width:)`スロットにし(価格は`.monospacedDigit()`も追加)、
    ///    価格を中央揃え・変化率を右(chevron側)揃えにすることで、行ごとの
    ///    文字幅に関係なく価格が常にシンボルと変化率の中間に来て、かつ
    ///    3行とも同じx位置に揃うようにした。
    @ViewBuilder private func pairRow(_ pair: FXPairUI) -> some View {
        HStack(spacing: 4) {
            // 国旗の間隔(2)と通貨ペア名までの間隔(4+5=9)も編集画面と同じ。
            HStack(spacing: 2) {
                CountryFlagView(currencyCode: pair.baseCurrency, diameter: Self.flagDiameter)
                CountryFlagView(currencyCode: pair.quoteCurrency, diameter: Self.flagDiameter)
            }
            .padding(.trailing, 5)
            // HQ再指摘(2026-10-05、4回目)「USD/JPYの文字の幅、155.42の文字の
            // 幅、+0.25%の文字の幅いずれも狭めて」: HIGH/MEDIUMバッジの時と
            // 同じく、文字サイズ(9.5)はそのままに`.tracking(-0.4)`で字間を
            // 詰めて幅だけ狭くした。それに合わせて各列の固定幅(frame)も
            // 46/40/44→42/36/40に縮小。
            //
            // HQ指示(2026-10-06)「USD/JPYの下に米ドル/円と記載して。
            // 文字色とサイズはお気に入りの日付/時刻と同サイズ(7)・同色・
            // 同trackingにして」: 2行目(`displayName`)を追加するため列幅を
            // 42→54に拡大(直前の実装で固定`frame(width:)`+`lineLimit(1)`
            // だけで安全弁が無いまま要人発言セクションが実機キャプチャで
            // 丸ごと省略記号に潰れた教訓から、ここも`minimumScaleFactor`を
            // 安全弁として付けた)。右側のSpacer(minLength: 4)が吸収する
            // 余白はまだ十分残っているため、他の列幅は変更していない。
            //
            // HQ再指摘(2026-10-06、CIキャプチャで確認)「米ドル/円が表示
            // されていない」: `.frame(width: 54, alignment: .leading)`
            // (幅を固定値ぴったりに強制)をこのVStack自体に付けていた
            // ところ、2行目が実機キャプチャで完全に消えていた(真因は
            // 未特定だが、`speechRow`の右側VStack(symbol/発言前/現在、
            // 3行)はこの固定`width:`を付けずに自然なサイズ決めで問題なく
            // 表示できている実例と構成が異なっていた点が唯一の違い)。
            // `width:`(厳密な固定値)ではなく`minWidth:`(下限のみ、
            // 自然なサイズがそれより大きければ縮めない)に変更し、3行
            // とも価格列の開始位置を揃える効果は保ちつつ、内容を強制的に
            // 狭い幅へ押し込めることによる不具合を避けるようにした。
            // HQ再指摘(2026-10-06、2回目、CIキャプチャで再確認)「米ドル/円が
            // まだ表示されていない」: `frame(width:)`→`frame(minWidth:)`
            // (直前の対応)でも解消しなかった — 横幅の制約方式は無関係
            // だったことになる。残る仮説は縦方向: `NotoText`
            // (`NotoSansJP-SemiBold`)は和文フォントのため、欧文中心の
            // システムフォントよりも1行あたりの行送り(ascent+descent)が
            // 大きく取られている可能性があり、1行目(symbol、9.5pt)の
            // 「自然な高さ」だけで2行分の縦スペース予算を使い切り、2行目
            // (displayName)に残る高さがほぼ0になっていたと推測される
            // (`.minimumScaleFactor`は横方向の縮小にしか効かず、縦方向の
            // 圧迫に対する安全弁が無いため、潰れる時は縮小ではなく消失に
            // なる)。各行に明示的な`.frame(height:)`を付けて行送りを
            // フォント任せにせず固定し、1行目が2行目の分まで占有しない
            // ようにした。
            // HQ指示(2026-10-08)で編集画面(SCR-026の`PairLabels`)と同じ
            // NotoTextの9.5/7・字間詰めなしにそろえた。以前の固定高さ11/8は
            // Notoの行送りより低く、文字が縮んで小さく見えていたため、
            // 行送りが収まる14/10に広げた(合計25で行の高さ33に収まる)。
            VStack(alignment: .leading, spacing: 1) {
                // HQ指示(2026-10-06)「英字を含む文字もNotoTextで表示して」
                NotoText.text(pair.displaySymbol, size: 9.5)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(height: 14, alignment: .leading)
                NotoText.text(pair.displayName, size: 7)
                    .foregroundStyle(Self.linkBlue)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(height: 10, alignment: .leading)
            }
            .frame(minWidth: 54, alignment: .leading)
            // HQ再指摘(2026-10-05、6回目)「155.42のサイズを0.5だけ大きく
            // して、もう少し右に寄せて」: 9.5→10に拡大し、列内の配置を
            // 中央揃えから右(変化率側)揃えに変更。HQ再指摘(2026-10-06)
            // 「もう1つ右に寄せて」: 右揃えのまま列の幅自体を36→40に
            // 広げ、右端をさらに右へ。
            // HQ指示(2026-10-08)「155.42ももう少し大きくして」: 10→11に拡大し、
            // 列幅も40→44に広げた(国旗の縮小とchevronの削除で横幅に余裕がある)。
            Text(pair.price).font(.system(size: 11, weight: .semibold)).tracking(-0.4).monospacedDigit().frame(width: 44, alignment: .trailing)
            // HQ再指摘(2026-10-05、5回目)「+0.25%▲>は右に寄せて」:
            // 固定幅の列を並べただけだと行の合計幅がカード幅より短くなり、
            // 左詰め(`cardShell`のVStackが`alignment: .leading`)のため
            // 右側に余白が残っていた。`Spacer(minLength: 4)`を変化率の前に
            // 入れ、余白をすべて吸収させて変化率+chevronをカード右端まで
            // 押し出した。
            //
            // 「+0.25%の文字幅をもう少し狭めて」: tracking -0.4→-0.6に強化。
            //
            // 「>の高さの位置は全て同じで」: 上/下矢印アイコン
            // (arrowtriangle.up/down.fill)のグリフ自体の縦方向の重心が
            // 微妙に異なり、それを含む`HStack`の実測の高さが行によって
            // わずかに変わって、chevronとの共通センターラインが行ごとに
            // ズレていた。変化率`HStack`とchevronの両方に同じ固定高さ
            // (`flagDiameter`)を与えて揃えた。
            //
            // 「-0.14%のグローが強いから無くして」: 前回追加したグロー
            // (`.shadow`)を削除。
            Spacer(minLength: 4)
            // HQ再指摘(2026-10-05、6回目)「%を半角で表示して」: 元の文字列
            // 自体は常に半角の"%"(U+0025)だったが、`.monospacedDigit()`の
            // フォント機能が%記号の字形にも適用され、全角のように幅広く
            // 見えていた。`.monospacedDigit()`を削除し、通常のプロポー
            // ショナル字形に戻した。
            // HQ指摘(2026-10-06、参考画像との実測比較)「+0.25%が参考画像
            // より横に長く感じる」: 参考画像(852×1846px)と実機キャプチャを
            // それぞれ自身のカード幅(215ユニット)基準でピクセル実測した
            // ところ、"+0.32%▲"ブロックの幅/高さが参考画像側で約
            // 36.4/6.4ユニットなのに対し、実装側(当時9.5pt)は約42.5/7.4
            // ユニットと、幅・高さとも約15〜17%大きかった(字間
            // `.tracking`だけの問題なら幅だけ変わるはずだが、高さも同程度
            // 拡大していたため、文字サイズそのものが大きすぎたと判断)。
            // 9.5×(36.4/42.5)≒8.14と9.5×(6.4/7.4)≒8.21の平均から8.2に縮小。
            HStack(spacing: 1) {
                Text(pair.change).font(.system(size: 8.2, weight: .semibold)).tracking(-0.6).lineLimit(1)
                Image(systemName: pair.isUp ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 8.2))
            }
            .foregroundStyle(pair.isUp ? Self.changeUpColor : Self.changeDownColor)
            .frame(height: Self.flagDiameter, alignment: .center)
            .fixedSize()
            // HQ指示(2026-10-08)「>はいらない、消して」: 行は遷移しないので
            // chevronを削除。行の中身がカードの内側幅(215-左右8)より約10pt
            // 広く、はみ出した分だけカード全体の左右の余白が他のカードより
            // 狭くなっていたのも、この幅が空くことで解消する。
        }
        .foregroundStyle(.white)
        .frame(height: Self.pairRowHeight)
    }

    // MARK: - お気に入りカード

    @ViewBuilder private func favoritesCard(_ favorites: [HomeFavoriteItem]) -> some View {
        cardShell(height: Self.favoritesCardHeight) {
            cardHeaderRow(title: "お気に入り", height: Self.favoritesHeaderHeight, showDivider: false) {
                Image(systemName: "star.fill").font(.system(size: 14, weight: .semibold)).foregroundStyle(V5P.cyan).shadow(color: Self.iconGlowShadow.color, radius: Self.iconGlowShadow.radius)
                    .frame(width: 16, alignment: .center)
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
        }
    }

    @ViewBuilder private func favoriteGridCard(_ item: HomeFavoriteItem) -> some View {
        switch item {
        case .event(let id, let countryCode, _, let name, let importance, let releaseDatetime):
            NavigationLink(value: AppRoute.eventDetail(id: id)) {
                favoriteGridCardContent(countryCode: countryCode, name: name) {
                    dateRow(releaseDatetime)
                } footer: {
                    statusBadge(importance.rawValue, colors: Self.importanceBadgeColors(importance), verticalPadding: 1)
                }
            }.buttonStyle(.plain)
        // HQ指示(2026-10-06)「お気に入り欄の米国CPIの下にカレンダーアイコン
        // 10/13 21:30みたいに書いて」: `.event`ケースと同じ`dateRow`を
        // 表示するため、`nextReleaseDatetime`(次回発表予定、無ければnil)
        // を追加した。`fetchFavoriteIndicator`で`IndicatorDetailView`と
        // 同じ`/indicators/{id}/events?status=SCHEDULED`を追加で叩いて
        // 取得した実データで、架空の日時は表示しない(無ければ日付無しの
        // まま)。
        case .indicator(let id, let countryCode, _, let name, let importance, let nextReleaseDatetime):
            NavigationLink(value: AppRoute.indicatorDetail(id: id)) {
                favoriteGridCardContent(countryCode: countryCode, name: name) {
                    if let nextReleaseDatetime {
                        dateRow(nextReleaseDatetime)
                    } else {
                        EmptyView()
                    }
                } footer: {
                    statusBadge(importance.rawValue, colors: Self.importanceBadgeColors(importance), verticalPadding: 1)
                }
            }.buttonStyle(.plain)
        case .fxPair(_, let symbol, let price, let change, let isUp):
            // HQ指示(2026-10-03、画面構成全面更新)「お気に入りの通貨ペア →
            // 現時点では遷移なし」: 旧`.chartAnalysis`(削除済み)への遷移を
            // 外した(このケース自体、`FavoritesStore.ItemType.fxPair`の
            // ドキュメントコメント参照の通り単体取得API/★が無く現状未使用)。
            favoriteGridCardContent(countryCode: nil, name: symbol) {
                Text(price).font(.system(size: 8, weight: .semibold)).foregroundStyle(.white)
            } footer: {
                HStack(spacing: 1) {
                    Text(change).font(.system(size: 6, weight: .semibold))
                    Image(systemName: isUp ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 6))
                }
                .foregroundStyle(isUp ? Self.changeUpColor : Self.changeDownColor)
            }
        }
    }

    // HQ指摘(2026-10-06、参考画像との実測比較)「お気に入り内の日時の文字
    // 間隔を狭めて、文字の色を参考画像と同じにして」: 参考画像の
    // "10/13 21:30"を実測すると明るい水色(RGB≒138,191,246)で、既存の
    // `Self.linkBlue`(140,180,247)とほぼ同一だった — 現在の`V5P.muted`
    // (くすんだグレー、153,178,209)とは別の色だったので差し替えた。
    // 文字間隔は、参考画像の1文字あたりの幅/高さ比(0.42)が実装側(0.59)
    // より詰まっていたため、`.tracking(-1.0)`を追加して詰めた(文字サイズ
    // 自体は今回変更していない — 下の「上下の間隔を狭めて1画面に収める」
    // 要望と逆行するため)。
    // HQ再指摘(2026-10-06)「日付と時刻の文字間隔が詰めすぎている」:
    // -1.0は詰めすぎだったため、-0.4まで緩めた。
    @ViewBuilder private func dateRow(_ date: Date) -> some View {
        HStack(spacing: 3) {
            Image(systemName: "calendar").font(.system(size: 7)).foregroundStyle(Self.linkBlue)
            Text(Self.favoriteDateFormatter.string(from: date)).font(.system(size: 7, weight: .medium)).tracking(-0.4).foregroundStyle(Self.linkBlue)
        }
    }

    private static let favoriteDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "M/d HH:mm"
        formatter.timeZone = .current
        return formatter
    }()

    // HQ指摘(2026-10-06)「上下の間隔を狭めてお気に入りの枠全体が1画面に
    // 収まること」: ミニカード内の縦方向の余白(行間spacing・外側padding)
    // を詰めて1枚あたりの高さを縮小した(spacing 3→2、padding 5→4、それに
    // 合わせて`favoriteSubCardHeight`66→60、`favoritesCardHeight`103→97)。
    @ViewBuilder private func favoriteGridCardContent(
        countryCode: String?,
        name: String,
        @ViewBuilder subtitle: () -> some View,
        @ViewBuilder footer: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                if let countryCode {
                    CountryFlagView(countryCode: countryCode, diameter: Self.favoriteFlagDiameter)
                }
                Spacer()
                // HQ指示(2026-10-06)「お気に入りの☆のサイズを少し小さく
                // して、すこし右上に移動させて」: サイズ10→8.5に縮小し、
                // `.offset`で右上方向に少しずらした。
                // HQ指示(2026-10-08)「塗りつぶしにして」: お気に入り登録済みの
                // 項目なので、白抜き(未登録に見える)から塗りつぶしの★にした。
                Image(systemName: "star.fill").font(.system(size: 8.5)).foregroundStyle(V5P.cyan)
                    .offset(x: 1.5, y: -1.5)
            }
            // HQ指示(2026-10-06)「英字を含む文字もNotoTextで表示して」:
            // "FOMC"等の英字を含む指標名や、通貨ペアの"USD/JPY"もこの
            // `name`経由で表示されるため、`V5JPFont.text`(日本語部分だけ
            // Noto)から`NotoText`(全体をNoto)へ変更した。
            NotoText.text(name, size: 7).foregroundStyle(.white).lineLimit(1)
            subtitle()
            footer()
        }
        .padding(4)
        .frame(width: Self.favoriteSubCardWidth, height: Self.favoriteSubCardHeight, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: Self.favoriteSubCardCornerRadius).fill(Self.cardFill))
        .overlay(RoundedRectangle(cornerRadius: Self.favoriteSubCardCornerRadius).stroke(Self.cardBorderColor.opacity(0.7), lineWidth: 0.5))
    }

    // MARK: - 直近の要人発言

    /// `HomeSpeechSummary`/`HomeResponse.speeches`のドキュメントコメント参照
    /// — 本番バックエンドには該当APIが無いため`recentSpeeches`は常に空の
    /// まま(空状態表示)。CIのUIスクリーンショット用モックサーバーの応答
    /// にだけ値が入っており、このセクションは常に表示した上でデータが
    /// 無ければ空状態を出す(架空データを本番向けに出すことはない)。
    @ViewBuilder private func speechesCard(_ speeches: [HomeSpeechSummary]) -> some View {
        cardShell(height: Self.speechesCardHeight) {
            cardHeaderRow(title: "直近の要人発言", height: Self.speechesHeaderHeight) {
                // HQ指摘(2026-10-06)「アイコンが違うから参考画像と同じように」:
                // 参考画像は吹き出しではなくスピーカー(メガホン+音波)アイコン。
                Image(systemName: "speaker.wave.2.fill").font(.system(size: 14, weight: .semibold)).foregroundStyle(V5P.cyan).shadow(color: Self.iconGlowShadow.color, radius: Self.iconGlowShadow.radius)
                    .frame(width: 16, alignment: .center)
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

    /// HQ指摘(2026-10-06、2回目、参考画像をピクセル単位で再確認「全然
    /// あっていない」)に合わせて全面的に実測し直した:
    /// - 国旗: `flagDiameter`(21.5)→`speechFlagDiameter`(16、定義コメント
    ///   参照)。
    /// - 発言要約(`headline`)・日時行: お気に入りの日付/時刻行
    ///   (`dateRow`)と実測したピクセル高さがほぼ同じだったため、同じ
    ///   サイズ(7)・同じ色(`linkBlue`)・同じtracking(-0.4)に揃えた
    ///   (元は6.5/6で`V5P.muted`、お気に入りより小さく色も違っていた)。
    /// - 日時行は「07:29」のような時刻のみではなく、参考画像通り
    ///   「10/2 07:29 | FRB」(日付+時刻+中央銀行)にした。
    /// - 左ブロック(国旗+発言者/要約/日時)は内容量に関わらず固定幅にして
    ///   いる — 参考画像では3行とも縦線(下記)がカード内の同じx位置に
    ///   揃っており、要約文の長さで縦線の位置がぶれてはいけないため。
    /// - 左右ブロックの間の縦線: 参考画像で各行に実在すると確認した
    ///   (行の上下に少し余白を取った高さで、行の途中に浮いている)。
    /// - 右ブロック(USD/JPY・発言前・現在): ラベル(通貨ペア名・
    ///   「発言前」「現在」)はお気に入りの日付/時刻と同サイズ・同色、
    ///   実際の価格(149.20等)は白の太字、pipsは既存の`ValueFormat.pips`
    ///   (Backend計算済み値をそのまま表示する既存の方針、`HomeSpeechSummary`
    ///   のドキュメントコメント参照)で符号に応じて`changeUpColor`/
    ///   `changeDownColor`に色分け。
    /// HQ再指摘(2026-10-06、3回目)「現在の価格が'...'で切れている」:
    /// 参考画像をピクセル実測して固定したleft/right幅(103等)は、参考
    /// 画像自体のフォントと実機の`V5JPFont`/システムフォントの文字幅が
    /// 想定より違っていたため、実機CIキャプチャでは発言要約・現在価格が
    /// 丸ごと省略記号になって消えるという明確な破綻を起こした(この回の
    /// 前の実装では固定`frame(width:)`+`lineLimit(1)`だけで安全弁が無く、
    /// 入りきらない分がまるごと”...”に潰れていた)。
    /// 対策として固定幅を廃止し、内容に応じた自然なサイズ決めに戻した
    /// 上で、`lineLimit(1)`に加えて`minimumScaleFactor`を安全弁として
    /// 全テキストに付けた — 本当に入りきらない時は(基本サイズ7を保った
    /// まま)わずかに縮小して全文を表示し、二度と”...”で情報が消えない
    /// ようにする。
    ///
    /// HQ指摘(2026-10-06、4回目)「文字サイズを1下げて」「149.2 +28pipsの
    /// 文字間隔を狭めて」「縦線をもう少し右側に」: 発言者名(speakerName)
    /// 以外のテキスト(発言要約・日時/中央銀行・USD/JPY・発言前/現在の
    /// ラベルと数字)を7→6(pipsは6.5→5.5)へ一段階縮小。「現在」の数字と
    /// pipsの間のHStack spacingを3→1に詰めた。縦線(Divider)は左ブロックが
    /// 固定幅ではなくなった(上記3回目の対応)ため、`.padding(.leading, 5)`
    /// で右へ寄せている。
    ///
    /// HQ指摘(2026-10-07、5回目、CIキャプチャで再確認)「パウエルFRB議長の
    /// 3行の間隔を狭めるように」: 左ブロックのVStack spacingを2→0に縮小
    /// (Divider/chevronの修正内容は下のコメント参照)。
    @ViewBuilder private func speechRow(_ speech: HomeSpeechSummary) -> some View {
        NavigationLink(value: AppRoute.speechDetail(id: speech.id)) {
            // HQ再指摘(2026-10-07、2回目)「USD/JPYや149.20や発言前などの
            // 文字サイズを変えないで。元に戻して。縦線から右側をもう少し
            // 左に持ってきてと言っている」: 前回の対応(symbolに
            // `minimumScaleFactor`を追加 + `padding(.leading, -3)`)は
            // 実際には全く足りておらず、右ブロック3行(symbol+pips/発言前/
            // 現在)がすべて`minimumScaleFactor`の下限(0.7)まで縮んで
            // 表示されていた — ちょうど本来の約70%のサイズで、HQが
            // 指摘した「文字サイズが変わっている」の実体そのもの。原因は
            // HStackの一律`spacing: 6`が縦線の前後にも効いていて、
            // 右ブロックに渡る余白を削っていたこと。`spacing: 0`に変えて
            // 必要な間隔だけを各要素に明示的な`padding(.leading:)`で
            // 持たせることで、左側(国旗〜縦線)の間隔は完全に元のまま
            // 保ちつつ、縦線から右側(chevronの手前まで)の間隔だけを
            // 詰めて右ブロックに渡す余白を広げた — 文字サイズ自体
            // (フォントsize指定)は一切変更していない。
            HStack(spacing: 0) {
                CountryFlagView(countryCode: speech.countryCode, diameter: Self.speechFlagDiameter)
                // HQ指示(2026-10-06)「英字を含む文字もNotoTextで表示して」:
                // 発言者名("パウエルFRB議長"のように英字を含む)・日時/
                // 中央銀行行("10/6 08:15 | FRB")・通貨ペア("USD/JPY")・
                // pips("+28 pips")を`NotoText`に変更した。発言要約
                // (`headline`)は日本語のみのため`V5JPFont.text`のまま。
                // HQ再指摘(2026-10-07)「縦線をそろえてというのは上下(高さ)
                // ではなく、パウエル行・ラガルド行・ベイリー行で3本の縦線が
                // 横方向に同じx位置に並ぶように、ということ」: 3回目の対応
                // (上のコメント参照)で「内容に応じた自然な幅」に戻して以来、
                // 発言者名/要約/日時の実際のテキスト幅が行ごとに違う分だけ
                // 縦線のx位置もばらついていた(実測でパウエル行636px・
                // ラガルド行694px・ベイリー行735px — 揃っていなかった)。
                // 固定幅に戻すが、3回目の教訓(固定幅だけでは実機フォントの
                // 幅誤差で文字が"..."に潰れた)を踏まえ、`lineLimit(1)` +
                // `minimumScaleFactor(0.7)`という安全弁は残したまま、現状の
                // 3件の中で最も幅が必要なベイリー行(約98)より少し余裕を
                // 持たせた100に固定した。
                VStack(alignment: .leading, spacing: 0) {
                    NotoText.text(speech.speakerName, size: 7)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    V5JPFont.text(speech.headline, size: 6, weight: .regular)
                        .tracking(-0.4)
                        .foregroundStyle(Self.linkBlue)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    NotoText.text(Self.speechDateOrgText(speech), size: 6)
                        .tracking(-0.4)
                        .foregroundStyle(Self.linkBlue)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .padding(.leading, 6)
                .frame(width: 100, alignment: .leading)

                // HQ指摘(2026-10-07、CIキャプチャで再確認)「縦線を上下で
                // そろえるように」「＞も上下でそろえるように」: 固定
                // `height: 25`は右ブロック(USD/JPY・発言前・現在)の自然な
                // 高さとはほぼ一致していたが、左ブロック(発言者名/要約/
                // 日時、NotoSansJPで組んでいる)は実測で一回り高く、線の
                // 上端/下端がどちらの内容にも揃っていなかった。`maxHeight:
                // .infinity`で行全体の高さ(`speechRowHeight`、外側の
                // `.frame(height:)`で確定)まで伸ばし、両ブロックに対して
                // 常に同じ上下位置になるようにした。＞も同様に明示的な
                // `frame(height:alignment:)`で行の中央に固定し、左右の
                // コンテンツ量に依存しないようにした。
                Divider().overlay(Self.cardBorderColor).frame(maxHeight: .infinity).padding(.vertical, 2).padding(.leading, 11)

                if let symbol = speech.reactionFxSymbol {
                    VStack(alignment: .leading, spacing: 2) {
                        // HQ再指摘(2026-10-06、3回目、CIキャプチャで再々確認)
                        // 「現在の価格がまだ'149...'のように切れている」:
                        // ラベル・価格・pipsを1段のHStackに展開する対応
                        // (直前のコミット)は優先度の問題自体は解消したが、
                        // 3つ分の絶対的な横幅が行の残り幅に対してそもそも
                        // 足りていなかった(優先度はどれが先に縮むかを
                        // 決めるだけで、無から幅を作れない)。pipsを
                        // 「現在」行から1行目のシンボル行へ移した — シンボル
                        // ("USD/JPY")はこれまでも単独で十分な余白を持って
                        // 表示できていたため、pipsと同居させても窮屈に
                        // ならない。これで「発言前」「現在」は共にラベル+
                        // 価格だけの2要素となり、既に問題なく全文表示できて
                        // いた「発言前」と全く同じ構成になる。
                        HStack(spacing: 4) {
                            NotoText.text(symbol, size: 6)
                                .tracking(-0.4)
                                .foregroundStyle(Self.linkBlue)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            if let pips = speech.reactionPips {
                                NotoText.text(ValueFormat.pips(pips), size: 5.5)
                                    .foregroundStyle(pips >= 0 ? Self.changeUpColor : Self.changeDownColor)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.7)
                            }
                        }
                        speechPriceRow(label: "発言前", value: speech.reactionPriceBefore, symbol: symbol)
                        speechPriceRow(label: "現在", value: speech.reactionPriceAfter, symbol: symbol)
                    }
                    .lineLimit(1)
                    .padding(.leading, 2)
                }

                // chevron(＞)はHQ指示により調整対象外。pairRowと同じ
                // `Spacer`パターンでカード右端に固定し、右ブロックを
                // 左に詰めてもchevron自体の位置は動かない。
                Spacer(minLength: 2)

                Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(Self.linkBlue)
                    .frame(height: Self.speechRowHeight, alignment: .center)
            }
            .foregroundStyle(.white)
            .frame(height: Self.speechRowHeight)
        }.buttonStyle(.plain)
    }

    /// `speechRow`の「発言前」「現在」行 — ラベル部分に`minWidth`を設けて
    /// 2行の価格(`149.20`/`149.48`)の開始x位置をおおよそ揃えている
    /// (`width`固定ではなく`minWidth`なので、万一ラベルがそれより広い
    /// 幅を必要としても切れない)。価格本体(`Text`側)は`.layoutPriority(1)`
    /// で、行が窮屈な時にラベルより先に縮まないようにしている(数字が
    /// 消えるより、ラベルが少し縮む方を優先)。
    @ViewBuilder private func speechPriceRow(label: String, value: Double?, symbol: String) -> some View {
        HStack(spacing: 3) {
            Text(label)
                .font(.system(size: 6, weight: .medium))
                .tracking(-0.4)
                .foregroundStyle(Self.linkBlue)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(minWidth: 20, alignment: .leading)
            Text(Self.speechPriceText(value, symbol: symbol))
                .font(.system(size: 6, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .layoutPriority(1)
        }
    }

    /// HQ指摘(2026-10-07、CIキャプチャで再確認)「10:12 | FRBの｜の両サイド
    /// をもう少し広げて」: `tracking(-0.4)`が通常の半角スペース1個分の
    /// 字送りも強く詰めてしまい、"10/6 10:12|FRB"のように｜の前後がほぼ
    /// くっついて見えていたため、｜の両側に半角スペースを2個ずつ入れて
    /// 見た目の余白を確保した。
    /// HQ再指摘(2026-10-07、2回目)「10/07 00:17の07と00の間をもう少し
    /// 広げて」: 同じ理由(`tracking(-0.4)`によるスペース圧縮)で、
    /// `favoriteDateFormatter`("M/d HH:mm")が内部で使う半角スペース1個も
    /// 日付と時刻がほぼくっついて見えていたため、置換で2個に広げた。
    private static func speechDateOrgText(_ speech: HomeSpeechSummary) -> String {
        let dateText = Self.favoriteDateFormatter.string(from: speech.statementDatetime)
            .replacingOccurrences(of: " ", with: "  ")
        guard let organization = speech.organization else { return dateText }
        return "\(dateText)  |  \(organization)"
    }

    /// `ValueFormat.number`はminimumFractionDigits=0のため末尾の0が消える
    /// (149.20→149.2)。参考画像通りの桁数(JPYペア2桁・それ以外4桁)を
    /// 常に保つため、この行専用に固定桁数でフォーマットする。
    private static func speechPriceText(_ value: Double?, symbol: String) -> String {
        guard let value else { return "--" }
        let digits = symbol.contains("JPY") ? 2 : 4
        return String(format: "%.\(digits)f", value)
    }

    /// 「今日の重要イベント」: これから発生する重要イベント — 既発表
    /// (RELEASED)は含めず、`upcomingEvents`(SCHEDULED)のみを時刻順に
    /// 並べる(9回目の削除時点から`HomeViewModel.upcomingEvents`自体は
    /// 存在し続けている)。
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
    /// HQ指示(2026-10-06)「通貨ペア内のUSD/JPYの下に米ドル/円と記載して」。
    /// HQ再指摘(2026-10-07)「米ドル/円の/の両サイドに少し間隔をあけて」:
    /// `speechDateOrgText`の「|」と同じ理由(`tracking(-0.4)`が半角スペース
    /// 1個分の字送りも強く詰めてしまう)で「/」の前後がほぼくっついて
    /// 見えていたため、両側に半角スペースを1個ずつ入れた。
    var displayName: String {
        "\(CountryFlag.japaneseName(forCurrency: baseCurrency)) / \(CountryFlag.japaneseName(forCurrency: quoteCurrency))"
    }
}

