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

    /// HQ指示(2026-10-05、23回目)「赤文字と緑文字が薄いので参考画像にして」
    /// で一旦`V5P.red`/`V5P.green`(アプリ共通トークン)に統一し、続くHQ
    /// 再指摘(2026-10-05)「+0.25%の赤文字と緑文字を濃くして」でさらに濃い
    /// (暗い)専用色(210,18,55)/(0,160,125)に変更していたが、HQ再指摘
    /// (2026-10-05、4回目)「もう少し発行(発光)色みたいに明るくさせて、
    /// 薄くさせるのではない」で方向転換: 「濃い=暗い」ではなく「明るい・
    /// 鮮やか」を求めていたと判明したため、ネオンのような高輝度の色に
    /// 変更し(`pairRow`側で同色のグローシャドウも追加)。
    private static let changeUpColor = Color(red: 255.0 / 255, green: 45.0 / 255, blue: 95.0 / 255)
    private static let changeDownColor = Color(red: 20.0 / 255, green: 235.0 / 255, blue: 165.0 / 255)

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
    @ViewBuilder private func statusBadge(_ text: String, colors: (fill: Color, border: Color)) -> some View {
        Text(text)
            .font(.system(size: 7, weight: .bold))
            .tracking(-0.4)
            .foregroundStyle(.white)
            .frame(width: 32)
            .padding(.vertical, 3)
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
    private static let flagDiameter: CGFloat = 19

    /// HQ再指摘(2026-10-05)「お気に入り内の国旗の丸のサイズは少し小さく
    /// して」: お気に入りの小カードは幅68と他カードの行より狭く、共通の
    /// `flagDiameter`(19)のままだと窮屈だったため、お気に入り専用の
    /// 少し小さいサイズを別途定義した。
    private static let favoriteFlagDiameter: CGFloat = 15

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

    private static let favoritesCardHeight: CGFloat = 103
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
    /// して」: アイコン・タイトルとも同じ`HStack`内にあるため、先頭に
    /// `.padding(.leading, 4)`を加えることで両方まとめて右へ移動させた
    /// (個別にではなく「アイコンと同様に」という指示通り、同じ移動量で
    /// 揃う)。タイトルサイズは11→12に拡大(各アイコン自体のサイズは
    /// 呼び出し側=todayEventsCard/pairsCard/favoritesCard/speechesCardで
    /// それぞれ拡大)。
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
        .padding(.leading, 4)
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
                Image(systemName: "calendar").font(.system(size: 13, weight: .bold)).foregroundStyle(V5P.cyan).shadow(color: Self.iconGlowShadow.color, radius: Self.iconGlowShadow.radius)
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
            // HQ再指摘(2026-10-05、3回目)「時刻14:30の縦幅を大きくし、文字の
            // 間隔を狭めて」: フォントサイズを9→11に拡大(=縦幅拡大)しつつ、
            // `.tracking(-0.6)`で字間を詰め、26幅の列に収まるようにした。
            Text(Self.timeFormatter.string(from: event.releaseDatetime))
                .font(.system(size: 11, weight: .bold))
                .tracking(-0.6)
                .foregroundStyle(.white)
                .fixedSize(horizontal: true, vertical: false)
                .frame(width: 26, alignment: .leading)

            // HQ指示(2026-10-05、23回目)「今日の重要指標の国旗の下にUSDや
            // JPYなどを記載して」。HQ再指摘(2026-10-05)「USDやJPYの文字が
            // 小さい」で5.5→7へ拡大。さらにHQ再指摘(2026-10-05、3回目)
            // 「USDやJPYの文字色を白にして」でグレー(`V5P.muted`)から
            // 白に変更。
            VStack(spacing: 1) {
                CountryFlagView(countryCode: event.countryCode, diameter: Self.flagDiameter)
                Text(event.currencyCode).font(.system(size: 7, weight: .semibold)).foregroundStyle(.white)
            }

            // HQ再指摘(2026-10-05)「予想前回が治らない。参考画像は日本CPIの
            // 下にあるからそこにしろ」: 旧実装は「経済指標」バッジ+タイトルの
            // `HStack`全体をVStackで包み、予想/前回をその下に置いていたため、
            // 左端がバッジの左端(タイトルの左端ではない)に揃ってしまっていた。
            // バッジは1行目だけに留め、タイトル+予想/前回を別のVStackに
            // まとめることで、予想/前回の左端をタイトル(例:日本CPI)の左端に
            // 正確に揃えた。
            HStack(alignment: .top, spacing: 4) {
                V5JPFont.text("経済指標", size: 5.5, weight: .semibold)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 4).padding(.vertical, 2)
                    .background(Self.economicIndicatorBadgeColor, in: Capsule())
                    .fixedSize()

                VStack(alignment: .leading, spacing: 2) {
                    // HQ指示(2026-10-05、23回目)「今日の重要イベント内の
                    // タイトル（FOMC政策など）が大きいし、太いので参考画像と
                    // 同じくらいにして」: 参考画像に本カードの直接の実測対象が
                    // 無いため、同じ参考画像のお気に入りカードに実在する同種の
                    // テキスト(イベント/指標名、「FOMC」)をカード幅基準スケール
                    // (3.786px/ユニット)で代わりに実測(22px→5.84ユニット)し、
                    // 現行実装(size 9)の実機キャプチャ実測(33px/5.1488px/
                    // ユニット→6.41ユニット、9pt→0.712ユニット/pt)から逆算
                    // (5.84/0.712≒8.2)して9→8に縮小。太さも.bold→.semibold。
                    V5JPFont.text(event.indicatorName, size: 8, weight: .semibold)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    if let subtitle = Self.eventSubtitle(event) {
                        // HQ再指摘(2026-10-05、3回目)「予想と前回の文字は
                        // 途切れず、折り返さず全て表示できるようにして」:
                        // `.fixedSize(horizontal: true, vertical: false)`を
                        // 試したが、行全体の幅が足りない場合はそれでも
                        // "..."で省略されたままだった(親の`HStack`が確保
                        // できる幅を超えると、`.fixedSize`だけでは防げない)。
                        // `.lineLimit(1)`を保持したまま`.minimumScaleFactor`
                        // を追加し、幅が足りない時は省略せず文字を縮小して
                        // 必ず全文1行で収まるようにした。
                        V5JPFont.text(subtitle, size: 6, weight: .regular)
                            .foregroundStyle(V5P.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                }
            }
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
        if let forecast = event.forecast { parts.append("予想 \(ValueFormat.number(forecast))") }
        if let previous = event.previous { parts.append("前回 \(ValueFormat.number(previous))") }
        return parts.isEmpty ? nil : parts.joined(separator: "　|　")
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
            HStack(spacing: 3) {
                CountryFlagView(currencyCode: pair.baseCurrency, diameter: Self.flagDiameter)
                CountryFlagView(currencyCode: pair.quoteCurrency, diameter: Self.flagDiameter)
            }
            // HQ再指摘(2026-10-05、4回目)「USD/JPYの文字の幅、155.42の文字の
            // 幅、+0.25%の文字の幅いずれも狭めて」: HIGH/MEDIUMバッジの時と
            // 同じく、文字サイズ(9.5)はそのままに`.tracking(-0.4)`で字間を
            // 詰めて幅だけ狭くした。それに合わせて各列の固定幅(frame)も
            // 46/40/44→42/36/40に縮小。
            Text(pair.displaySymbol).font(.system(size: 9.5, weight: .semibold)).tracking(-0.4).frame(width: 42, alignment: .leading)
            Text(pair.price).font(.system(size: 9.5, weight: .semibold)).tracking(-0.4).monospacedDigit().frame(width: 36, alignment: .center)
            // バグ修正(2026-10-05、2回目): `.fixedSize(horizontal: true,
            // vertical: false)`を試したが、実機キャプチャでは依然として
            // "+0.25"/"%"の2行に折り返されたままだった(行全体の幅が
            // タイトなため、`.fixedSize`だけでは`.frame(width: 40)`による
            // 圧縮を防げなかった)。`Text`に直接`.lineLimit(1)`を付け、
            // 外側の`.frame`を固定幅(width)ではなく最小幅(minWidth)に
            // 変更することで、必要な時は40を超えて広がれるようにし、
            // 折り返しを確実に防いだ。
            HStack(spacing: 1) {
                Text(pair.change).font(.system(size: 9.5, weight: .semibold)).tracking(-0.4).monospacedDigit().lineLimit(1)
                Image(systemName: pair.isUp ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 9.5))
            }
            .foregroundStyle(pair.isUp ? Self.changeUpColor : Self.changeDownColor)
            // HQ再指摘(2026-10-05、4回目)「+0.25%の赤文字と緑文字をもう少し
            // 発行(発光)色みたいに明るくさせて、薄くさせるのではない」:
            // 前回濃くした専用色(210,18,55)/(0,160,125)がむしろ暗く見えた
            // ため、より明るく鮮やかな色に変更し、ネオンのような発光感を
            // 出すため同色のシャドウ(グロー)も追加した(他画面のアイコンで
            // 使っている`iconGlowShadow`と同じ手法)。
            .shadow(color: (pair.isUp ? Self.changeUpColor : Self.changeDownColor).opacity(0.7), radius: 2)
            .frame(minWidth: 40, alignment: .trailing)
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(Self.linkBlue)
        }
        .foregroundStyle(.white)
        .frame(height: Self.pairRowHeight)
    }

    // MARK: - お気に入りカード

    @ViewBuilder private func favoritesCard(_ favorites: [HomeFavoriteItem]) -> some View {
        cardShell(height: Self.favoritesCardHeight) {
            cardHeaderRow(title: "お気に入り", height: Self.favoritesHeaderHeight, showDivider: false) {
                Image(systemName: "star.fill").font(.system(size: 13, weight: .semibold)).foregroundStyle(V5P.cyan).shadow(color: Self.iconGlowShadow.color, radius: Self.iconGlowShadow.radius)
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
                    CountryFlagView(countryCode: countryCode, diameter: Self.favoriteFlagDiameter)
                }
                Spacer()
                Image(systemName: "star").font(.system(size: 10)).foregroundStyle(V5P.muted)
            }
            V5JPFont.text(name, size: 7, weight: .semibold).foregroundStyle(.white).lineLimit(1)
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
                Image(systemName: "quote.bubble.fill").font(.system(size: 13, weight: .semibold)).foregroundStyle(V5P.cyan).shadow(color: Self.iconGlowShadow.color, radius: Self.iconGlowShadow.radius)
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
                    V5JPFont.text(speech.speakerName, size: 7, weight: .semibold)
                    V5JPFont.text(speech.headline, size: 6.5, weight: .regular).foregroundStyle(V5P.muted).lineLimit(1)
                    Text(Self.timeFormatter.string(from: speech.statementDatetime)).font(.system(size: 6, weight: .medium)).foregroundStyle(V5P.muted)
                }
                Spacer(minLength: 4)
                if let symbol = speech.reactionFxSymbol, let change = speech.reactionChangePercent {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(symbol).font(.system(size: 6, weight: .semibold))
                        Text(ValueFormat.percent(change, signed: true))
                            .font(.system(size: 6, weight: .semibold))
                            .foregroundStyle(change >= 0 ? Self.changeUpColor : Self.changeDownColor)
                    }
                }
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(Self.linkBlue)
            }
            .foregroundStyle(.white)
            .frame(height: Self.speechRowHeight)
        }.buttonStyle(.plain)
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
}

