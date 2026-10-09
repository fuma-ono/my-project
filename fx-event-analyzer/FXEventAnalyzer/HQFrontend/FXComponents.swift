import SwiftUI
import Charts

struct FXBrandMark: View {
    var compact = false
    var body: some View {
        HStack(spacing: compact ? 9 : 11) {
            ZStack {
                RoundedRectangle(cornerRadius: compact ? 9 : 12)
                    .fill(FXGradient.brand)
                    .frame(width: compact ? 34 : 44, height: compact ? 34 : 44)
                    .shadow(color: FXColor.cyan.opacity(0.28), radius: 14)
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: compact ? 17 : 22, weight: .bold))
                    .foregroundStyle(.white)
            }
            if !compact {
                VStack(alignment: .leading, spacing: 1) {
                    Text("FX Event Analyzer").font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    Text("EVENTS × REACTIONS").font(.system(size: 8, weight: .semibold, design: .rounded)).tracking(1.5).foregroundStyle(FXColor.cyan)
                }
            }
        }
    }
}

struct FXSectionHeader: View {
    let title: String
    var subtitle: String? = nil
    var action: String? = nil
    var actionHandler: (() -> Void)? = nil
    var body: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 21, weight: .bold, design: .rounded)).foregroundStyle(.white)
                if let subtitle { Text(subtitle).font(.system(size: 13)).foregroundStyle(FXColor.secondaryText) }
            }
            Spacer()
            if let action {
                Button(action: { actionHandler?() }) {
                    Text(action).font(.system(size: 13, weight: .semibold)).foregroundStyle(FXColor.cyan)
                }
            }
        }
    }
}

struct FXBadge: View {
    let text: String
    var tint: Color = FXColor.cyan
    var body: some View {
        Text(text).font(.system(size: 11, weight: .bold, design: .rounded)).foregroundStyle(tint)
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(tint.opacity(0.11)).clipShape(Capsule())
            .overlay(Capsule().stroke(tint.opacity(0.22), lineWidth: 1))
    }
}

struct FXMetricTile: View {
    let label: String
    let value: String
    var detail: String? = nil
    var tint: Color = .white
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.system(size: 11, weight: .medium)).foregroundStyle(FXColor.secondaryText)
            Text(value).font(.system(size: 21, weight: .bold, design: .rounded)).foregroundStyle(tint)
            if let detail { Text(detail).font(.system(size: 11)).foregroundStyle(FXColor.tertiaryText) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(FXColor.backgroundElevated.opacity(0.72))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct FXActionRow: View {
    let icon: String
    let title: String
    let subtitle: String?
    var tint: Color = FXColor.cyan
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 13) {
                Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(tint).frame(width: 34, height: 34).background(tint.opacity(0.11)).clipShape(RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                    if let subtitle { Text(subtitle).font(.system(size: 12)).foregroundStyle(FXColor.secondaryText) }
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(FXColor.tertiaryText)
            }
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

struct FXEmptyState: View {
    let icon: String
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 28, weight: .medium)).foregroundStyle(FXColor.cyan)
            Text(title).font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(.white)
            Text(message).font(.system(size: 13)).foregroundStyle(FXColor.secondaryText).multilineTextAlignment(.center)
        }.frame(maxWidth: 420).padding(.vertical, 45).frame(maxWidth: .infinity)
    }
}

struct FXMiniCandles: View {
    let values: [Double]
    var body: some View {
        GeometryReader { proxy in
            let maxValue = values.max() ?? 1
            let minValue = values.min() ?? 0
            let span = max(maxValue - minValue, 0.001)
            HStack(alignment: .bottom, spacing: max(2, proxy.size.width / CGFloat(values.count * 18))) {
                ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                    let h = max(8, (value - minValue) / span * (proxy.size.height - 12))
                    let up = index == 0 || value >= values[index - 1]
                    Capsule().fill(up ? FXColor.cyan : FXColor.blue).frame(width: 4, height: h)
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        }
    }
}

struct FXPriceChart: View {
    let points: [ChartPoint]
    let releaseIndex: Int?
    var body: some View {
        Chart(points) { point in
            LineMark(x: .value("Time", point.time), y: .value("Price", point.value))
                .interpolationMethod(.catmullRom).foregroundStyle(FXGradient.brand)
            AreaMark(x: .value("Time", point.time), y: .value("Price", point.value))
                .interpolationMethod(.catmullRom).foregroundStyle(FXGradient.brand.opacity(0.10))
        }
        .chartXAxis(.hidden)
        .chartYAxis { AxisMarks(position: .leading) { AxisGridLine().foregroundStyle(FXColor.border); AxisValueLabel().foregroundStyle(FXColor.tertiaryText) } }
        .chartPlotStyle { plot in plot.background(FXColor.backgroundElevated.opacity(0.5)).clipShape(RoundedRectangle(cornerRadius: 14)) }
        .overlay(alignment: .topLeading) {
            if let releaseIndex, points.indices.contains(releaseIndex) {
                GeometryReader { geo in
                    let ratio = CGFloat(releaseIndex) / CGFloat(max(points.count - 1, 1))
                    Rectangle().fill(FXColor.pink.opacity(0.85)).frame(width: 1).position(x: geo.size.width * ratio, y: geo.size.height / 2)
                }
            }
        }
    }
}

struct ChartPoint: Identifiable { let id = UUID(); let time: Date; let value: Double }
