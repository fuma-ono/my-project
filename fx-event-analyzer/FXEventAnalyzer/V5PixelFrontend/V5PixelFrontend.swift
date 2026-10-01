
import SwiftUI

// MARK: - V5 Pixel Design System
//
// HQ "V5 Pixel Frontend" integration (2026-09-24): this file is HQ's
// `Sources/V5PixelFrontend.swift` shared design-system layer (design
// tokens + reusable components), reproduced as given. This supersedes the
// prior "HQ UI Master v5" (`HQV5Frontend/`) integration entirely per HQ's
// explicit instruction that this package is now the authoritative UI.
//
// Two components gained real interactivity (not present in HQ's delivered
// file, which is a static 12-screen visual reference with no navigation):
// - `V5BottomBar.selected` is now a `Binding<Int>` and each tab is a real
///  `Button`, instead of a plain `Int` with no tap target, so the bar
//    actually switches tabs — same visual shape.
// - `V5Header` gained an optional `onBack` closure invoked by the back
//   chevron, instead of a decorative icon with no action.
// Every screen struct (V5Splash, V5Home, etc.) is NOT reproduced here —
// each is rewritten in its own Feature/*/View.swift, keeping the exact
// visual code but replacing HQ's hardcoded demo literals with real
// ViewModel data, the same "adjust connection, not UI" rule already
// established for the prior HQV5 integration.

enum V5P {
    static let W: CGFloat = 234
    static let H: CGFloat = 491

    static let bg0 = Color(red: 0.004, green: 0.020, blue: 0.055)
    static let bg1 = Color(red: 0.006, green: 0.045, blue: 0.100)
    static let panel = Color(red: 0.010, green: 0.075, blue: 0.145)
    static let panel2 = Color(red: 0.015, green: 0.100, blue: 0.185)
    static let line = Color(red: 0.04, green: 0.35, blue: 0.65)
    static let blue = Color(red: 0.02, green: 0.55, blue: 1.0)
    static let cyan = Color(red: 0.00, green: 0.88, blue: 1.0)
    static let text = Color.white
    static let muted = Color(red: 0.60, green: 0.70, blue: 0.82)
    static let red = Color(red: 1.0, green: 0.22, blue: 0.38)
    static let green = Color(red: 0.10, green: 0.88, blue: 0.72)
    static let yellow = Color(red: 1.0, green: 0.80, blue: 0.20)
}

struct V5Viewport<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        GeometryReader { geo in
            let scale = min(geo.size.width / V5P.W, geo.size.height / V5P.H)
            ZStack {
                V5Background()
                content()
            }
            .frame(width: V5P.W, height: V5P.H)
            .scaleEffect(scale)
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .background(DesignTokens.Colors.backgroundPrimary)
        .ignoresSafeArea()
    }
}

struct V5Background: View {
    /// HQ指示(2026-09-30): タブバーの新しい参考画像を確認した際、「背景は
    /// ログイン画面やスプラッシュ画面と同じか、違うなら合わせてほしい」と
    /// 指摘された。実際、SplashView/LoginViewは`DesignTokens.Colors.
    /// brandBackgroundGradient`を使う一方、この`V5Background`(V5Viewportを
    /// 使う全画面 — Home/指標一覧/分析/検索/設定/各詳細画面)は独自の
    /// `V5P.bg0/bg1`3色グラデーションを使っており、実際に色味が異なって
    /// いた(brandBackgroundGradient側がやや明るく青みが強い)。HQへの
    /// 確認の結果「タブバーだけでなく全画面の背景を揃える」との回答だった
    /// ため、この行を`brandBackgroundGradient`に差し替えて統一した(同じ
    /// 理由で、この単色グラデーションを個別に複製していたHome/Indicators/
    /// EventDetail/IndicatorDetail/MovementDetail/HistoricalComparison/
    /// HistoricalEventDetail/Accountの各`loadingScaffold`も同様に差し替え
    /// 済み)。
    ///
    /// HQ指示(2026-09-30、追加): 画面全体を囲んでいた光る青い枠線
    /// (`RoundedRectangle(cornerRadius: 12).stroke(...)`)について「いらない
    /// から消して」との指摘。以前の指示(タブバー参考画像の件)もこの画面全体の
    /// 枠線を指していたと判明したため、ここで完全に削除した。V5Viewportを
    /// 使う全画面(Home/指標一覧/分析/検索/設定/各詳細画面)から一括で消える。
    var body: some View {
        ZStack {
            DesignTokens.Colors.brandBackgroundGradient
                .frame(width: V5P.W, height: V5P.H)

            RadialGradient(
                colors: [V5P.blue.opacity(0.12), .clear],
                center: .center,
                startRadius: 5,
                endRadius: 170
            )
            .frame(width: V5P.W, height: V5P.H)
        }
    }
}

