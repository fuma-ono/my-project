import SwiftUI

/// SCR-001 Home's "重要度" indicator. The Reference renders it as a
/// 2-slot star row — 0/1/2 filled stars for low/medium/high — not the
/// 3-star `Importance.starDisplay` text used elsewhere (Indicators/Event
/// Detail/Historical Event Detail, all out of scope this round and left
/// untouched). Filled and empty stars are also different colors (gold vs.
/// muted outline) in the Reference, which a single `Text` run can't
/// express, hence a per-glyph `Image(systemName:)` row instead.
struct StarRating: View {
    let importance: Importance

    private var filledCount: Int {
        switch importance {
        case .low: return 0
        case .medium: return 1
        case .high: return 2
        }
    }

    var body: some View {
        HStack(spacing: 1) {
            ForEach(0..<2, id: \.self) { index in
                Image(systemName: index < filledCount ? "star.fill" : "star")
                    .foregroundStyle(index < filledCount ? DesignTokens.Colors.Home.ratingGold : DesignTokens.Colors.Home.ratingEmpty)
            }
        }
        .font(.system(size: 12, weight: .medium))
    }
}
