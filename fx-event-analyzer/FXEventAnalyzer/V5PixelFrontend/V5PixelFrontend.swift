
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
    private static let barHeight: CGFloat = 44
    private static let barWidth: CGFloat = 214
    private static let bottomMargin: CGFloat = 8
    private static let iconGradient = LinearGradient(
        colors: [Color(red: 0.90, green: 0.97, blue: 1.0), Color(red: 0.45, green: 0.64, blue: 0.86)],
        startPoint: .top, endPoint: .bottom
    )
    private static let selectedIconGradient = LinearGradient(
        colors: [V5P.cyan, Color(red: 0.0, green: 0.48, blue: 0.945)],
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
            tab(2, "分析") { _ in
                V5AnalysisIcon()
            }
            tab(3, "検索") { _ in
                Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold))
            }
            tab(4, "設定") { _ in
                Image(systemName: "gearshape.fill").font(.system(size: 13, weight: .semibold))
            }
        }
        .frame(width: Self.barWidth, height: Self.barHeight)
        .background(
            RoundedRectangle(cornerRadius: Self.barHeight / 2)
                .fill(LinearGradient(colors: [V5P.panel.opacity(0.6), V5P.panel2.opacity(0.25)],
                                      startPoint: .top, endPoint: .bottom))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Self.barHeight / 2)
                .stroke(
                    LinearGradient(colors: [V5P.cyan.opacity(0.65), V5P.blue.opacity(0.35), V5P.cyan.opacity(0.55)],
                                   startPoint: .top, endPoint: .bottom),
                    lineWidth: 1.3
                )
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
        VStack(spacing: 4) {
            icon(isSelected)
                .foregroundStyle(gradient)
                .shadow(color: .black.opacity(0.35), radius: 1, y: 1)
                .background(
                    Circle()
                        .fill(RadialGradient(colors: [V5P.cyan.opacity(0.42), V5P.cyan.opacity(0.16), .clear],
                                              center: .center, startRadius: 1, endRadius: 23))
                        .frame(width: 46, height: 46)
                        .opacity(isSelected ? 1 : 0)
                )
            Text(title).font(.system(size: 7, weight: .semibold)).foregroundStyle(gradient)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .bottom) {
            Capsule()
                .fill(LinearGradient(colors: [V5P.cyan, V5P.blue], startPoint: .top, endPoint: .bottom))
                .frame(width: 16, height: 2.2)
                .shadow(color: V5P.cyan.opacity(0.7), radius: 2)
                .opacity(isSelected ? 1 : 0)
                .padding(.bottom, 6)
        }
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
/// 経路(谷スタート→山→谷→矢尻手前)をそのまま座標化した自前描画にしている。
/// 矢尻は塗りつぶしの三角形(参考画像でも実測濃度が線本体より高い=塗り
/// つぶしだったため)。色は`.foregroundStyle(.foreground)`で呼び出し側
/// (`tab`)が設定したグラデーションをそのまま継承する。
private struct V5AnalysisIcon: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let p0 = CGPoint(x: 0.00 * w, y: 0.91 * h)
            let p1 = CGPoint(x: 0.37 * w, y: 0.45 * h)
            let p2 = CGPoint(x: 0.56 * w, y: 0.76 * h)
            let p3 = CGPoint(x: 0.78 * w, y: 0.38 * h)
            let tip = CGPoint(x: 1.00 * w, y: 0.02 * h)
            let backA = CGPoint(x: 0.78 * w, y: 0.08 * h)
            let backB = CGPoint(x: 0.97 * w, y: 0.33 * h)

            Path { path in
                path.move(to: p0)
                path.addLine(to: p1)
                path.addLine(to: p2)
                path.addLine(to: p3)
            }
            .stroke(.foreground, style: StrokeStyle(lineWidth: h * 0.15, lineCap: .round, lineJoin: .round))

            Path { path in
                path.move(to: backA)
                path.addLine(to: tip)
                path.addLine(to: backB)
                path.closeSubpath()
            }
            .fill(.foreground)
        }
        .frame(width: 15, height: 10)
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