struct V5Card: View {
    let frame: CGRect
    let content: AnyView
    init(_ frame: CGRect, @ViewBuilder content: () -> some View) {
        self.frame = frame
        self.content = AnyView(content())
    }
    var body: some View {
        content
            .padding(7)
            .frame(width: frame.width, height: frame.height, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(
                        LinearGradient(colors: [V5P.panel2, V5P.panel],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(V5P.line.opacity(0.75), lineWidth: 0.65)
            )
            .position(x: frame.midX, y: frame.midY)
    }
}

struct V5Text: View {
    let text: String
    let size: CGFloat
    let weight: Font.Weight
    let color: Color
    var body: some View {
        Text(text)
            .font(.system(size: size, weight: weight))
            .foregroundStyle(color)
            .lineLimit(nil)
    }
}

struct V5Badge: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text)
            .font(.system(size: 8, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(color.opacity(0.16), in: Capsule())
            .overlay(Capsule().stroke(color.opacity(0.3), lineWidth: 0.5))
    }
}

struct V5Button: View {
    let title: String
    var body: some View {
        Text(title)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(.white)
            .frame(height: 29)
            .frame(maxWidth: .infinity)
            .background(
                LinearGradient(colors: [V5P.blue, V5P.cyan.opacity(0.85)],
                               startPoint: .leading, endPoint: .trailing),
                in: RoundedRectangle(cornerRadius: 7)
            )
    }
}

struct V5TopStatus: View {
    var body: some View {
        HStack {
            Text("9:41").font(.system(size: 8, weight: .semibold)).foregroundStyle(.white)
            Spacer()
            HStack(spacing: 4) {
                Image(systemName: "cellularbars").font(.system(size: 7))
                Image(systemName: "wifi").font(.system(size: 8))
                Image(systemName: "battery.100").font(.system(size: 9))
            }.foregroundStyle(.white)
        }
        .frame(width: 204, height: 16)
        .position(x: 117, y: 17)
    }
}

struct V5BottomBar: View {
    @Binding var selected: Int
    /// 方向転換(2026-09-30、HQより3枚目の参考画像
    /// `docs/projects/fx-event-analyzer/mockups/bottom-tabbar-reference-v2-capsule.png`):
    /// 「タブのデザインがダサい、画像を完全再現して」との明示指示を受け、
    /// 前回(v1画像ベースの画面幅いっぱいの帯)から、この画像通りの浮遊する
    /// カプセル(スタジアム型)に作り直した。前回「青い線はいらない」との
    /// 指示を『カプセルを囲む枠線を消せ』の意味だと解釈していたが、実際は
    /// `V5Background`が全画面に描いていた枠線(下記参照、そちらは削除済み)
    /// を指していたと判明したため、このカプセル自体は画像通りの淡い縁の
    /// 光彩(rim light)を再現している — これは「消してほしい枠線」とは別物
    /// という前提。
    ///
    /// 参考画像をピクセル実測(測定方法はSettingsViewのドキュメントコメント
    /// と同じ)した結果: カプセルは画面幅いっぱいではなく左右に余白を持って
    /// 浮遊し、上下とも完全な半円(スタジアム型、角丸半径=高さ/2)。内部の
    /// 塗りは背景とほぼ同化する程度に薄く、輪郭のみ淡く光る。この実測画像
    /// 自体は横長の単体モックアップ(実機のアスペクト比ではない)のため、
    /// 余白/角丸/選択時のグロー・アンダーラインは実測値をそのまま座標化
    /// せず、234幅のV5空間に収まる比率(既存カードの左右余白10pt=カード幅
    /// 214に揃える)で再構成している。
    ///
    /// 再調整(2026-09-30、HQ指摘「画像と全く違う、少し立体的で単調な色では
    /// ない」): 最初の実装はアイコン・文字を単色(白/シアン)で塗っていたが、
    /// 参考画像をピクセル実測し直した結果、単色ではなく上が明るく(ほぼ白〜
    /// 明るいシアン)下が暗い(青)方向の縦グラデーション(ガラス/金属的な
    /// 光沢)だと判明した(実測値の例: ホームアイコン上端≈RGB(230,247,254)
    /// →下端≈RGB(120,172,223)、選択中の下線バー上端≈RGB(1,234,251)→
    /// 下端≈RGB(0,79,162))。これを`iconGradient`/`selectedIconGradient`
    /// として反映し、アイコン・ラベル・選択インジケータ(グロー円・下線)
    /// すべてに適用した。あわせてアイコンにごく薄い落影を付け、カプセル
    /// 本体の塗りにも上下グラデーションを加えて、参考画像のガラスのような
    /// 立体感に近づけている。
    ///
    /// さらに再調整(2026-09-30、HQ指摘「アイコンのデザインが参考画像と
    /// どこが一緒か、完璧に再現して」): 参考画像を1px単位で再実測(ピクセル
    /// 明度スキャン)し、5つのアイコンをそれぞれ検証した。
    /// - ホーム/検索/設定は実測した輪郭(三角屋根+四角い胴体+ドア型の
    ///   切り欠き/円+柄/歯車リング)がSF Symbolsの`house`/`magnifyingglass`/
    ///   `gearshape`とほぼ一致しており、変更していない。
    /// - 「指標一覧」は実測の結果、3本の縦棒(幅同一・下端揃え・高さ比≈
    ///   0.40:0.68:1.0・棒間の隙間≈棒幅の半分)というシンプルな形状で、
    ///   SF Symbolsの近似では棒の比率/間隔が実測値と食い違っていたため、
    ///   `V5BarsIcon`として実測比率通りに自前描画するよう差し替えた。
    /// - 「分析」は実測の結果、山谷のあるジグザグ線の先に矢尻が付く形状
    ///   だったが、これまで使っていた`chart.xyaxis.line`はただの座標軸+
    ///   波線(矢尻なし)であり、形状として全く別物だった(単純な選択ミス)。
    ///   矢尻付きの上昇ジグザグ線を持つ`chart.line.uptrend.xyaxis`に差し
    ///   替えた — 既知の差分として、このSF Symbolには軸の短い目盛り線が
    ///   付随するが(参考画像のジグザグ矢印単体には無い)、13pt表示では
    ///   ほぼ視認できない程度のため許容した。
    ///
    /// 重大な訂正(2026-09-30、HQ指摘「ホーム/設定/分析のアイコンが全く違う、
    /// 勝手に解釈しないで。○は参考画像にあるのか確認して。色も全然違う」):
    /// 自分のCIキャプチャと参考画像を実際に並べて比較して初めて気づいた、
    /// 3つの実際の誤り。
    /// 1. アイコンの塗り: 「未選択時はアウトライン、選択時は塗りつぶし」
    ///    という切り替えは旧v1参考画像(画面幅いっぱいの帯)の仕様であり、
    ///    このv2カプセル参考画像には一切根拠がない — 参考画像のホーム/
    ///    指標一覧/検索/設定は(非選択の状態で)すべて塗りつぶしの太い
    ///    シルエットで描かれている。実際、CIキャプチャで確認すると非選択の
    ///    `house`(アウトライン版)は屋根と胴体が視覚的に分離した細い線画に
    ///    なっており、参考画像の「屋根と胴体が一体化した塗りつぶしの家」
    ///    とは似ても似つかなかった。`house.fill`/`gearshape.fill`を常時
    ///    使うよう修正した(選択状態による切り替えは色/グラデーションのみ)。
    /// 2. 選択時の丸いグロー: 参考画像を水平方向にピクセル実測すると、
    ///    アイコン中心から左右になだらかに明度が上下する連続的なグラデー
    ///    ションであり、輪郭線(縁)は存在しない。しかし実装では
    ///    `Circle().stroke(...)`で明確な円のリング線を追加していたため、
    ///    CIキャプチャでは参考画像にはっきり見えない硬い円の輪郭線が
    ///    目立っていた。このstrokeを削除し、境界の無い柔らかい
    ///    RadialGradientのみにした。
    /// 3. 色: アイコン/ラベルのグラデーション下端に、検証済みの
    ///    `V5P.blue`(既存アプリの濃いアクセント青、RGB≈(5,140,255))を
    ///    流用していたが、参考画像を複数アイコンで実測した下端の実際の
    ///    色はもっと明るく彩度の低い青(未選択≈RGB(115,164,220)、選択中
    ///    ≈RGB(0,79,162))だった。実測値に置き換えた。
    ///
    /// 4回目の訂正(2026-09-30、HQ指摘「分析のアイコンが全く違う、選択中の
    /// 色が違う、○がもう少し大きい」): 自分のCIキャプチャの「分析」アイコン
    /// を参考画像と並べて直接比較し、初めて気づいた。`chart.line.uptrend.
    /// xyaxis`はL字型の座標軸(縦線+横線)込みのグリフであり、以前「13ptでは
    /// ほぼ視認できない程度の差分」と判断していたのは誤りで、実際には軸線が
    /// はっきり見える大きさで描画され、参考画像の「軸なし、ジグザグ矢印
    /// 単体」とは輪郭が全く別物だった。参考画像をピクセル単位で線の中心線を
    /// 追跡し(谷→山→谷→矢尻という経路)、`V5AnalysisIcon`として軸なしの
    /// ジグザグ+矢尻のみを自前描画するよう差し替えた。あわせて、選択中の
    /// 色をアンダーラインバーではなく「分析」アイコン自体から直接実測し
    /// 直した結果、下端はRGB(0,79,162)ではなくRGB(0,123,241)寄りだった
    /// ため`selectedIconGradient`を訂正。グロー円も参考画像を水平実測
    /// (明度が完全に背景に戻るまでの幅)した結果、カプセル高さに対する比率
    /// が測定し直すとやや大きめだったため、直径を40→46に拡大した。
    ///
    /// 5回目の訂正(2026-09-30、HQ指摘「分析のアイコンがまだ違う」「設定の
    /// 丸が小さい」「外枠の色が違う、もう少し横に長く」): 3点同時に修正。
    /// 1. 分析アイコン: 前回のピクセル追跡が実はクロップ範囲の右端で
    ///    カプセル自体のリム光彩(円弧)を矢尻の一部と誤認しており、境界
    ///    ボックスを実際より大きく見誤っていた。明度スキャンを描画色
    ///    (輝度しきい値90〜150)で厳密にやり直し、ジグザグ線の4点
    ///    (尾→山→谷→矢尻手前の節)と矢尻自体の5頂点(凹みのある「旗」型、
    ///    矢尻背面に切り欠きがある実際の輪郭)を再測定して座標を全面的に
    ///    差し替えた。
    /// 2. 設定アイコン: 参考画像のギアを中心から8方向(0°刻み45°)に
    ///    放射状スキャンし、穴半径≈13px・歯の谷の外径≈22px・歯先の外径
    ///    ≈29pxを実測(穴:歯先比≈0.45)。`gearshape.fill`のSF Symbolは
    ///    これより明らかに小さい穴で描画されており、これがHQ指摘の原因
    ///    だったため、リング(`Circle().stroke`、内径=穴・外径=歯の谷)+
    ///    歯8枚(`RoundedRectangle`を45°間隔で放射状に回転配置)を自前
    ///    描画する`V5GearIcon`に差し替え、実測比率をそのまま反映した。
    /// 3. カプセル外枠: 選択グローの膨らみを除いた素のリムのみを実測した
    ///    ところ、色は上(明るい青、実測平均RGB≈(42,103,173))→下(暗い青、
    ///    実測平均RGB≈(16,75,146))の単純な2色グラデーションで、これまで
    ///    の実装のようなシアンを含む対称グラデーションではなかったため
    ///    実測値に置き換えた。高さについても、選択グローの膨らみを除いた
    ///    カプセル本体のみ(アイコンの無い区間)を複数箇所で実測すると
    ///    幅:高さ比≈6〜7:1で、既存実装の214:44(≈4.86:1)よりかなり細長い
    ///    と判明。この参考画像は実機比率のモックアップではなく(既存doc
    ///    コメント通り)234幅キャンバスに収まる範囲でしか再現できないため、
    ///    横幅214(既存カードの左右余白10ptに合わせた上限)は変えず、
    ///    高さを44→34に縮小して比率214:34(≈6.29:1)に近づけた。
    ///
    /// 横幅の拡張(2026-10-01、HQ指摘「外枠をもう少し横に長く」→その後
    /// 「アイコン同士の間隔は参考画像と一致させて、外枠だけホームと設定の
    /// 横にもう少し余白が欲しい」に訂正): 最初はアイコンを並べる`HStack`
    /// 自体の幅を214→224に広げてしまい、アイコン同士の間隔まで一緒に
    /// 広がってしまっていた。正しくは、アイコンの配置幅(`iconsWidth`)は
    /// 参考画像の間隔に合わせた実測値214のまま変えず、外枠(カプセルの
    /// 背景・リム)だけをそれより広い`barWidth`(224)にして、アイコン列を
    /// その中央に配置することで、ホーム・設定アイコンと外枠の間にのみ
    /// 余白(約5pt)を追加した。
    ///
    /// 縦方向の余白修正(2026-10-01、HQ指摘「アイコンの位置は固定で外枠の
    /// 上の部分が狭い、下部分と余白の間隔は統一して。選択している丸の
    /// 大きさは外枠をはみ出さないようにして」): CIキャプチャをピクセル単位
    /// で実測したところ、アイコン上端からアンダーライン下端までの実際の
    /// 描画高さがbarHeight(34)とほぼ一致しており(フォント/SF Symbolの
    /// 行送りを含む実測高さ≈33.3)、上下の余白がほぼ0になっていたと判明した
    /// (テキストの太いアイコン塊が詰まる上側がより窮屈に見える)。また
    /// 選択時のグロー円(直径46)はbarHeight(34)そのものより大きく、
    /// どう配置しても上下いずれかにはみ出さざるを得ない計算だった。
    /// 対応として、(1) `barHeight`を34→39に拡大し、中身(アイコン・
    /// ラベル・アンダーライン)の相対位置やサイズは変えずに
    /// `.frame(maxHeight:.infinity)`の自動中央寄せで生まれる余白を
    /// 上下均等に確保、(2) 選択グロー円を直径46→24に縮小して新しい
    /// barHeight内に収まるようにし、(3) 念のためアイコン列全体に
    /// `.clipShape`でカプセル形状のクリップを追加し、将来どんな値でも
    /// 外枠をはみ出さないことを保証した。
    ///
    /// HQから改めてタブバー単体の高解像度参考画像が提供され(2026-10-01、
    /// 「外枠の色やグロー円、上下の余白が参考画像と全く違う」)、この画像を
    /// ピクセル単位で実測し直した結果、前回の対応(上下均等な余白・グロー円
    /// 直径24)は実は誤りだったと判明した。実測結果(リム上端y≈386・
    /// リム下端y≈595、カプセル高さ≈209px換算):
    /// - 上下の余白は均等ではなく、上側(リムからアイコン上端)≈52px・
    ///   下側(アンダーライン下端からリム)≈5pxと、上側が圧倒的に広く
    ///   下側はほぼゼロに近い比率(≈10:1)だった。アイコン・テキスト・
    ///   アンダーラインという縦積み構成では、アイコンが一番上に来るため、
    ///   グロー円を含むコンテンツ全体の視覚的重心が自然と上寄りになり、
    ///   均等な余白にすると逆に実機と乖離することが分かった。
    /// - 選択時のグロー円の直径はカプセル高さの約0.81倍(≈170px/209px)で、
    ///   直径24(≈0.62倍)よりも一回り大きかった。
    /// - カプセルの塗り(背景)は、アイコンの無い中立領域で実測すると
    ///   (RGB≈(5,26,57)付近〜(2,16,42)付近)既存の`panel`/`panel2`に
    ///   近い値ではあるが、不透明度ブレンドに頼ると背後の要素次第で
    ///   暗くなりすぎるため、実測値を直接色として指定する形に変更した。
    /// この実測に基づき、`.frame(maxHeight:.infinity)`による自動中央寄せを
    /// やめ、`alignment:.top`+明示的な上パディングに置き換えて
    /// 「上は広く・下はほぼゼロ」という実際の配分を再現し、グロー円を
    /// 直径24→30に拡大、カプセル塗りを実測色の直接指定に変更した。
    /// 上パディングは最初6ptで試したが、CIキャプチャで実測すると上:下の
    /// 比率が約1.3:1までしか開かず、参考画像の約10:1にはまだ遠かったため、
    /// 9ptに再調整した(この時点ではまだCI未検証、次のラウンドで要確認)。
    private static let barHeight: CGFloat = 40
    private static let iconsWidth: CGFloat = 214
    private static let barWidth: CGFloat = 224
    private static let bottomMargin: CGFloat = 8
    private static let iconGradient = LinearGradient(
        colors: [Color(red: 0.90, green: 0.97, blue: 1.0), Color(red: 0.45, green: 0.64, blue: 0.86)],
        startPoint: .top, endPoint: .bottom
    )
    private static let selectedIconGradient = LinearGradient(
        colors: [V5P.cyan, Color(red: 0.0, green: 0.48, blue: 0.945)],
        startPoint: .top, endPoint: .bottom
    )
    /// カプセル外枠(リム)のグラデーション。参考画像から直接実測した色
    /// (上端≈RGB(42,103,173)、下端≈RGB(16,75,146)、単純な2色・シアンなし)
    /// — 詳細は本structのドキュメントコメント「5回目の訂正」参照。
    private static let capsuleRimGradient = LinearGradient(
        colors: [Color(red: 0.165, green: 0.404, blue: 0.678), Color(red: 0.063, green: 0.294, blue: 0.573)],
        startPoint: .top, endPoint: .bottom
    )

