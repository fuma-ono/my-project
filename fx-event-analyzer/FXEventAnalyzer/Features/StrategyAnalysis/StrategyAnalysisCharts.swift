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
    /// ユーザー指摘(2026-11-12)「チャートは幅いっぱいではなく縦と横に+30,+15,0,-15 0分,5分,15分,30分として」:
    /// 参考画像どおり、縦軸に固定目盛りのラベル列を表示する(データの値域に関わらず常にこの目盛り)。
    /// 空配列(既定)なら、この列自体を描かない(従来どおりデータ駆動のスケール)。大きい順に渡す。
    var yAxisTicks: [Double] = []

    private let yAxisLabelWidth: CGFloat = 16

    /// `GeometryReader`の`@ViewBuilder`クロージャ内にネストした関数を置くと、結果ビルダーの型推論が
    /// 壊れ「generic parameter 'Content' could not be inferred」になることがCIで確認されたため、
    /// 座標計算は(Viewを一切組み立てない)プレーンな関数としてクロージャの外に出す。
    private func valueRange(_ points: [(label: String, value: Double)]) -> (min: Double, max: Double) {
        if let tickMin = yAxisTicks.min(), let tickMax = yAxisTicks.max() {
            return (tickMin, tickMax)
        }
        let values = points.map(\.value)
        let minV = min(0, values.min() ?? 0)
        let maxV = max(values.max() ?? 1, minV + 0.001)
        return (minV, maxV)
    }

    private func plottedPoints(_ points: [(label: String, value: Double)], in size: CGSize) -> [CGPoint] {
        let (minV, maxV) = valueRange(points)
        let stepX = points.count > 1 ? size.width / CGFloat(points.count - 1) : 0
        return points.enumerated().map { index, point in
            let ratio = (point.value - minV) / (maxV - minV)
            return CGPoint(x: CGFloat(index) * stepX, y: size.height * (1 - ratio))
        }
    }

    private func zeroLineY(_ points: [(label: String, value: Double)], in size: CGSize) -> CGFloat {
        let (minV, maxV) = valueRange(points)
        let ratio = (0 - minV) / (maxV - minV)
        return size.height * (1 - ratio)
    }

    private func tickY(_ tick: Double, _ points: [(label: String, value: Double)], in size: CGSize) -> CGFloat {
        let (minV, maxV) = valueRange(points)
        let ratio = (tick - minV) / (maxV - minV)
        return size.height * (1 - ratio)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let points, points.count >= 2 {
                HStack(alignment: .top, spacing: 4) {
                    if !yAxisTicks.isEmpty {
                        GeometryReader { geo in
                            ZStack(alignment: .topLeading) {
                                ForEach(yAxisTicks, id: \.self) { tick in
                                    NotoText.text(tick > 0 ? "+\(Int(tick))" : "\(Int(tick))", size: 5.5)
                                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                                        .position(x: geo.size.width / 2, y: tickY(tick, points, in: CGSize(width: geo.size.width, height: height)))
                                }
                            }
                        }
                        .frame(width: yAxisLabelWidth, height: height)
                    }
                    GeometryReader { geo in
                        let plotted = plottedPoints(points, in: geo.size)
                        let zeroY = zeroLineY(points, in: geo.size)
                        ZStack(alignment: .topLeading) {
                            // 固定目盛りの横罫線(参考画像の+30/+15/0/-15のグリッド線)。
                            ForEach(yAxisTicks, id: \.self) { tick in
                                Path { path in
                                    let y = tickY(tick, points, in: geo.size)
                                    path.move(to: CGPoint(x: 0, y: y))
                                    path.addLine(to: CGPoint(x: geo.size.width, y: y))
                                }
                                .stroke(SettingsCardStyle.cardBorder.opacity(tick == 0 ? 0.9 : 0.35), style: StrokeStyle(lineWidth: 0.5, dash: tick == 0 ? [2, 2] : []))
                            }
                            // 目盛りを渡していないとき(他の呼び出し元)は、従来どおり0ラインの点線だけ描く。
                            if yAxisTicks.isEmpty {
                                Path { path in
                                    path.move(to: CGPoint(x: 0, y: zeroY))
                                    path.addLine(to: CGPoint(x: geo.size.width, y: zeroY))
                                }
                                .stroke(SettingsCardStyle.cardBorder, style: StrokeStyle(lineWidth: 0.5, dash: [2, 2]))
                            }

                            if let fillColor {
                                Path { path in
                                    path.move(to: CGPoint(x: 0, y: zeroY))
                                    for point in plotted { path.addLine(to: point) }
                                    path.addLine(to: CGPoint(x: geo.size.width, y: zeroY))
                                    path.closeSubpath()
                                }
                                .fill(fillColor.opacity(0.18))
                            }

                            Path { path in
                                for (index, point) in plotted.enumerated() {
                                    if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                                }
                            }
                            .stroke(lineColor, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))

                            if let lastPoint = plotted.last, let lastValue = points.last?.value {
                                Circle().fill(lineColor).frame(width: 5, height: 5).position(lastPoint)
                                if let calloutFormatter {
                                    NotoText.text(calloutFormatter(lastValue), size: 6)
                                        .foregroundStyle(.black)
                                        .padding(.horizontal, 4)
                                        .padding(.vertical, 2)
                                        .background(Capsule().fill(Color.white.opacity(0.92)))
                                        .position(x: max(20, lastPoint.x - 18), y: max(8, lastPoint.y - 11))
                                }
                            }
                        }
                    }
                    .frame(height: height)
                }
                HStack {
                    if !yAxisTicks.isEmpty {
                        Color.clear.frame(width: yAxisLabelWidth)
                    }
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
        // ユーザー指摘(2026-11-12)「継続確率、反転確率：13pt」。
        HStack(spacing: 6) {
            NotoText.text(label, size: 7.57).foregroundStyle(.white).frame(width: 56, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(SettingsCardStyle.cardBorder.opacity(0.4))
                    if let percent {
                        Capsule().fill(color).frame(width: geo.size.width * max(0, min(1, percent / 100)))
                    }
                }
            }
            .frame(height: 5)
            // 参考画像(2d65f185)実測: 値の「72%」はラベルの「継続確率」とほぼ同じ高さ(27px/25px)で
            // 表示されている。ラベルと同じ13pt相当に合わせる(以前の11pt相当は小さすぎた)。
            NotoText.text(percent.map { ValueFormat.percent($0, fractionDigits: 0) } ?? "--", size: 7.57)
                .foregroundStyle(percent != nil ? .white : SettingsCardStyle.subtitleColor)
                .frame(width: 30, alignment: .trailing)
        }
    }
}

