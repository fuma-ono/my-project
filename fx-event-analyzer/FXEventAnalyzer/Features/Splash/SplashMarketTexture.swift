import SwiftUI

/// SCR-000 Splash's lower-background decoration — the Reference shows a
/// muted, fairly uniform blue candlestick chart (real floating
/// candlesticks: each body's own open/close range, never bottom-aligned
/// to a shared floor, with thin wicks above AND below each body) noisily
/// rising left-to-right across the full width, fading fainter toward the
/// left (older) and brighter toward the right (recent), crossed by 2-3
/// faint flowing curve lines. Not a dense wireframe grid — a plainer
/// composition than that. Like Home's `HeroMapTexture`, this app has no
/// real chart-data source to draw from at Splash time (nothing is
/// fetched yet), so this is a deliberate best-effort decorative
/// approximation — a deterministic candlestick/curve pattern, not real
/// market data — disclosed as such rather than claimed pixel-exact.
struct SplashMarketTexture: View {
    var body: some View {
        ZStack {
            curves
            candles
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Two to three bright flowing curves crossing in an X, not a dense
    /// grid — matches the Reference's plainer, brighter composition.
    private var curves: some View {
        Canvas { context, size in
            struct Curve {
                let startY: Double
                let endY: Double
                let amplitude: Double
                let phase: Double
                let opacityCore: Double
                let opacityGlow: Double
                let width: CGFloat
            }
            let curveDefs = [
                Curve(startY: 0.62, endY: 0.50, amplitude: 0.05, phase: 0, opacityCore: 0.55, opacityGlow: 0.18, width: 1.5),
                Curve(startY: 0.82, endY: 0.55, amplitude: 0.07, phase: 1.6, opacityCore: 0.4, opacityGlow: 0.12, width: 1.2),
                Curve(startY: 0.58, endY: 0.78, amplitude: 0.04, phase: 3.0, opacityCore: 0.25, opacityGlow: 0.08, width: 1),
            ]

            for curve in curveDefs {
                var path = Path()
                let steps = 40
                for step in 0...steps {
                    let t = Double(step) / Double(steps)
                    let x = t * size.width
                    let base = curve.startY + (curve.endY - curve.startY) * t
                    let wave = sin(t * .pi * 1.3 + curve.phase) * curve.amplitude
                    let y = (base + wave) * size.height
                    if step == 0 {
                        path.move(to: CGPoint(x: x, y: y))
                    } else {
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                }
                context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(curve.opacityGlow)), lineWidth: curve.width * 5)
                context.stroke(path, with: .color(DesignTokens.Colors.accentCyan.opacity(curve.opacityCore)), lineWidth: curve.width)
            }
        }
    }

    /// Real candlesticks float at their own open/close range — the
    /// Reference's bodies are NOT bottom-aligned to a shared floor (that
    /// was this file's original bug, confirmed by directly comparing a CI
    /// screenshot against the Reference: this file had been drawing a bar
    /// chart growing from a fixed baseline, not floating candles). Each
    /// body's vertical center now follows a noisy random walk with a
    /// gentle upward drift instead, giving the Reference's irregular
    /// rising-staircase look, with independent wicks above AND below each
    /// body. Also matches the Reference's fade: candles read fainter on
    /// the left (older) and brighter toward the right (recent), and its
    /// color is a fairly uniform muted blue rather than a bright two-tone.
    private var candles: some View {
        Canvas { context, size in
            var seed: UInt64 = 0xD1B5_4A32_9E77_1C03
            func nextUnit() -> Double {
                seed ^= seed << 13
                seed ^= seed >> 7
                seed ^= seed << 17
                return Double(seed % 1000) / 1000
            }

            struct CandleShape {
                let bodyPath: Path
                let wickPath: Path
                let fade: Double
            }

            let candleCount = 20
            let candleSlot = size.width / Double(candleCount)
            let topFraction = 0.34
            let bottomFraction = 0.86
            let glowRadius = size.width * 0.025

            var shapes: [CandleShape] = []
            var center = bottomFraction
            for index in 0..<candleCount {
                let progress = Double(index) / Double(candleCount - 1)
                let drift = (bottomFraction - topFraction) / Double(candleCount) * 1.25
                let noise = (nextUnit() - 0.5) * 0.055
                center -= drift * (0.4 + progress * 0.85) + max(0, noise)
                center = min(max(center, topFraction), bottomFraction)

                let centerY = center * size.height
                let bodyHeight = size.height * (0.016 + nextUnit() * 0.022)
                let x = candleSlot * (Double(index) + 0.5)
                let bodyWidth = candleSlot * 0.42
                let upperWick = bodyHeight * (0.4 + nextUnit() * 0.8)
                let lowerWick = bodyHeight * (0.15 + nextUnit() * 0.5)

                var wick = Path()
                wick.move(to: CGPoint(x: x, y: centerY - bodyHeight / 2 - upperWick))
                wick.addLine(to: CGPoint(x: x, y: centerY + bodyHeight / 2 + lowerWick))

                let bodyRect = CGRect(x: x - bodyWidth / 2, y: centerY - bodyHeight / 2, width: bodyWidth, height: bodyHeight)
                let bodyPath = Path(roundedRect: bodyRect, cornerRadius: 1.5)
                let fade = 0.3 + progress * 0.7
                shapes.append(CandleShape(bodyPath: bodyPath, wickPath: wick, fade: fade))
            }

            context.drawLayer { layer in
                layer.addFilter(.blur(radius: glowRadius))
                for shape in shapes {
                    layer.fill(shape.bodyPath, with: .color(DesignTokens.Colors.accentCyan.opacity(0.45 * shape.fade)))
                    layer.stroke(shape.wickPath, with: .color(DesignTokens.Colors.accentCyan.opacity(0.4 * shape.fade)), lineWidth: 2)
                }
            }

            for shape in shapes {
                context.stroke(shape.wickPath, with: .color(DesignTokens.Colors.accentCyan.opacity(0.55 * shape.fade)), lineWidth: 1)
                context.fill(shape.bodyPath, with: .color(DesignTokens.Colors.accentPrimary.opacity(0.7 * shape.fade)))
            }
        }
    }
}