    var body: some View {
        HStack(spacing: 0) {
            tab(0, "ホーム") { _ in
                Image(systemName: "house.fill").font(.system(size: 13, weight: .semibold))
            }
            tab(1, "指標一覧") { _ in
                V5BarsIcon()
            }
            tab(2, "分析") { isSelected in
                V5AnalysisIcon(isSelected: isSelected)
            }
            tab(3, "検索") { _ in
                Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold))
            }
            tab(4, "設定") { _ in
                V5GearIcon()
            }
        }
        .frame(width: Self.iconsWidth, height: Self.barHeight)
        .frame(width: Self.barWidth, height: Self.barHeight)
        .clipShape(RoundedRectangle(cornerRadius: Self.barHeight / 2))
        .background(
            RoundedRectangle(cornerRadius: Self.barHeight / 2)
                .fill(LinearGradient(
                    colors: [Color(red: 0.020, green: 0.102, blue: 0.224), Color(red: 0.008, green: 0.063, blue: 0.165)],
                    startPoint: .top, endPoint: .bottom))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Self.barHeight / 2)
                .stroke(Self.capsuleRimGradient, lineWidth: 1.3)
                .shadow(color: V5P.blue.opacity(0.5), radius: 3)
        )
        .position(x: V5P.W / 2, y: V5P.H - Self.bottomMargin - Self.barHeight / 2)
    }
    /// `Button`ではなく`.onTapGesture`を使っている理由: 実機相当のCIキャプチャ
    /// で確認したところ、`Button` + `.buttonStyle(.plain)`でも選択中タブの
    /// 背後にシステム既定のハイライト用カプセル(参考画像にはない)が写り込んで
    /// いた。ボタンとしての既定の見た目を一切持たない`.onTapGesture`に置き換
    /// えることで、参考画像通り背景なし・アイコンと文字の色/グリフのみで選択
    /// 状態を表す見た目にした。
    @ViewBuilder func tab(_ index: Int, _ title: String, @ViewBuilder icon: (Bool) -> some View) -> some View {
        let isSelected = index == selected
        let gradient = isSelected ? Self.selectedIconGradient : Self.iconGradient
        // 下線(選択インジケータ)はVStackの一要素として常に領域を確保し
        // opacityのみ切り替える構成にしている(2026-09-30訂正)。以前は
        // `.overlay(alignment: .bottom)` + 固定`.padding(.bottom, 6)`で
        // アイコンの高さと無関係にタブセル底部へ直接貼り付けていたため、
        // 分析アイコンの高さを10.5pt→13ptに拡大した際にVStackの内容物が
        // 伸びて下線が「分析」ラベルの文字に重なって表示される回帰が
        // CIキャプチャで見つかった。VStackの通常の子要素にすることで、
        // アイコンの高さに関わらずレイアウトが自動的に詰まらないようにした。
        VStack(spacing: 3) {
            icon(isSelected)
                .foregroundStyle(gradient)
                .shadow(color: .black.opacity(0.35), radius: 1, y: 1)
                .background(
                    Circle()
                        .fill(RadialGradient(colors: [V5P.cyan.opacity(0.42), V5P.cyan.opacity(0.16), .clear],
                                              center: .center, startRadius: 1, endRadius: 15))
                        .frame(width: 30, height: 30)
                        .opacity(isSelected ? 1 : 0)
                )
            Text(title).font(.system(size: 7, weight: .semibold)).foregroundStyle(gradient)
            Capsule()
                .fill(LinearGradient(colors: [V5P.cyan, V5P.blue], startPoint: .top, endPoint: .bottom))
                .frame(width: 16, height: 2.2)
                .shadow(color: V5P.cyan.opacity(0.7), radius: 2)
                .opacity(isSelected ? 1 : 0)
        }
        .padding(.top, 9)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .contentShape(Rectangle())
        .onTapGesture {
            selected = index
        }
        .accessibilityAddTraits(.isButton)
    }
}

