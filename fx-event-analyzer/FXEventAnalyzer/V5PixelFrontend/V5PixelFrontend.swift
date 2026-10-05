
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

    /// HQ「V5 Bottom Bar / ヘッダー最終仕様」で与えられる数値(44pt・16ptなど)は
    /// 実機上の実寸ポイントであり、V5キャンバス(234×491)の座標単位とは別物 —
    /// そのままV5単位として使うと誤りになる、とHQ自身が明記している。
    /// `V5Viewport`は`scale = min(geo.width/234, geo.height/491)`で一律拡大
    /// しており、このプロジェクトのCI実機キャプチャ基準デバイス(iPhone 16 Pro、
    /// 論理サイズ402×874pt)では234×491というキャンバス比(≈0.4766)がiPhoneの
    /// 画面比(402/874≈0.460)より横長のため、常に幅基準(402/234)でスケールが
    /// 決まる。この基準スケールを使い、実寸pt値をV5単位に逆算する
    /// (V5単位 = 実寸pt ÷ 基準スケール)ことで、CI実機キャプチャ上で指定された
    /// 実寸pt通りに検証できるようにしている。
    static let headerRefScale: CGFloat = 402.0 / 234.0
    static func ptToV5(_ realPt: CGFloat) -> CGFloat { realPt / headerRefScale }

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

/// HQ指示(2026-10-01、「日本語のみNoto Sans JPへ変更」)。
/// 英数字は既存のシステムフォント(SF Pro)を維持し、日本語部分だけ
/// Noto Sans JPに切り替える。`Font.custom(..., weight:)`という組み合わせは
/// 存在しない(カスタムフォントのウェイトはファイル自体で決まる)ため、
/// このプロジェクトのヘッダー/タブバーのラベルが一律Semiboldであることを
/// 踏まえ、Google Fontsのバリアブルフォント`NotoSansJP[wght].ttf`から
/// wght=600(SemiBold)を静的インスタンス化した`NotoSansJP-SemiBold.ttf`
/// 一本だけをバンドルしている(`Resources/Fonts/`、`project.yml`の
/// `UIAppFonts`に登録)。PostScript名は実際にインスタンス化したファイルを
/// fontToolsで検査して確認した値(`NotoSansJP-SemiBold`)。
enum V5JPFont {
    private static let postScriptName = "NotoSansJP-SemiBold"

    /// ひらがな・カタカナ・CJK統合漢字・和文記号(句読点「。」「、」や
    /// 中点「・」を含む)・全角英数/半角カナのUnicodeレンジで日本語
    /// 文字かどうかを判定する。英数字・半角記号・スペースは対象外。
    private static func isJapanese(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x3000...0x303F, 0x3040...0x309F, 0x30A0...0x30FF,
             0x4E00...0x9FFF, 0xFF00...0xFFEF:
            return true
        default:
            return false
        }
    }

    /// `string`を日本語/非日本語の連続区間に分割し、日本語部分だけ
    /// `NotoSansJP-SemiBold`、それ以外は既存のシステムフォントを適用した
    /// `Text`を連結して返す。文字列そのものを分割・改行させるような
    /// レイアウト変更はしない — あくまで同一行内でのフォント切替。
    static func text(_ string: String, size: CGFloat, weight: Font.Weight = .semibold) -> Text {
        guard !string.isEmpty else { return Text(verbatim: "") }
        var result: Text?
        var runStart = string.startIndex
        var runIsJapanese: Bool?
        func flush(upTo end: String.Index) {
            guard runStart < end else { return }
            let run = String(string[runStart..<end])
            let piece = (runIsJapanese == true)
                ? Text(verbatim: run).font(.custom(postScriptName, size: size))
                : Text(verbatim: run).font(.system(size: size, weight: weight))
            result = (result.map { $0 + piece }) ?? piece
        }
        for index in string.indices {
            let jp = string[index].unicodeScalars.contains(where: isJapanese)
            if runIsJapanese == nil {
                runIsJapanese = jp
            } else if jp != runIsJapanese {
                flush(upTo: index)
                runStart = index
                runIsJapanese = jp
            }
        }
        flush(upTo: string.endIndex)
        return result ?? Text(verbatim: string)
    }
}

