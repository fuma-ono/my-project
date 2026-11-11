import SwiftUI

/// HQ指示(2026-11-11「StrategyAnalysis 4タブUI実装」、デザイン画像へのピクセル単位での準拠)で使う、
/// 4タブ共通のグラフ・ゲージ部品。参考画像(ライトモード)の構成・配置をそのまま踏襲しつつ、
/// このアプリ既存の暗い配色(`V5P`・`SettingsCardStyle`)に合わせている。
///
/// 実データが無い項目(通貨分析・価格帯分析・AI分析の各数値)は、架空の値を描かず、
/// 同じ部品を「データ不足」の状態(nil)で表示する(枠・軸・ラベルなどの構成は保ったまま、
/// 値だけを「--」「データ不足」にする)。

/// 円形ゲージ(参考画像の「上昇確率68%」「総合信頼度82%」)。`percent`がnilなら未入力の灰色の輪のまま。
struct StrategyCircularGauge: View {
    let percent: Double?
    let centerText: String
    let centerSubtext: String?
    var color: Color = V5P.green
    var diameter: CGFloat = 58

    var body: some View {
        ZStack {
            Circle()
                .stroke(SettingsCardStyle.cardBorder, lineWidth: 5)
            if let percent {
                Circle()
                    .trim(from: 0, to: max(0, min(1, percent / 100)))
                    .stroke(color, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            VStack(spacing: 1) {
                NotoText.text(centerText, size: 13).foregroundStyle(percent != nil ? color : SettingsCardStyle.subtitleColor)
                if let centerSubtext {
                    NotoText.text(centerSubtext, size: 6).foregroundStyle(SettingsCardStyle.subtitleColor)
                }
            }
        }
        .frame(width: diameter, height: diameter)
    }
}

/// 折れ線グラフ(参考画像の「初動分析」のpips推移、「通貨分析」の為替レート推移)。
/// `points`がnilまたは2点未満なら、データ不足の破線のみを描く。
struct StrategyTrendChart: View {
    /// (x軸ラベル, 値)の並び。値は同じ縮尺で描く(pipsでもレートでも可)。
    let points: [(label: String, value: Double)]?
    var lineColor: Color = V5P.blue
    var fillColor: Color? = nil
    /// 直近の値に添える吹き出し(参考画像の「+18.5 pips」)。
    var calloutFormatter: ((Double) -> String)? = nil
    var height: CGFloat = 90

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let points, points.count >= 2 {
                GeometryReader { geo in
                    let values = points.map(\.value)
                    let minV = min(0, values.min() ?? 0)
                    let maxV = max(values.max() ?? 1, minV + 0.001)
                    let stepX = geo.size.width / CGFloat(points.count - 1)
                    func y(_ v: Double) -> CGFloat {
                        let ratio = (v - minV) / (maxV - minV)
                        return geo.size.height * (1 - ratio)
                    }
                    ZStack(alignment: .topLeading) {
                        // 0ラインの点線(参考画像の横軸)。
                        Path { path in
                            path.move(to: CGPoint(x: 0, y: y(0)))
                            path.addLine(to: CGPoint(x: geo.size.width, y: y(0)))
                        }
                        .stroke(SettingsCardStyle.cardBorder, style: StrokeStyle(lineWidth: 0.5, dash: [2, 2]))

                        if let fillColor {
                            Path { path in
                                path.move(to: CGPoint(x: 0, y: y(0)))
                                for (i, p) in points.enumerated() {
                                    path.addLine(to: CGPoint(x: CGFloat(i) * stepX, y: y(p.value)))
                                }
                                path.addLine(to: CGPoint(x: geo.size.width, y: y(0)))
                                path.closeSubpath()
                            }
                            .fill(fillColor.opacity(0.18))
                        }

                        Path { path in
                            for (i, p) in points.enumerated() {
                                let point = CGPoint(x: CGFloat(i) * stepX, y: y(p.value))
                                if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
                            }
                        }
                        .stroke(lineColor, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))

                        if let last = points.last {
                            let point = CGPoint(x: geo.size.width, y: y(last.value))
                            Circle().fill(lineColor).frame(width: 5, height: 5).position(point)
                            if let calloutFormatter {
                                NotoText.text(calloutFormatter(last.value), size: 6)
                                    .foregroundStyle(.black)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(Color.white.opacity(0.92)))
                                    .position(x: max(20, point.x - 18), y: max(8, point.y - 11))
                            }
                        }
                    }
                }
                .frame(height: height)
                HStack {
                    ForEach(points, id: \.label) { p in
                        NotoText.text(p.label, size: 5.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                        if p.label != points.last?.label { Spacer() }
                    }
                }
            } else {
                ZStack {
                    Path { path in
                        path.move(to: CGPoint(x: 4, y: height / 2))
                        path.addLine(to: CGPoint(x: 210, y: height / 2))
                    }
                    .stroke(SettingsCardStyle.cardBorder, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    NotoText.text("データ不足", size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
                }
                .frame(height: height)
            }
        }
    }
}

/// 横棒の進捗(参考画像の「継続確率」「反応強度」等)。`percent`がnilなら空のまま「データ不足」。
struct StrategyProgressRow: View {
    let label: String
    let percent: Double?
    var color: Color = V5P.blue