/// 「指標一覧」タブのアイコン。参考画像(`bottom-tabbar-reference-v2-capsule.png`)
/// を1px単位で実測した結果(棒3本、幅同一、下端揃え、高さ比≈0.40:0.68:1.0、
/// 棒間の隙間≈棒幅の半分)をそのまま座標化した自前描画。SF Symbolsの近似
/// (`chart.bar`)では実測比率と食い違っていたため、V5BottomBarのドキュメント
/// コメントに記載の通りこちらに差し替えた。色は`.foregroundStyle(.foreground)`
/// で呼び出し側(`tab`)が設定したグラデーションをそのまま継承する。
private struct V5BarsIcon: View {
    var body: some View {
        HStack(alignment: .bottom, spacing: 1.5) {
            bar(heightFraction: 0.40)
            bar(heightFraction: 0.68)
            bar(heightFraction: 1.0)
        }
        .frame(width: 14, height: 13, alignment: .bottom)
    }

    @ViewBuilder private func bar(heightFraction: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 0.8)
            .fill(.foreground)
            .frame(width: 3, height: 13 * heightFraction)
    }
}

/// 「分析」タブのアイコン。参考画像(`bottom-tabbar-reference-v2-capsule.png`)
/// には座標軸が一切無く、山谷のあるジグザグ線の先に矢尻が付いた形状のみが
/// 描かれている。SF Symbolsの`chart.line.uptrend.xyaxis`はL字型の座標軸
/// (縦線+横線)込みのグリフのため使わず、線の中心線をピクセル単位で追跡した
/// 経路を自前描画にしている。矢尻は塗りつぶし(参考画像でも実測濃度が線
/// 本体より高い=塗りつぶしだったため)。色は`.foregroundStyle(.foreground)`
/// で呼び出し側(`tab`)が設定したグラデーションをそのまま継承する。
///
/// 座標の再実測(2026-09-30、HQ指摘「分析のアイコンがまだ違う」):
/// 前回の座標は、矢尻付近をクロップして測るときに実は視野の右端で
/// カプセル本体のリム光彩(円弧、アイコンとは無関係)を拾ってしまい、
/// 境界ボックスと矢尻の大きさを実際より大きく見誤っていた(誤:
/// 幅125px相当/矢尻が全体の約半分 → 実際は幅81px相当)。輝度しきい値
/// 90〜150で明度スキャンをやり直し、実際のグリフ境界(幅81×高さ53px、
/// アスペクト比≈1.53:1)内でジグザグ線4点と、矢尻の背面に凹みのある
/// 実際の5頂点輪郭を再追跡して座標を全面的に差し替えた。
///
/// さらに再実測(2026-09-30、HQ指摘「分析アイコンがおかしい、選択の色も
/// おかしい」): 上記の座標修正後も自分のCIキャプチャと参考画像を同じ
/// 縮尺で並べて直接比較したところ、2つの実際の誤りが見つかった。
/// 1. 線の太さ: 参考画像の線幅を谷→矢尻方向で垂直に実測すると
///    ≈13px(アイコン全体の高さ53pxに対し約25%)あり、これまでの
///    `lineWidth: h * 0.16`は明らかに細すぎた。太さ不足のせいで
///    関節が丸い「ビーズ」状に見えず、グラデーションの明暗差も
///    小さく見えて「色が違う」という指摘の一因になっていたため、
///    `h * 0.25`に太くした。
/// 2. 谷から矢尻への立ち上がり(shaftJoint): 参考画像を再度ピクセル
///    追跡すると、谷(valley)からの3本目の線分は緩やかにではなく
///    1本目の山(peak)とほぼ同じ高さまで急角度で立ち上がってから
///    矢尻に接続していた。以前の座標(y比率0.47、峰の0.32よりかなり
///    低い)はこの急な立ち上がりを反映できておらず、シルエット全体が
///    間延びして見えていたため、y比率を0.26に修正した(矢尻側の凹み
///    頂点`headNotch`/背面下端`headBottomPoint`は実測値のまま変更して
///    いないが、太い線の丸端がこの新しい接続点で矢尻の塗り部分と
///    十分重なるため、継ぎ目は視覚的に生じない)。あわせてアイコン
///    自体が他のタブアイコン(13pt前後)よりかなり小さく(高さ10.5pt)
///    描かれていたため、高さ13ptに拡大した(アスペクト比は実測値の
///    ままなので幅も20ptに拡大)。
///
/// 角の丸め(2026-09-30、HQ指摘「矢印の先の部分がまだ変」): 拡大した
/// CIキャプチャを参考画像とさらに拡大して見比べたところ、輪郭の座標
/// 自体はおおむね合っているが、矢尻が直線の`addLine`だけで結んだ鋭い
/// 多角形(宝石のような硬い角)になっており、参考画像の「角が丸い、
/// なめらかな矢印」とは質感が異なっていたと判明。最初は塗りつぶしPathと
/// 全く同じ頂点を`lineJoin: .round`で重ねてストロークする方法を試したが、
/// CIキャプチャで確認すると、fillとstrokeがそれぞれ自分のジオメトリを
/// 基準にグラデーションを別々に解決してしまい、境界に額縁のような不自然
/// な二重輪郭が出る副作用があった。塗り+丸め用ストロークの合成シルエット
/// は`.mask`側に回し、色の決定はアイコン全体を覆う1枚の`Rectangle`だけに
/// 担わせることで、単一のグラデーション基準に統一して解消している。
///
/// 矢尻の形状を全面的に再測定(2026-09-30、HQ指摘「これが一緒とは思えない、
/// 完璧に再現して」): それまでの5頂点「凧型」の輪郭は誤った形状モデルに
/// 基づいていたと判明し、6頂点(丸い本体+右下のバーブ)に差し替えたが、
/// これも次の指摘で置き換えられた。
///
/// 決定版(2026-09-30、HQから単体アイコンの高解像度参考画像が提供された
/// 「分析アイコンはこれです、完全再現してください」): これまでずっと
/// タブバー全体のモックアップ画像の小さく不鮮明な一部分(周囲の光彩や
/// カプセルのリムと重なり合い、輝度スキャンにノイズが多かった)から
/// 矢尻の形状を推測していたが、この単体高解像度画像で1px単位の行/列
/// スキャンをやり直した結果、これまでの形状モデルがすべて誤りだったと
/// 判明した。実際の構造(1254×1254pxの画像、アイコン全体のbboxは
/// およそx:409-864・y:433-745、幅455×高さ312・アスペクト比≈1.46:1):
/// - ジグザグ線: 尾(タブ)→山(peak)→谷(valley)→矢尻、の4点。各関節
///   (尾・山・谷)には線幅より一回り大きい丸い「ビーズ」が明確に存在する
///   (実測: 線幅≈42px、ビーズ直径≈76px、高さ312pxに対する比率は
///   線幅≈0.135・ビーズ直径≈0.24)。
/// - 矢尻: 単純な三角形ではなく、背面(軸に近い側)に1つの凹みがある
///   「旗」型の4頂点(上端≈(847,433)・先端≈(864,447)・下端≈(835,573)・
///   凹み≈(728,473))。以前の「丸い本体+バーブ」モデルは実在せず、
///   単に不鮮明な画像のノイズを誤読していたと分かった。
/// 塗り(ジグザグ線・3つのビーズ・矢尻の塗りと角丸めストローク)は
/// すべて1つの`ZStack`にまとめてシルエット化し、アイコン全体を覆う
/// 1枚の`Rectangle`の`.mask`に回すことで、単一のグラデーション基準に
/// 統一している(個別に`.foregroundStyle(.foreground)`を解決させると
/// 各図形が自分のジオメトリを基準にグラデーションを別々に解決し、
/// 色や境界がずれる副作用が過去に判明したため)。
///
/// 再修正(2026-09-30、HQ指摘「矢印として成り立っていない、三角と線が
/// ずれ過ぎている、丸の大きさや色味も全く違う」): 各点を高解像度画像で
/// 1px単位のwidest-row/widest-col走査により再実測し直したところ、
/// 2つの具体的な誤りが見つかった。
/// 1. ビーズ直径の実測が誤っていた(前回は線に紛れて53〜60pxと過小
///    評価していたが、正しくは尾ビーズの最大幅を直接実測すると76px
///    あった=線幅の約1.8倍)。高さ比を0.19→0.24に修正。
/// 2. `shaftJoint`(軸線の終点)を矢尻の凹み座標と混同しており、実際の
///    軸線の傾き(尾→山→谷の実測点から算出)を延長した先とは全く
///    異なる位置にあったため、線が矢尻と違う方向を向いて見えていた。
///    軸線の傾きを矢尻の輪郭(凹み〜下端の辺)まで延長した交点を
///    再計算し、shaftJointをそこに置き直した。
/// この修正を実機CIキャプチャで検証したところ、矢印としての可読性と
/// 線/矢尻の接続は解消したことを確認した(接合部を拡大しても継ぎ目や
/// ずれは見えない)。一方でビーズの直径:線幅比は実測(≈1.87)とほぼ
/// 一致(実装≈1.78、CI実測≈1.9〜2.0)しており、サイズ自体は指摘ほど
/// 大きくは外れていなかった。改めて参考画像のビーズ中心を垂直方向に
/// 色サンプリングすると、上端付近がほぼ白に近い高輝度シアン
/// (RGB≈(5,255,255))で、そこから下に向かって既存の2色グラデーション
/// (シアン→青)へ急速に遷移する「光沢球」のハイライトがあると判明した。
/// CIキャプチャを同様にサンプリングすると、ハイライトが存在せず単純な
/// 線形グラデーションのみだったため、「色味が全く違う」という指摘の
/// 主因はビーズの色相ではなく、このハイライトの欠落だったと結論した。
/// そのため、各ビーズの上側に白系`RadialGradient`のハイライトを独立した
/// レイヤーとして追加した(マスク対象には含めない。マスク対象に含めると
/// 単一グラデーション基準の原則が崩れ、過去に発生した二重輪郭と同種の
/// 副作用を招くため)。
///
/// 根本的な構造モデルの誤りが判明(2026-09-30、HQ指摘「三角と線の部分が
/// 途切れている、丸の大きさが違う、グラデーションを再現できていない、
/// 三角が綺麗な形になっていない、矢印として成り立っていない、位置も違う、
/// ピクセル単位で測り完璧に再現して」): これまでの実装はすべて「太い線
/// (stroke)+独立した円3つ+独立した矢尻ポリゴン」を`.mask`で合成する
/// というモデルに基づいていたが、参考画像をOpenCV(`cv2.findContours`)で
/// 輪郭追跡し直した結果、このモデル自体が誤りだったと判明した。実際の
/// 形状は「尾から矢尻まで続く1本の、太さが変化するリボン状の輪郭」で
/// あり、矢尻は独立した三角形ではなく、そのリボンが先端で末広がりに
/// 広がった形(片側は丸いコーナー、反対側は鋭く凹んだノッチ)に過ぎない。
/// 独立図形を輪郭だけ合わせて重ねる従来モデルでは、線の丸端と矢尻ポリゴン
/// の境界が実測シルエットとは微妙に異なる形で結合してしまい、何度座標を
/// 補正しても「継ぎ目」や「成り立っていない矢印」に見える原因になって
/// いたと考えられる。
///
/// そのため今回、以下の手順で輪郭そのものを直接実測し、モデル全体を
/// 差し替えた:
/// 1. 参考画像を輝度しきい値で二値化し、周囲のカプセル光彩リング(細い円弧、
///    アイコン本体より明るい箇所もあり誤って拾いやすい)を形態学的収縮
///    (erosion)で除去してからグリフ本体の連結成分だけを再構成
///    (morphological reconstruction)して分離。
/// 2. `cv2.findContours`でグリフ全体(ジグザグ線+3つのビーズ+矢尻)の
///    外輪郭を1本の連続した輪郭として抽出し、`cv2.approxPolyDP`で43点の
///    多角形に単純化。この43点をそのままグリフのbbox(実測455×312px、
///    アスペクト比≈1.458:1、既存の19×13pt枠≈1.462:1とほぼ一致)に対する
///    相対座標に変換し、`outline`定数としてそのままPathの頂点に採用した
///    (独立した線・円・矢尻ポリゴンを合成するのをやめ、実測シルエット
///    そのものを1つの閉多角形としてfillする方式に変更)。
/// 3. 3つのビーズの中心・直径は、形態学的オープニング(直径49pxの円形
///    カーネル)で細い線を除去して3つの独立した円塊に分離した上で、各々の
///    重心(centroid)とbboxから算出(尾≈(0.088,0.870)・山≈(0.377,0.479)・
///    谷≈(0.560,0.690)、直径比≈h×0.266)。この中心に、既存のハイライト
///    (白系`RadialGradient`)を引き続き重ねている。
/// この新しい43点の実測輪郭をPIL上で実機想定解像度(57×39px相当)で
/// レンダリングし、なめらかに矢印として繋がった形になることを確認して
/// から反映した。
///
/// 色・グラデーションの再実測(2026-10-01、HQ指摘「矢印の先部分の色が違う、
/// 参考画像はグラデーションっぽい、丸の白ハイライトは参考画像にない、
/// 淡色っぽく見える」): ビーズ部分をさらに拡大して見比べたところ、参考
/// 画像のビーズには光沢球のような白いハイライト「点」は存在せず、単に
/// 周囲と同じ色をそのまま引き継いだ、ほぼ均一な円でしかなかったと判明。
/// 前回追加した白`RadialGradient`の独立ハイライトは誤った解釈(存在しない
/// 特徴を描き足してしまっていた)だったため削除した。
/// また、グリフ内部の色を縦方向に複数地点でサンプリングし直すと
/// (しきい値>400で二値化し近傍も前景の点のみ採用): 矢尻の先端付近
/// (上端0%)は(190,251,251)とほぼ白に近い明るいシアンで、そこから急速に
/// 赤成分が失われて約30%地点で(17,246,248)の純粋な明るいシアンになり、
/// そこから下端にかけて赤成分ゼロのまま緑成分だけが(246→165)へ緩やかに
/// 減少して青みの強い色に変化していた。既存の2色線形グラデーション
/// (シアン(0,224,255)→青(0,122,241))は、この「上端が白っぽい」という
/// 特徴を欠いており、矢尻が参考画像より単調な色に見えていた原因だった。
/// そのため3色ストップの`LinearGradient`(上から順に実測値をそのまま採用)
/// に置き換えた。このグラデーションはタブバー共通の`selectedIconGradient`
/// とは別に分析アイコン専用の定数として持たせ(他アイコンは別の参考画像
/// 領域から個別較正されているため、共通定数を書き換えると影響範囲が
/// 広すぎる)、選択状態かどうかを`isSelected`として直接受け取るように
/// 変更した。
private struct V5AnalysisIcon: View {
    /// 参考画像から`cv2.findContours`+`approxPolyDP`で直接抽出した、
    /// グリフ全体(尾ビーズ→線→山ビーズ→線→谷ビーズ→線→矢尻)の外輪郭。
    /// グリフのbbox(実測455×312px)に対する相対座標(0...1)。
    private static let outline: [(CGFloat, CGFloat)] = [
        (0.9978, 0.0192), (0.9824, 0.0000), (0.9604, 0.0000), (0.7143, 0.0994),
        (0.7011, 0.1250), (0.7033, 0.1506), (0.7758, 0.2404), (0.5582, 0.5705),
        (0.5297, 0.5769), (0.4615, 0.4872), (0.4484, 0.4038), (0.4154, 0.3590),
        (0.3714, 0.3462), (0.3319, 0.3654), (0.3011, 0.4135), (0.2923, 0.4968),
        (0.1121, 0.7564), (0.0571, 0.7564), (0.0198, 0.7949), (0.0000, 0.8622),
        (0.0110, 0.9391), (0.0352, 0.9776), (0.0637, 0.9968), (0.0945, 1.0000),
        (0.1297, 0.9808), (0.1604, 0.9295), (0.1670, 0.8686), (0.3582, 0.5929),
        (0.3978, 0.5897), (0.4659, 0.6795), (0.4835, 0.7660), (0.5143, 0.8141),
        (0.5495, 0.8333), (0.6066, 0.8173), (0.6308, 0.7885), (0.6484, 0.7404),
        (0.6505, 0.6731), (0.6440, 0.6442), (0.8505, 0.3429), (0.9231, 0.4487),
        (0.9429, 0.4519), (0.9604, 0.4359), (0.9956, 0.1122),
    ]
    /// 参考画像を縦方向に実測した3色グラデーション(上端≈(190,251,251)の
    /// 白に近いシアン→30%地点≈(17,246,248)の明るいシアン→下端≈(0,165,253)
    /// の青みのシアン)。ビーズ・矢尻・線すべてが同じグラデーションを
    /// そのまま引き継ぐだけで、個別のハイライトは存在しない。
    private static let selectedGradient = LinearGradient(
        gradient: Gradient(stops: [
            .init(color: Color(red: 0.745, green: 0.984, blue: 0.984), location: 0.0),
            .init(color: Color(red: 0.067, green: 0.965, blue: 0.973), location: 0.3),
            .init(color: Color(red: 0.0, green: 0.647, blue: 0.992), location: 1.0),
        ]),
        startPoint: .top, endPoint: .bottom
    )

