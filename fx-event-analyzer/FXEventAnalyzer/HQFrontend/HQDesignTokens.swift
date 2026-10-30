import SwiftUI

// HQ visual system for FX Event Analyzer.
// Dark-first, premium fintech styling. Keep semantic names so the palette can evolve.

enum FXColor {
    static let background = Color(red: 0.018, green: 0.027, blue: 0.075)
    static let backgroundElevated = Color(red: 0.035, green: 0.047, blue: 0.105)
    static let card = Color(red: 0.055, green: 0.070, blue: 0.145)
    static let cardStrong = Color(red: 0.075, green: 0.092, blue: 0.180)
    static let border = Color.white.opacity(0.09)
    static let primaryText = Color.white
    static let secondaryText = Color.white.opacity(0.64)
    static let tertiaryText = Color.white.opacity(0.40)
    static let cyan = Color(red: 0.06, green: 0.82, blue: 1.0)
    static let blue = Color(red: 0.18, green: 0.36, blue: 1.0)
    static let violet = Color(red: 0.52, green: 0.28, blue: 1.0)
    static let pink = Color(red: 1.0, green: 0.26, blue: 0.63)
    static let green = Color(red: 0.18, green: 0.90, blue: 0.60)
    static let red = Color(red: 1.0, green: 0.30, blue: 0.38)
    static let amber = Color(red: 1.0, green: 0.68, blue: 0.20)
}

enum FXGradient {
    static let brand = LinearGradient(colors: [FXColor.blue, FXColor.cyan], startPoint: .bottomLeading, endPoint: .topTrailing)
    static let brandWide = LinearGradient(colors: [FXColor.blue, FXColor.cyan, Color.white.opacity(0.92)], startPoint: .leading, endPoint: .trailing)
    static let pink = LinearGradient(colors: [FXColor.pink, FXColor.violet], startPoint: .leading, endPoint: .trailing)
    static let surface = LinearGradient(colors: [FXColor.cardStrong, FXColor.card], startPoint: .topLeading, endPoint: .bottomTrailing)
}

enum FXMetric {
    static let radius: CGFloat = 20
    static let smallRadius: CGFloat = 12
    static let horizontal: CGFloat = 20
    static let sectionGap: CGFloat = 26
}

struct FXAppBackground: View {
    var body: some View {
        ZStack {
            FXColor.background.ignoresSafeArea()
            RadialGradient(colors: [FXColor.blue.opacity(0.13), .clear], center: .topTrailing, startRadius: 0, endRadius: 520)
                .ignoresSafeArea()
            RadialGradient(colors: [FXColor.cyan.opacity(0.06), .clear], center: .bottomLeading, startRadius: 0, endRadius: 620)
                .ignoresSafeArea()
        }
    }
}

extension View {
    func fxCard(padding: CGFloat = 18) -> some View {
        self
            .padding(padding)
            .background(FXGradient.surface)
            .overlay(RoundedRectangle(cornerRadius: FXMetric.radius).stroke(FXColor.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: FXMetric.radius))
    }
}