struct V5Viewport<Content: View>: View {
    /// HQ指示(2026-10-04、11回目)「ヘッダーの下に明らかに線が入ってて、
    /// そこから色が変わっている」の原因調査で判明した構造的な問題への対応。
    ///
    /// `V5Viewport`は実機の画面縦横比(iPhoneはおよそ0.460)とV5キャンバスの
    /// 縦横比(234/491≒0.4766)がわずかに異なるため、`scale = min(...)`
    /// (幅基準)でスケールすると、縦方向にキャンバスがscreen全体を埋め
    /// きれず、上下に隙間(実測約15.3pt=46px@3x)ができる。この隙間には
    /// この`ZStack`の外側にある`.background(backgroundPrimary)`の単色が
    /// そのまま見えるため、通常(内側の`V5Background()`も同じ単色)は
    /// 隙間と中身の境目が同色で見分けられず問題にならなかった。
    ///
    /// しかしHome画面だけは単色`V5Background()`の代わりに実画像
    /// (`HomeHeaderGlow`、`HomeView.homeHeaderStreak`)を背景として使うように
    /// なったため、画像の縁の色が単色の隙間と食い違い、画面最上部/最下部に
    /// 「そこだけ色が変わる」くっきりした横線として見えてしまっていた
    /// (実機キャプチャで両端とも実測、上端：y=45で(1,21,41)→y=46で
    /// (1,32,63)に1px差で変化。下端も対称に同じ現象を確認)。
    ///
    /// 修正: 背景だけ`content()`とは別に`fullBleedBackground`として受け取り、
    /// V5キャンバスのスケール・レターボックスを経由せず`geo.size`(実機の
    /// 画面全体、隙間を含む)にそのまま合わせて敷く。`content()`(ヘッダー・
    /// カード・タブバー等、V5絶対座標に依存する要素)は従来通りレターボックス
    /// される側に残す — 背景画像だけが画面全体を継ぎ目なく覆うことで、
    /// 隙間と中身が同じ1枚の画像になり境目が消える。`fullBleedBackground`を
    /// 渡さない既存の全呼び出し元(Home以外の全画面)は`nil`がデフォルトのため
    /// 従来通り単色`V5Background()`のまま、挙動は変化しない。
    var fullBleedBackground: AnyView? = nil
    @ViewBuilder let content: () -> Content
    var body: some View {
        GeometryReader { geo in
            let scale = min(geo.size.width / V5P.W, geo.size.height / V5P.H)
            ZStack {
                if let fullBleedBackground {
                    fullBleedBackground
                        .frame(width: geo.size.width, height: geo.size.height)
                }
                ZStack {
                    if fullBleedBackground == nil {
                        V5Background()
                    }
                    content()
                }
                .frame(width: V5P.W, height: V5P.H)
                .scaleEffect(scale)
            }
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
    /// ため、この行を`brandBackgroundGradient`に差し替えて統一した。
    ///
    /// HQ指示(2026-09-30、追加): 画面全体を囲んでいた光る青い枠線
    /// (`RoundedRectangle(cornerRadius: 12).stroke(...)`)について「いらない
    /// から消して」との指摘。以前の指示(タブバー参考画像の件)もこの画面全体の
    /// 枠線を指していたと判明したため、ここで完全に削除した。V5Viewportを
    /// 使う全画面(Home/指標一覧/分析/検索/設定/各詳細画面)から一括で消える。
    ///
    /// HQ指示(2026-10-02)「中身を作成していく前に背景を変更する、今スプラッシュ
    /// 画面に合わせているが、上部の暗い部分の単色に変えてほしい」: Splash/Login
    /// はブランドの「見せ場」画面として`brandBackgroundGradient`のままだが、
    /// それ以外のアプリ本体の画面(V5Viewportを使う全画面)はこのグラデーション
    /// から切り離し、グラデーションの最も暗い色(`backgroundPrimary`、
    /// グラデーションのy=0/0.97地点と同じ色)の単色塗りに変更した。同じ理由で、
    /// この単色塗りを個別に複製していたHome/Indicators/EventDetail/
    /// IndicatorDetail/MovementDetail/HistoricalComparison/
    /// HistoricalEventDetail/Accountの各`loadingScaffold`も同様に差し替え済み
    /// (読み込み中〜読み込み完了の切り替わりで背景が変わって見えないため)。
    ///
    /// HQ指示(2026-10-02、追加)「画面中央付近の淡い青の放射状グローをなくして」:
    /// 単色化後も残っていた中央の`RadialGradient`装飾を削除し、完全な単色のみに
    /// した。
    var body: some View {
        DesignTokens.Colors.backgroundPrimary
            .frame(width: V5P.W, height: V5P.H)
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

/// HQ指示(2026-10-02、4回目)「国旗はUnicode絵文字ではなく画像アセットと
/// して扱ってください」。Home/イベント詳細/指標詳細/指標一覧など、国旗を
/// 表示する全画面共通の実装 — `CountryFlag.imageName(for:)`で解決した
/// Asset Catalog画像(`Resources/Assets.xcassets/FlagXX.imageset`、1:1の
/// 正方形)を`.resizable().scaledToFill()`で指定サイズいっぱいに広げてから
/// `clipShape(Circle())`で円形に切り抜く、どの国・通貨でも同一の処理。
/// 特定の国旗だけフォントサイズやオフセットを個別調整する実装(絵文字
/// ベースの旧実装で7回試して不安定だったアプローチ)は行わない。
/// 対応する画像が無い国コードは、中立的な円(国コード頭文字)にフォール
/// バックする — 存在しない国旗画像を捏造しない。
struct CountryFlagView: View {
    private let imageName: String?
    private let fallbackLabel: String
    private let diameter: CGFloat

    init(countryCode: String, diameter: CGFloat) {
        self.imageName = CountryFlag.imageName(for: countryCode)
        self.fallbackLabel = countryCode
        self.diameter = diameter
    }

    /// `pairRow`のように通貨コードから代表国を割り出して表示する場合向け。
    init(currencyCode: String, diameter: CGFloat) {
        self.imageName = CountryFlag.imageName(forCurrency: currencyCode)
        self.fallbackLabel = currencyCode
        self.diameter = diameter
    }

    var body: some View {
        Group {
            if let imageName {
                Image(imageName)
                    .resizable()
                    .scaledToFill()
            } else {
                Circle()
                    .fill(V5P.panel2)
                    .overlay(
                        Text(fallbackLabel.prefix(2).uppercased())
                            .font(.system(size: diameter * 0.4, weight: .bold))
                            .foregroundStyle(V5P.muted)
                    )
            }
        }
        .frame(width: diameter, height: diameter)
        .clipShape(Circle())
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

struct V5BottomBar: View {
    @Binding var selected: Int

    /// 10回目の全面刷新(2026-10-04、HQより新しい参考画像が提供され
    /// 「タブはこのデザインにして」): これまでの「浮遊するカプセル」形状
    /// (下記、旧ドキュメントコメントに記録)を廃止し、画面幅いっぱいの帯
    /// (フローティングではなく左右マージン無し)+上端のうっすらした
    /// 区切り線、という新しいデザインに全面的に作り直した。
    ///
    /// 参考画像(1806×871、ホームタブ選択中)をPythonでピクセル実測した
    /// 結果(デバイス幅402pt基準、スケール402/1806≒0.2226pt/px):
    /// - 5タブは等間隔(タブセル幅361px≒80.4pt)で画面全幅に並んでおり、
    ///   左右マージンや浮遊する外枠は無い。
    /// - 上端の区切り線はごく淡い(背景RGB(0,17,38)に対しピーク
    ///   RGB(1,26,55)程度の控えめなハイライト)。
    /// - 選択中(ホーム)のアイコン色はほぼ純粋なシアン(実測コア値
    ///   RGB(0,236-238,253-255)、既存`V5P.cyan`とほぼ一致)で、アイコン・
    ///   ラベル双方の周囲に柔らかい発光(グロー)が広がっている。
    /// - 非選択(指標・カレンダー・検索・設定)のアイコン・ラベルは単色の
    ///   淡いラベンダー寄りの水色(実測RGB(115-130,160-178,214-233)、
    ///   上下グラデーションでは無く平坦な単色)で、グローは無い。
    /// - 旧実装にあった選択インジケータの下線(Capsule)は、この参考画像
    ///   には存在しない(選択状態はアイコン・ラベルの色とグローのみで
    ///   表現されている)ため削除した。
    /// - アイコン形状: ホームは塗りつぶしの家(`house.fill`、変更無し)。
    ///   指標一覧は従来の塗りつぶし棒グラフから一転して、アウトライン
    ///   (線画)の棒グラフだったため`V5BarsIcon`を`.stroke`ベースに変更
    ///   した。カレンダー・検索は従来通りアウトライン寄りの形状
    ///   (`calendar`/`magnifyingglass`)のままで大きな齟齬は無かったため
    ///   形状自体は維持している。設定の歯車は当初、旧参考画像向けに自前
    ///   描画した`V5GearIcon`(ギアの輪とギア歯を別々に塗りつぶす実装)を
    ///   そのまま流用していたが、HQ指摘(11回目、2026-10-04)「設定の歯車
    ///   マークを塗りつぶしではなく参考画像と同じにしてください」で見直す
    ///   と、この参考画像の歯車は全体が同じ太さの1本の輪郭線で描かれた
    ///   中空のアウトラインで、`V5GearIcon`の「塗りつぶした輪+塗りつぶした
    ///   歯」とは質感が異なっていた。`calendar`/`magnifyingglass`と同じく
    ///   SF Symbolsの標準アウトライングリフ`gearshape`(`.fill`を付けない
    ///   通常ウェイト)に差し替えることで、他のアウトラインアイコンと同じ
    ///   仕組みで自然に中空の輪郭線になるようにした(`V5GearIcon`自体は
    ///   旧カプセルUI向けの実装記録として残してあるが、呼び出しは無くなった)。
    /// - 縦方向の実測(区切り線を基準に、アイコン上端までの余白28px≒6.2pt、
    ///   アイコン高さ≈85px≒18.9pt、アイコン〜ラベル間21px≒4.7pt、
    ///   ラベル高さ≈40px≒8.9pt、ラベル下端〜画面最下端113px≒25.1pt)から、
    ///   帯全体の高さ(区切り線〜画面最下端)≈302px≒67.2pt→V5単位
    ///   `ptToV5(67.2)≒39.1`を算出し、`barHeight`を採用した。帯は画面下端に
    ///   フラッシュするため`bottomMargin`は無し(0)にした。
    private static let barHeight: CGFloat = 39
    /// 11回目の調整(2026-10-04、HQ「タブのアイコンと文字をもう少し下げて
    /// ください」「タブの文字をもう少しサイズを大きくしてください」):
    /// `topPadding`を6.2→11pt、`tabLabelSize`を9→11ptへそれぞれ拡大した。
    /// `barHeight`(39)に対しコンテンツ合計(新`topPadding`
    /// `ptToV5(11)≈6.4` + アイコン`ptToV5(19)≈11.1` + 間隔`ptToV5(4.7)≈2.7` +
    /// ラベル`ptToV5(11)≈6.4`)は26.6V5単位で、下側に12V5単位程度の余白が
    /// 残るため、はみ出しの心配は無い。
    private static let topPadding: CGFloat = V5P.ptToV5(11)
    private static let iconLabelGap: CGFloat = V5P.ptToV5(4.7)
    /// SF Symbolsベースのアイコン(`.font(.system(size:14,...))`で描画)と、
    /// 独自描画アイコン(`V5BarsIcon`、内部は実測済みの固定pt値)の両方を
    /// 同じ最終サイズに正規化するための比率。旧実装からそのまま踏襲している
    /// 仕組み(詳細は`tab`内コメント参照)。
    private static let tabIconSize: CGFloat = V5P.ptToV5(19)
    private static let tabIconScale: CGFloat = tabIconSize / 14
    private static let tabLabelSize: CGFloat = V5P.ptToV5(11)
    private static let selectedColor = V5P.cyan
    private static let unselectedColor = Color(red: 128.0 / 255, green: 174.0 / 255, blue: 228.0 / 255)
    private static let dividerColor = Color(red: 0.35, green: 0.62, blue: 0.92).opacity(0.3)

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Self.dividerColor).frame(height: 0.6)
            HStack(spacing: 0) {
                tab(0, "ホーム") { _ in
                    Image(systemName: "house.fill").font(.system(size: 14, weight: .semibold))
                }
                tab(1, "指標") { _ in
                    V5BarsIcon()
                }
                tab(2, "カレンダー") { _ in
                    Image(systemName: "calendar").font(.system(size: 14, weight: .semibold))
                }
                tab(3, "検索") { _ in
                    Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .semibold))
                }
                tab(4, "設定") { _ in
                    Image(systemName: "gearshape").font(.system(size: 14, weight: .semibold))
                }
            }
        }
        .frame(width: V5P.W, height: Self.barHeight, alignment: .top)
        .position(x: V5P.W / 2, y: V5P.H - Self.barHeight / 2)
    }

    /// `Button`ではなく`.onTapGesture`を使っている理由(旧実装から踏襲):
    /// 実機相当のCIキャプチャで確認したところ、`Button` + `.buttonStyle(.plain)`
    /// でも選択中タブの背後にシステム既定のハイライト用カプセルが写り込んで
    /// いたため。
    @ViewBuilder func tab(_ index: Int, _ title: String, @ViewBuilder icon: (Bool) -> some View) -> some View {
        let isSelected = index == selected
        let color = isSelected ? Self.selectedColor : Self.unselectedColor
        VStack(spacing: Self.iconLabelGap) {
            icon(isSelected)
                .scaleEffect(Self.tabIconScale, anchor: .bottom)
                .frame(height: Self.tabIconSize)
                .foregroundStyle(color)
                .shadow(color: isSelected ? color.opacity(0.9) : .clear, radius: isSelected ? 5 : 0)
                .shadow(color: isSelected ? color.opacity(0.6) : .clear, radius: isSelected ? 10 : 0)
            V5JPFont.text(title, size: Self.tabLabelSize)
                .foregroundStyle(color)
                .shadow(color: isSelected ? color.opacity(0.7) : .clear, radius: isSelected ? 4 : 0)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.top, Self.topPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .contentShape(Rectangle())
        .onTapGesture {
            selected = index
        }
        .accessibilityAddTraits(.isButton)
    }
}

/// 旧実装(2026-09-30〜2026-10-04、浮遊するカプセル形状)の変遷記録。
/// 2026-10-04の全面刷新(上記`V5BottomBar`冒頭コメント参照)でこの形状
/// 自体は廃止されたが、各アイコン(`V5BarsIcon`/`V5AnalysisIcon`/
/// `V5GearIcon`)のピクセル実測に基づく自前描画という成果物自体は今回も
/// (一部`.stroke`化以外は)引き継いでいるため、実装記録として残している。
///
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
    /// 9ptに再調整した。
    ///
    /// さらなる微調整(2026-10-01、HQ指摘「外枠の線が細い方がいい」「グロー円が
    /// 下の線(アンダーライン)まで含んだきれいな円に」「指標一覧と設定の文字の
    /// 位置が他と違う、揃えて」):
    /// 1. カプセル外枠のストローク幅を1.3→0.9に細くした。
    /// 2. グロー円をアイコン単体の背景からVStack全体(アイコン+ラベル+
    ///    アンダーライン)の背景に移し、直径30→34に拡大。これにより円が
    ///    アイコンだけでなく下のアンダーラインまで自然に内包する「きれいな
    ///    円」になった。
    /// 3. 「指標一覧」「設定」のラベルだけ他の3タブより上にずれて見える問題を
    ///    CIキャプチャで実測したところ、実際に約17px(換算約3.3pt)分高い
    ///    位置にずれていた。原因はSF Symbols(`house.fill`・`magnifyingglass`)
    ///    には明示的な`.frame()`が無く、フォントサイズ13ptでもグリフの実際の
    ///    バウンディングボックス高さが13ptちょうどにならず、自前描画アイコン
    ///    (`V5BarsIcon`・`V5GearIcon`、どちらも`.frame(height:13)`で厳密に13pt)
    ///    と食い違っていたためと判明。`icon(isSelected)`呼び出し直後に
    ///    `.frame(height:13)`を一律で追加し、5つのアイコンすべてのレイアウト上の
    ///    高さを強制的に統一することで解消した。
    ///
    /// HQ「V5 Bottom Bar 最終仕様」(2026-10-01、文字サイズ・位置の質問への回答を
    /// 受けての確定仕様)に合わせ、アイコン高さ13→14pt(SF Symbolsも
    /// フォントサイズ13→14に追従)、ラベル7→8pt・行高さを自動から10pt固定に
    /// 変更。コンテンツ高さが従来の約30.2ptから約32.2ptに伸びるため、絶対条件
    /// 「カプセル内寸40ptを超えないこと」を満たすか`padding.top`(初期値9pt)を
    /// CI実機キャプチャで実測して確認する必要がある。
    ///
    /// HQ指示(2026-10-04)「フッターの改修から入ろう、参考画像と高さを合わせて」
    /// を受け、`bottom-tabbar-reference-v2-capsule.png`を改めてPythonで座標
    /// 実測し直した(カプセル本体のみ、選択グローの膨らみや前回の高解像度
    /// 参考画像の記憶値には頼らず、リポジトリに現存するこの1枚から直接測定)。
    /// 結果: リム上端y≈392・下端y≈598(カプセル高さ≈206px)、左端x≈85・
    /// 右端x≈1450(カプセル幅≈1365px) — 幅:高さ比≈6.63:1。これは前回の
    /// 「6〜7:1」という粗い近似よりも細長い側の値で、既存のbarWidth:barHeight=
    /// 224:40(≈5.6:1)は参考画像よりかなり寸胴(高さが相対的に大きすぎる)
    /// だったと判明した。横幅224(既存カードの左右余白10ptに合わせた基準)は
    /// 変えず、比率を合わせる形で高さのみ40→34(224/6.63≈33.8)に再縮小した。
    ///
    /// あわせて、選択タブ(「分析」相当、現在は最初のタブ=ホームで代用して
    /// 実測)と非選択タブ(「ホーム」)の双方をズームして実測し直したところ、
    /// 旧ドキュメントコメントに記録されていた「上の余白:下の余白≈10:1」という
    /// 値は誤りだったと判明した(どの参考画像から得た数値か特定できず、
    /// 現存するこの1枚を直接測り直すと上≈45〜47px・下≈45〜50pxでほぼ均等
    /// 「1:1」に近い — 選択時の下線はこの下側余白の中に収まって描かれており、
    /// 下側余白自体を追加で押し広げてはいない)。この実測に基づき、`tab`内の
    /// `padding.top`も均等配分前提に作り直した(詳細は下記`tab`のコメント)。
    /// 7回目の調整(2026-10-04、HQ「次はタブにいこう。参考画像と高さ、間隔、
    /// 大きさを揃えて」): 新しいHome参考画像(852×1846、フル幅の旧スタイル
    /// タブバー)の「ホーム/指標/検索/設定」4タブ(現行に無い「分析」タブは
    /// 除外)をPythonでピクセル実測し、実機換算pt(852px=402pt換算)で現行
    /// 実装(CI実機キャプチャ、1206px=402pt、3x)と比較した。
    /// - アイコン高さ: 参考画像平均16.9pt vs 現行21.7pt(現行が約1.28倍大きい)
    /// - ラベル高さ: 参考画像平均19.0pt vs 現行11.9pt(現行が約0.6倍、かなり
    ///   小さい — 参考画像はラベルがアイコンとほぼ同等かやや大きい)
    /// 現行はアイコンに対しラベルが著しく小さい比率だったため、アイコンを
    /// 縮小・ラベルを拡大する方向で調整(`tabIconSize`/`tabLabelSize`参照)。
    ///
    /// 訂正(同日): 最初はラベルを8→13まで拡大したが、CI実機キャプチャで
    /// 確認すると「カレンダー」(5文字)だけが省略記号で「カレ...」に切れる
    /// 回帰が発生した。参考画像の英字ラベル("Indicators"等)は文字が細い
    /// ため同じ見た目の文字高さでも横幅に余裕があるが、日本語ラベルは
    /// 正方形に近い全角文字のため同じ文字高さだとずっと横幅を食う —
    /// 英字基準の文字高さをそのまま日本語に適用すると幅が破綻すると判明。
    /// CI実機キャプチャから2文字ラベル(指標/検索/設定)の実測文字幅
    /// (1文字あたり実測約19.6pt@size13)を使い、5文字の「カレンダー」が
    /// 1タブ分の幅(約77pt)に余裕を持って収まるサイズを逆算し、8→9(控えめ
    /// な拡大)に修正した。あわせて今後の回帰に備え、ラベルに`.lineLimit(1)`
    /// +`.minimumScaleFactor`を安全策として追加している(詳細は`tab`内
    /// コメント参照)。
    /// 新しいコンテンツ合計高さ(11+1+14+1+2.2=29.2)に対し、旧来の上下均等
    /// 余白(1.9pt/1.9pt、下記`padding.top`)を維持するには`barHeight`を
    /// 34→33に調整した(29.2+1.9×2=33)。
    ///
    /// 8回目の調整(2026-10-04、HQ「高さが全然違う、参考画像の方がもっと
    /// 低いから下げて。文字が大きいので小さくして」): 7回目の調整後も
    /// なおHQから見て差が大きいとの指摘。ラベルを9→7にさらに縮小(行高
    /// 14→11)し、カプセル全体も下(画面下端寄り)に移動するため
    /// `bottomMargin`を6→3に縮小した。新しいコンテンツ合計高さ
    /// (11+1+11+1+2.2=26.2)に対し上下均等余白1.9pt/1.9ptを維持する形で
    /// `barHeight`を33→30に調整した(26.2+1.9×2=30)。
    ///
    /// HQ指示(2026-10-04)「デザインは変えずに、この画像のヘッダーとタブの位置を
    /// 固定としてください」で送付された新しいHome参考画像(852×1846、フル幅の
    /// 旧スタイルタブバー)をPythonで実測。カプセル型(浮遊)と帯型(画面幅
    /// いっぱい)という形状自体が別物のため、バー上端や内部アイコン位置を
    /// そのまま突き合わせても意味がある比較にならない(実際、両方のランド
    /// マークで逆方向の差分が出て矛盾した)。形状によらず両者に共通する指標
    /// として「タブの一番下の可視コンテンツ(ラベル文字)から画面最下端まで
    /// の余白」を採用した。参考画像: ラベル文字下端y≈1770・画像全体の高さ
    /// 1846(原寸852幅、実機1206幅換算での全体高2613は実機キャプチャの2622と
    /// 0.3%差で一致 — 全体のスケールは信頼できる)→ 余白76px(原寸)→実機
    /// 換算35.9pt。現行実装(`barHeight`34・`bottomMargin`4での計算値)は
    /// ラベル下端から画面最下端まで約32.5pt相当で、3.4pt足りなかったため、
    /// その分だけ`bottomMargin`を4→6(V5単位+2 ≈ 実寸+3.4pt)に拡大し、
    /// カプセル全体を画面下端からわずかに離した。`barHeight`(カプセル自体の
    /// 縦横比)は今回の対象外のため変更していない。
    ///
    /// 8回目の調整(2026-10-04、HQ「参考画像の方がもっと低いから下げて」、
    /// `barHeight`のドキュメントコメント参照)で6→3に縮小し、カプセルを
    /// 画面下端に近づけた。
    ///
    /// (2026-10-04、10回目の全面刷新でこのカプセル形状自体を廃止したため、
    /// 上記の実装コードは削除した — 新しい実装は`V5BottomBar`冒頭の
    /// ドキュメントコメントと、その直後の`body`/`tab`を参照。)

/// 「指標一覧」タブのアイコン。棒3本・幅同一・下端揃え・高さ比
/// (0.40:0.68:1.0)・棒間の隙間(棒幅の半分)という比率自体は旧参考画像
/// (`bottom-tabbar-reference-v2-capsule.png`)の実測値をそのまま踏襲しているが
/// (塗りつぶし→アウトラインの違いを除けば同じ比率で違和感が無かったため)、
/// 塗り方自体は10回目の全面刷新(2026-10-04、`V5BottomBar`冒頭コメント参照)
/// で提供された新しい参考画像で見ると明確にアウトライン(線画)だったため、
/// `.fill`から`.stroke`に変更した。色は`.foregroundStyle(.foreground)`で
/// 呼び出し側(`tab`)が設定した色をそのまま継承する。
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
            .stroke(.foreground, lineWidth: 1.1)
            .frame(width: 3, height: 13 * heightFraction)
    }
}