    let isSelected: Bool

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height

            let glyph = Path { path in
                path.addLines(Self.outline.map { CGPoint(x: $0.0 * w, y: $0.1 * h) })
                path.closeSubpath()
            }

            Group {
                if isSelected {
                    Rectangle().fill(Self.selectedGradient).mask(glyph)
                } else {
                    Rectangle().fill(.foreground).mask(glyph)
                }
            }
        }
        .frame(width: 19, height: 13)
    }
}

/// 「設定」タブのアイコン(2026-09-30、HQ指摘「真ん中の丸が小さいので
/// もう少し大きくして」)。参考画像のギアを中心から放射状に8方向
/// (45°刻み)実測したところ、穴半径≈13px・歯の谷の外径≈22px・歯先の
/// 外径≈29px(穴:歯先比≈0.45)と、SF Symbolsの`gearshape.fill`が描く
/// 穴よりも明らかに大きい比率だった。SF Symbolでは穴サイズを調整できない
/// ため、リング(`Circle().stroke`、内径=穴・外径=歯の谷)+歯8枚
/// (`RoundedRectangle`を45°間隔で放射状に回転配置)の自前描画に差し替え、
/// 実測比率をそのまま反映した。色は`.foregroundStyle(.foreground)`で
/// 呼び出し側(`tab`)が設定したグラデーションをそのまま継承する。
private struct V5GearIcon: View {
    private let size: CGFloat = 13
    private let outerRadius: CGFloat = 6.5
    private let ringOuterRadius: CGFloat = 4.93
    private let holeRadius: CGFloat = 2.91