    var body: some View {
        HStack(spacing: 6) {
            NotoText.text(label, size: 6.5).foregroundStyle(.white).frame(width: 56, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(SettingsCardStyle.cardBorder.opacity(0.4))
                    if let percent {
                        Capsule().fill(color).frame(width: geo.size.width * max(0, min(1, percent / 100)))
                    }
                }
            }
            .frame(height: 5)
            NotoText.text(percent.map { ValueFormat.percent($0, fractionDigits: 0) } ?? "--", size: 6.5)
                .foregroundStyle(percent != nil ? .white : SettingsCardStyle.subtitleColor)
                .frame(width: 26, alignment: .trailing)
        }
    }
}

/// 縦棒グラフ(参考画像「通貨分析」の「過去の傾向」)。`values`がnilなら空の枠に「データ不足」。
struct StrategyBarChart: View {
    let values: [(label: String, value: Double)]?
    var color: Color = V5P.blue
    var highlightLastColor: Color? = nil
    var height: CGFloat = 70

    var body: some View {
        if let values, !values.isEmpty {
            let maxV = max(values.map(\.value).max() ?? 1, 0.001)
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(Array(values.enumerated()), id: \.offset) { index, item in
                    VStack(spacing: 3) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(index == values.count - 1 ? (highlightLastColor ?? color) : color.opacity(0.55))
                            .frame(height: max(3, height * CGFloat(item.value / maxV)))
                        NotoText.text(item.label, size: 5.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: height + 14, alignment: .bottom)
        } else {
            VStack(spacing: 4) {
                Spacer()
                NotoText.text("データ不足", size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            .frame(height: height + 14)
        }
    }
}

/// ローソク足チャートの枠(参考画像「価格帯分析」)。実データが無いため、形だけの(すべて同系色の)
/// 模式図の上に「データ不足」を重ねる — 架空の価格を数値として出さない。
struct StrategyCandlestickPlaceholder: View {
    var height: CGFloat = 110

    var body: some View {
        ZStack {
            HStack(alignment: .center, spacing: 6) {
                ForEach(0..<9, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(SettingsCardStyle.cardBorder.opacity(0.5))
                        .frame(width: 6, height: CGFloat([28, 40, 22, 50, 34, 44, 26, 38, 30][i]))
                }
            }
            VStack(spacing: 4) {
                Image(systemName: "chart.bar.xaxis").font(.system(size: 16)).foregroundStyle(SettingsCardStyle.subtitleColor)
                NotoText.text("データ不足（価格帯は未対応）", size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            .padding(6)
            .background(SettingsCardStyle.cardFill.opacity(0.85))
        }
        .frame(height: height)
    }
}