/// 旧「分析」タブのアイコン。HQ指示(2026-10-03、画面構成全面更新)で
/// タブ自体が「カレンダー」に置き換わったため`V5BottomBar.body`からの
/// 呼び出しは削除し、暫定でSF Symbols `calendar`を使用している
/// (`tab(2, ...)`呼び出し側参照)。このView自体は、参考画像を
/// ピクセル単位で再現した自前描画の実装記録として残してある(削除しても
/// 挙動に影響しないが、今回の変更は番号・名称・遷移が主眼のため、
/// 価値のある実装記録を失わない形を優先した)。以下、旧ドキュメントコメント
/// (未変更): 参考画像(`bottom-tabbar-reference-v2-capsule.png`)
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
    /// HQ指示(2026-10-02)「タップ時にオンオフに切り替えられて」でお気に入り
    /// 星を実際にトグル可能にした。`nil`なら星を表示しない。非nilならお気に入り
    /// 状態(true=登録済み/`star.fill`、false=未登録/`star`アウトライン)を表し、
    /// タップで`onToggleFavorite`を呼ぶ。
    var isFavorite: Bool?
    var onBack: (() -> Void)?
    var onToggleFavorite: (() -> Void)?

    /// HQ「ヘッダーのタイトルサイズ統一」最終仕様(2026-10-01、3回の再調整を
    /// 経た最終値): 16pt/14pt→18pt/16pt→20pt/18pt→24pt/22ptの順でCI実機
    /// キャプチャを見ながら引き上げられた。メインタブ画面(`back == false`)
    /// は24pt Semibold、＜付き詳細画面(`back == true`)は22pt Semibold
    /// (階層差2ptは一貫して維持)。ヘッダー高さ・マージン・chevronサイズ・
    /// 間隔は今回も変更対象外のため据え置き。実寸pt値は`V5P.ptToV5`でV5単位に
    /// 変換している。
    ///
    /// HQ指示(2026-10-01、追加調整)「戻るボタン＜が小さすぎる。縦はヘッダー
    /// 文字の縦幅より少し大きいくらいに」: CI実機キャプチャで実測すると、
    /// 旧chevronSize(14pt)は実測高さ37px、detailTitleSize(22pt)の「イベント
    /// 詳細」の実測高さは63pxで、chevronがタイトルよりかなり小さく見えて
    /// いた。chevronの高さはpt数にほぼ比例する(37px/14pt≈2.64px/pt)ため、
    /// タイトル高さ(63px)より一回り大きい目安(約+10%、69px)から逆算した
    /// 26ptに変更。
    private static let headerHeight = V5P.ptToV5(44)
    private static let headerMargin = V5P.ptToV5(16)
    /// 6回目の調整(2026-10-04、HQ「他のヘッダーも同じ位置にし、同じ大きさに
    /// して」): Home画面の`homeHeader`で最終的に44ptへ統一したタイトル文字
    /// サイズに、他の全画面のヘッダー(`V5Header`)も揃えた。従来の
    /// 「メインタブ24pt/詳細22pt」という2pt階層も今回は廃止し、両方とも
    /// 44ptにしている。「過去イベント比較」のような6文字のタイトルは戻る
    /// シェブロン・星アイコンと合わせて402pt幅に収まらない可能性があるため、
    /// `.lineLimit(1)` + `.minimumScaleFactor(0.6)`を安全策として追加した
    /// (Home側で実際に省略記号の回帰が起きた教訓から、今回は事前に入れて
    /// おく)。
    private static let mainTabTitleSize = V5P.ptToV5(44)
    private static let detailTitleSize = V5P.ptToV5(44)
    private static let chevronSize = V5P.ptToV5(26)
    private static let chevronTitleGap = V5P.ptToV5(8)
    /// HQ指示(2026-10-04)「FX Event Analyzerと＜が付く画面を除くヘッダーは
    /// 文字の開始をもう少し右側にしてください」: Home(`homeHeader`、別実装)
    /// と＜付き詳細画面(`back == true`)は対象外、戻るボタンの無いメインタブ
    /// 画面(指標一覧・検索・設定・カレンダー等)のみタイトル先頭に余白を追加。
    /// CI実機キャプチャで確認しながら調整する前提の初期値として8pt。
    private static let mainTabTitleLeadingInset = V5P.ptToV5(8)

    /// HQ指示(2026-10-01、追加調整)「＜の位置はタイトルの中心線上に」
    /// 「星の位置も全て平行線で同じ位置に」。`HStack`の既定`.center`整列は
    /// 各要素自身のレイアウト高さ(SF Symbolの意匠metrics／フォントの行高)
    /// を基準に中心を取るため、要素ごとに「見た目のインク中心」とズレる。
    /// CI実機キャプチャで実測した結果、タイトル中心を基準(y=256px)に
    /// chevronがy=252px(4px上)、星がy=253px(3px上)にズレていた
    /// (実機は3x retina、402pt論理幅のためpx÷3で実寸ptに換算)。その差分
    /// だけ下に補正している。
    private static let chevronVerticalCorrection = V5P.ptToV5(4.0 / 3.0)
    private static let starVerticalCorrection = V5P.ptToV5(3.0 / 3.0)

    /// HQ指示(2026-10-04)「デザインは変えずに、この画像のヘッダーとタブの位置を
    /// 固定としてください」で送付された新しいHome参考画像(852×1846)をPythonで
    /// 実測。画像の絶対座標(status bar位置など)は作図上の余白が実機と一致する
    /// 保証がないため使わず、両画像に共通して存在する信頼できるランドマーク
    /// 「ヘッダー文字の中心」と「コンテンツ1枚目のカード上端(罫線)」の間隔
    /// (これなら作図側の上端余白の有無に影響されない)を基準にした。
    /// 参考画像: ヘッダー文字(「Event Analyzer」部分)中心y≈134、カード上端
    /// y≈193(ともに原寸852幅)→ 間隔59px → 実機1206幅換算で83.5px(=27.8pt)。
    /// 現行実装(CI実機キャプチャ`04-Home`で実測): ヘッダー「ホーム」文字
    /// 中心y≈246.5、カード上端(`HomeView`の`padding(.top, 53)`に相当)
    /// y≈319 → 間隔72.5px(=24.2pt)。差分27.8-24.2=3.6pt分、ヘッダーをさらに
    /// 上(コンテンツから離す方向)へ寄せる必要があると判明したため、
    /// `position(y:)`の40を3.6pt(=V5単位2.15)引いた37.8に変更した
    /// (`headerHeight`自体・コンテンツ側の`padding.top`は変更していない —
    /// どちらも参考画像とは別の実測・HQ既定値に基づくため)。
    ///
    /// 追加調整(2026-10-04、HQ「ヘッダーをもう少し上に上げて欲しい」):
    /// 37.8でもまだ低いとのフィードバックを受け、Home画面の`homeHeader`
    /// (`HomeView.swift`、全く同じ実測根拠を共有)と同じ量だけ追加で
    /// 3pt(V5単位1.75)引き上げ、36.1に変更した。
    ///
    /// さらに追加調整(2026-10-04、HQ「もう少し上」): `homeHeader`と同じ量
    /// だけ追加で2pt(V5単位1.16)引き上げ、34.9に変更した。
    private static let headerCenterY: CGFloat = 34.9

    var body: some View {
        HStack(spacing: 0) {
            if back {
                Button {
                    onBack?()
                } label: {
                    Image(systemName: "chevron.left").font(.system(size: Self.chevronSize, weight: .semibold))
                }.buttonStyle(.plain)
                .offset(y: Self.chevronVerticalCorrection)
                .padding(.trailing, Self.chevronTitleGap)
                .accessibilityIdentifier("v5HeaderBack")
            }
            V5JPFont.text(title, size: back ? Self.detailTitleSize : Self.mainTabTitleSize)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.leading, back ? 0 : Self.mainTabTitleLeadingInset)
            Spacer()
            // HQ指示(2026-10-01、3回目のヘッダー調整): アイコンのウェイトを
            // タイトルのSemiboldと揃える(以前は無指定＝regularだった)。
            // HQ指示(2026-10-02)「タップ時にオンオフに切り替えられて」:
            // `FavoritesStore`(UserDefaults永続化)と連動する実際のトグルに
            // した。バックエンドのお気に入りAPIは引き続き無いため、端末
            // ローカルの状態のみ(ログアウト/再インストールで消える)。
            if let isFavorite {
                Button {
                    onToggleFavorite?()
                } label: {
                    Image(systemName: isFavorite ? "star.fill" : "star")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(V5P.yellow)
                }
                .buttonStyle(.plain)
                .offset(y: Self.starVerticalCorrection)
                .accessibilityIdentifier("v5HeaderFavoriteStar")
            }
        }
        .foregroundStyle(.white)
        .frame(width: V5P.W - Self.headerMargin * 2, height: Self.headerHeight)
        .position(x: V5P.W / 2, y: Self.headerCenterY)
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