    var body: some View {
        let ringWidth = ringOuterRadius - holeRadius
        let overlap = ringWidth * 0.4
        let innerEdge = ringOuterRadius - overlap
        let toothLength = outerRadius - innerEdge
        let centerDistance = (innerEdge + outerRadius) / 2

        ZStack {
            Circle()
                .stroke(.foreground, lineWidth: ringWidth)
                .frame(width: ringOuterRadius + holeRadius, height: ringOuterRadius + holeRadius)
            ForEach(0..<8, id: \.self) { i in
                RoundedRectangle(cornerRadius: 0.5)
                    .fill(.foreground)
                    .frame(width: size * 0.16, height: toothLength)
                    .offset(y: -centerDistance)
                    .rotationEffect(.degrees(Double(i) * 45))
            }
        }
        .frame(width: size, height: size)
    }
}

struct V5Header: View {
    let title: String
    let back: Bool
    let star: Bool
    var onBack: (() -> Void)?
    var body: some View {
        HStack(spacing: 8) {
            if back {
                Button {
                    onBack?()
                } label: {
                    Image(systemName: "chevron.left").font(.system(size: 13, weight: .semibold))
                }.buttonStyle(.plain)
            }
            Text(title).font(.system(size: 14, weight: .bold))
            Spacer()
            if star { Image(systemName: "star.fill").font(.system(size: 12)).foregroundStyle(V5P.yellow) }
        }
        .foregroundStyle(.white)
        .frame(width: 204, height: 24)
        .position(x: 117, y: 40)
    }
}

