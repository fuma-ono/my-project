
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
    /// 済み)。このグラデーション以外(下記の青いradial glow、外枠の光る
    /// ストローク)はHQから変更の指示がないため変更していない。
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

            RoundedRectangle(cornerRadius: 12)
                .stroke(
                    LinearGradient(colors: [V5P.blue, V5P.cyan.opacity(0.35), V5P.blue],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    lineWidth: 1.2
                )
                .shadow(color: V5P.blue.opacity(0.65), radius: 5)
                .frame(width: V5P.W - 2, height: V5P.H - 2)
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
    /// 方向転換(2026-09-30): HQより実装の起点となる参考画像
    /// (`docs/projects/fx-event-analyzer/mockups/bottom-tabbar-reference-v1.png`)
    /// が直接共有され、「タブバーを完全再現して」という明示指示のもと作り
    /// 直した。旧デザイン(浮遊するカプセル、選択タブの背景ピル強調)から、
    /// 画面幅いっぱいの帯+上端の区切り線のみ、選択タブは背景を付けず
    /// アイコン/文字の色とグリフ(アウトライン⇄塗りつぶし)だけを変える方式
    /// に変更。参考画像のピクセル明度を実測して座標化した(測定方法は
    /// SettingsViewのドキュメントコメントと同じ)。
    ///
    /// 参考画像との既知の差分: 「指標一覧」のアイコンは参考画像内のグラフィック
    /// がSF Symbols標準セットのどれとも完全一致しないため、最も近い形状
    /// (`chart.bar`/`chart.bar.fill`)を採用している(Loginのパスワード欄
    /// アイコンと同じ「最も近い形状を採用する」慣例)。
    ///
    /// 追加調整(2026-09-30、HQより2枚目の参考画像): 浮遊するカプセル型
    /// タブバーのモックアップが共有され、「選択中アイコンが画像のように
    /// わかりやすくなるように」との指示だったため、選択中タブのアイコン
    /// 背後に淡いシアンの光彩(グロー)と、ラベル下の短いアンダーラインを
    /// 追加した(`tab(_:filled:outline:_:)`内、共に`.background`/
    /// `.overlay`で追加しており、既存の実測済みレイアウト自体は動かして
    /// いない)。同時に「周りの青い線は要らないから消して」との明示指示
    /// があったため、画像内にあったカプセル全体を囲む光る枠線(ストローク)
    /// は採用していない — 帯全体の形状(画面幅いっぱい・背景なし・上端の
    /// 区切り線のみ)も変更していない(HQはこの2枚目の画像を「選択状態の
    /// 見せ方」の参考としてのみ使うよう述べており、カプセル形状への転換を
    /// 明示的に指示してはいないため)。
    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(V5P.line.opacity(0.5)).frame(height: 0.6)
            HStack(spacing: 0) {
                tab(0, filled: "house.fill", outline: "house", "ホーム")
                tab(1, filled: "chart.bar.fill", outline: "chart.bar", "指標一覧")
                tab(2, filled: "chart.xyaxis.line", outline: "chart.xyaxis.line", "分析")
                tab(3, filled: "magnifyingglass", outline: "magnifyingglass", "検索")
                tab(4, filled: "gearshape.fill", outline: "gearshape", "設定")
            }
            .padding(.top, 7)
            .padding(.bottom, 17)
        }
        .frame(width: V5P.W, height: 49)
        .position(x: V5P.W / 2, y: V5P.H - 49 / 2)
    }
    /// `Button`ではなく`.onTapGesture`を使っている理由: 実機相当のCIキャプチャ
    /// で確認したところ、`Button` + `.buttonStyle(.plain)`でも選択中タブの
    /// 背後にシステム既定のハイライト用カプセル(参考画像にはない)が写り込んで
    /// いた。ボタンとしての既定の見た目を一切持たない`.onTapGesture`に置き換
    /// えることで、参考画像通り背景なし・アイコンと文字の色/グリフのみで選択
    /// 状態を表す見た目にした。
    @ViewBuilder func tab(_ index: Int, filled: String, outline: String, _ title: String) -> some View {
        let isSelected = index == selected
        VStack(spacing: 4) {
            Image(systemName: isSelected ? filled : outline)
                .font(.system(size: 13, weight: .semibold))
                .background(
                    Circle()
                        .fill(RadialGradient(colors: [V5P.cyan.opacity(0.4), .clear], center: .center, startRadius: 1, endRadius: 13))
                        .frame(width: 26, height: 26)
                        .opacity(isSelected ? 1 : 0)
                )
            Text(title).font(.system(size: 7, weight: .semibold))
        }
        .foregroundStyle(isSelected ? V5P.cyan : .white.opacity(0.9))
        .frame(maxWidth: .infinity)
        .overlay(alignment: .bottom) {
            Capsule()
                .fill(V5P.cyan)
                .frame(width: 14, height: 1.6)
                .opacity(isSelected ? 1 : 0)
                .offset(y: 9)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            selected = index
        }
        .accessibilityAddTraits(.isButton)
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
