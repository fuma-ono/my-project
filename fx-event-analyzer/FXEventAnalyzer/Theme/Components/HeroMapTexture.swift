import SwiftUI

/// SCR-001 Home's hero card background — the Reference shows a faint
/// world-map silhouette rendered as a halftone/dot-matrix texture behind
/// the "今日の注目イベント" title, with a couple of brighter "node" glows,
/// fading out before the event rows start. This app has no map-image
/// asset or geographic data source, so this is a deliberate best-effort
/// decorative approximation — a deterministic dot scatter, not traced
/// continent outlines — disclosed as such rather than claimed pixel-exact.
struct HeroMapTexture: View {
    var body: some View {
        Canvas { context, size in
            let columns = 22
            let rows = 10
            let cellWidth = size.width / CGFloat(columns)
            let cellHeight = size.height / CGFloat(rows)

            // Fixed xorshift seed — a stable-looking texture rather than one
            // that visibly reshuffles on every SwiftUI body re-evaluation.
            var seed: UInt64 = 0x9E37_79B9_7F4A_7C15
            func nextUnit() -> Double {
                seed ^= seed << 13
                seed ^= seed >> 7
                seed ^= seed << 17
                return Double(seed % 1000) / 1000
            }

            for row in 0..<rows {
                for column in 0..<columns {
                    guard nextUnit() > 0.45 else { continue }
                    let x = (CGFloat(column) + 0.5) * cellWidth
                    let y = (CGFloat(row) + 0.5) * cellHeight
                    let verticalFade = 1 - (Double(row) / Double(rows))
                    let dotOpacity = 0.05 + verticalFade * 0.15
                    let dotSize = 1.4 + nextUnit() * 1.4
                    let rect = CGRect(x: x - dotSize / 2, y: y - dotSize / 2, width: dotSize, height: dotSize)
                    context.fill(Path(ellipseIn: rect), with: .color(DesignTokens.Colors.Home.accent.opacity(dotOpacity)))
                }
            }

            let nodes: [(CGPoint, CGFloat)] = [
                (CGPoint(x: size.width * 0.74, y: size.height * 0.3), 3),
                (CGPoint(x: size.width * 0.26, y: size.height * 0.62), 2)
            ]
            for (point, radius) in nodes {
                let glowRadius = radius * 4
                let glowRect = CGRect(x: point.x - glowRadius, y: point.y - glowRadius, width: glowRadius * 2, height: glowRadius * 2)
                context.fill(
                    Path(ellipseIn: glowRect),
                    with: .radialGradient(
                        Gradient(colors: [DesignTokens.Colors.Home.accent.opacity(0.35), .clear]),
                        center: point,
                        startRadius: 0,
                        endRadius: glowRadius
                    )
                )
                let coreRect = CGRect(x: point.x - radius / 2, y: point.y - radius / 2, width: radius, height: radius)
                context.fill(Path(ellipseIn: coreRect), with: .color(DesignTokens.Colors.Home.accent.opacity(0.85)))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