// MARK: - Chart

struct V5CandleChart: View {
    var body: some View {
        Canvas { ctx, size in
            let plot = CGRect(x: 5, y: 4, width: size.width - 10, height: size.height - 15)
            for i in 0...4 {
                let y = plot.minY + plot.height * CGFloat(i) / 4
                var p = Path()
                p.move(to: CGPoint(x: plot.minX, y: y))
                p.addLine(to: CGPoint(x: plot.maxX, y: y))
                ctx.stroke(p, with: .color(.white.opacity(0.09)), lineWidth: 0.5)
            }
            for i in 0...4 {
                let x = plot.minX + plot.width * CGFloat(i) / 4
                var p = Path()
                p.move(to: CGPoint(x: x, y: plot.minY))
                p.addLine(to: CGPoint(x: x, y: plot.maxY))
                ctx.stroke(p, with: .color(.white.opacity(0.07)), lineWidth: 0.5)
            }
            let vals: [CGFloat] = [0.56,0.52,0.57,0.49,0.44,0.50,0.45,0.48,0.43,0.47,0.40,0.44,0.39,0.43,0.37,0.34,0.38,0.31,0.34,0.27,0.30,0.24,0.20,0.23]
            for i in 0..<vals.count {
                let x = plot.minX + plot.width * CGFloat(i) / CGFloat(vals.count - 1)
                let y = plot.minY + plot.height * vals[i]
                let bodyH = 4.0 + CGFloat((i * 7) % 6)
                let up = i % 3 != 0
                let wick = Path { p in
                    p.move(to: CGPoint(x: x, y: y - 5))
                    p.addLine(to: CGPoint(x: x, y: y + bodyH + 5))
                }
                ctx.stroke(wick, with: .color(up ? V5P.cyan : V5P.red), lineWidth: 0.7)
                let rect = CGRect(x: x - 1.6, y: y, width: 3.2, height: bodyH)
                ctx.fill(Path(roundedRect: rect, cornerRadius: 1), with: .color(up ? V5P.cyan : V5P.red))
            }
        }
        .background(V5P.bg0.opacity(0.5), in: RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(V5P.line.opacity(0.55), lineWidth: 0.5))
    }
}

