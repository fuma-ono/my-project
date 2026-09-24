
import SwiftUI

enum HQV5 {
    static let bg = Color(red: 0.008, green: 0.035, blue: 0.095)
    static let bg2 = Color(red: 0.012, green: 0.065, blue: 0.135)
    static let panel = Color(red: 0.025, green: 0.075, blue: 0.145)
    static let panel2 = Color(red: 0.035, green: 0.105, blue: 0.19)
    static let blue = Color(red: 0.04, green: 0.58, blue: 1.0)
    static let cyan = Color(red: 0.0, green: 0.86, blue: 0.96)
    static let cyan2 = Color(red: 0.10, green: 0.72, blue: 0.96)
    static let white = Color.white
    static let muted = Color(red: 0.62, green: 0.70, blue: 0.82)
    static let dim = Color(red: 0.37, green: 0.45, blue: 0.58)
    static let red = Color(red: 1.0, green: 0.28, blue: 0.42)
    static let green = Color(red: 0.16, green: 0.90, blue: 0.76)
    static let yellow = Color(red: 1.0, green: 0.78, blue: 0.18)
    static let purple = Color(red: 0.58, green: 0.32, blue: 1.0)
}

/// HQ's `HQV5PrimaryButton` is filed in `Sources/HQV5Screens.swift` in the
/// delivered package rather than `Sources/HQV5DesignSystem.swift`, even
/// though it's a reusable style (used by Login/Event Detail/Historical
/// Event Detail's CTAs), not screen content — relocated here, verbatim,
/// so it's available without pulling in the demo screens file.
struct HQV5PrimaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity).frame(height: 36)
            .background(LinearGradient(colors: [HQV5.blue, HQV5.cyan2], startPoint: .leading, endPoint: .trailing), in: RoundedRectangle(cornerRadius: 9))
            .opacity(configuration.isPressed ? 0.78 : 1)
    }
}

struct HQV5Background: View {
    var body: some View {
        LinearGradient(colors: [HQV5.bg, HQV5.bg2, HQV5.bg], startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea()
    }
}

struct HQV5Screen<Content: View>: View {
    let title: String?
    @ViewBuilder let content: Content
    init(title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }
    var body: some View {
        ZStack {
            HQV5Background()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 12) {
                    if let title { Text(title).font(.system(size: 24, weight: .bold)).foregroundStyle(.white) }
                    content
                }
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .padding(.bottom, 88)
            }
        }
    }
}

struct HQV5NeonCard<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        content
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(
                        LinearGradient(colors: [HQV5.panel2.opacity(0.96), HQV5.panel.opacity(0.98)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .stroke(LinearGradient(colors: [HQV5.blue.opacity(0.75), HQV5.cyan.opacity(0.25)],
                                           startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 0.8)
            )
    }
}

struct HQV5Pill: View {
    let text: String
    let active: Bool
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Capsule().fill(active ? HQV5.blue : HQV5.panel2))
            .overlay(Capsule().stroke(active ? HQV5.cyan.opacity(0.5) : Color.white.opacity(0.08), lineWidth: 0.6))
    }
}

struct HQV5Badge: View {
    enum Kind { case high, medium, low, revised }
    let text: String
    let kind: Kind
    var color: Color {
        switch kind { case .high, .revised: return HQV5.red; case .medium: return HQV5.green; case .low: return HQV5.blue }
    }
    var body: some View {
        Text(text)
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 7).padding(.vertical, 4)
            .background(color.opacity(0.14), in: Capsule())
            .overlay(Capsule().stroke(color.opacity(0.35), lineWidth: 0.6))
    }
}

struct HQV5BottomBar: View {
    @Binding var selected: Int
    var body: some View {
        HStack {
            item(0, "house.fill", "ホーム")
            item(1, "chart.bar.fill", "指標一覧")
            item(2, "magnifyingglass", "検索")
            item(3, "gearshape.fill", "設定")
        }
        .padding(.horizontal, 7).padding(.vertical, 7)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(HQV5.blue.opacity(0.65), lineWidth: 1))
        .shadow(color: HQV5.blue.opacity(0.25), radius: 10)
    }
    @ViewBuilder private func item(_ i: Int, _ icon: String, _ title: String) -> some View {
        Button {
            selected = i
        } label: {
            VStack(spacing: 2) {
                Image(systemName: icon).font(.system(size: 14, weight: .semibold))
                Text(title).font(.system(size: 8, weight: .semibold))
            }
            .foregroundStyle(selected == i ? HQV5.cyan : .white.opacity(0.75))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
            .background(selected == i ? HQV5.blue.opacity(0.20) : .clear, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct HQV5TopBar: View {
    let title: String
    var favorite = false
    var onBack: (() -> Void)?
    var body: some View {
        HStack(spacing: 12) {
            if let onBack {
                Button(action: onBack) { Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)) }
                    .buttonStyle(.plain)
            }
            Text(title).font(.system(size: 16, weight: .bold))
            Spacer()
            if favorite { Image(systemName: "star.fill").foregroundStyle(HQV5.yellow) }
        }
        .foregroundStyle(.white)
    }
}

struct HQV5MetricRow: View {
    let title: String
    let value: String
    let tint: Color
    var body: some View {
        VStack(spacing: 5) {
            Text(title).font(.system(size: 9)).foregroundStyle(HQV5.muted)
            Text(value).font(.system(size: 16, weight: .bold)).foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity)
    }
}

struct HQV5Logo: View {
    var body: some View {
        HStack(spacing: 7) {
            ZStack {
                RoundedRectangle(cornerRadius: 5).fill(HQV5.blue.opacity(0.18))
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(HQV5.cyan)
            }
            .frame(width: 27, height: 27)
            VStack(alignment: .leading, spacing: 0) {
                Text("FX Event Analyzer").font(.system(size: 14, weight: .bold))
                Text("EVENTS • REACTIONS").font(.system(size: 6, weight: .bold)).foregroundStyle(HQV5.cyan)
            }
        }
        .foregroundStyle(.white)
    }
}

struct HQV5Chart: View {
    var rising = true
    var body: some View {
        GeometryReader { geo in
            ZStack {
                ForEach(0..<5, id: \.self) { i in
                    Path { p in
                        let y = geo.size.height * CGFloat(i) / 4
                        p.move(to: CGPoint(x: 0, y: y))
                        p.addLine(to: CGPoint(x: geo.size.width, y: y))
                    }.stroke(Color.white.opacity(0.08), lineWidth: 0.6)
                }
                Path { p in
                    let pts: [CGPoint] = stride(from: 0, through: 1, by: 0.04).map {
                        let x = CGFloat($0) * geo.size.width
                        let noise = sin($0 * 32) * 0.06 + sin($0 * 67) * 0.03
                        let yNorm = rising ? (0.80 - 0.58 * CGFloat($0) + noise) : (0.48 + noise)
                        return CGPoint(x: x, y: geo.size.height * yNorm)
                    }
                    p.move(to: pts[0])
                    for pt in pts.dropFirst() { p.addLine(to: pt) }
                }
                .stroke(HQV5.cyan, lineWidth: 1.7)
                .shadow(color: HQV5.cyan.opacity(0.5), radius: 5)
            }
        }
        .background(HQV5.panel.opacity(0.7), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(HQV5.blue.opacity(0.35), lineWidth: 0.7))
    }
}