struct V5MiniBarChart: View {
    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .bottom, spacing: 5) {
                ForEach([0.72,0.82,0.69,0.88,0.78,0.75], id: \.self) { h in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(LinearGradient(colors: [V5P.cyan, V5P.blue], startPoint: .top, endPoint: .bottom))
                        .frame(width: (geo.size.width - 25) / 6, height: geo.size.height * h)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        }
    }
}

// MARK: - Shared event components

struct V5EventRow: View {
    let flag: String
    let name: String
    let code: String
    let badge: String
    let badgeColor: Color
    let forecast: String
    let actual: String
    let previous: String
    var body: some View {
        HStack(spacing: 5) {
            Text(flag).font(.system(size: 15))
            VStack(alignment: .leading, spacing: 2) {
                Text(code).font(.system(size: 8, weight: .bold))
                Text(name).font(.system(size: 8, weight: .semibold)).lineLimit(1)
            }
            Spacer()
            V5Badge(text: badge, color: badgeColor)
            Image(systemName:"chevron.right").font(.system(size: 7)).foregroundStyle(V5P.muted)
        }
        .overlay(alignment: .bottom) {
            HStack(spacing: 0) {
                metric("予想", forecast)
                metric("結果", actual)
                metric("前回", previous)
            }
            .offset(y: 18)
        }
    }
    @ViewBuilder private func metric(_ t: String, _ v: String) -> some View {
        VStack(spacing: 1) {
            Text(t).font(.system(size: 6)).foregroundStyle(V5P.muted)
            Text(v).font(.system(size: 10, weight: .bold))
        }
        .frame(maxWidth: .infinity)
    }
}
