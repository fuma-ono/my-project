import SwiftUI

/// HQ指示(2026-11-19「みんなの分析画面を実装」、添付の参考画像をピクセル単位で再現)への対応。
///
/// 確認の結果(ユーザー回答「画像どおりダミーデータで実装」): このアプリには投稿・投票・
/// フォローといったコミュニティ機能のBackend/APIがまだ存在しない。そのため、ここでの
/// ユーザー名・アバター・投稿本文・いいね数・コメント数・投票結果・投票数は、すべて
/// デザイン確認用のダミーデータであり実データではない。他のタブ(市場分析・価格帯分析)の
/// 「架場の値を描かない」方針とは異なる、この回に限った明示の指示に基づく扱い。
/// Backendにコミュニティ機能が実装された際は、このファイルのダミーデータ・モデルを
/// 実データ連携に差し替える必要がある。

// MARK: - フィルターピル行(おすすめ/通貨ペア別/イベント別/予想・投票/ランキング)

enum CommunityFilter: Int, CaseIterable, Identifiable {
    case recommended
    case byPair
    case byEvent
    case voting
    case ranking

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .recommended: return "おすすめ"
        case .byPair: return "通貨ペア別"
        case .byEvent: return "イベント別"
        case .voting: return "予想・投票"
        case .ranking: return "ランキング"
        }
    }
}

struct CommunityFilterPillRow: View {
    @Binding var selection: CommunityFilter

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(CommunityFilter.allCases) { filter in
                    pill(filter)
                }
            }
        }
        .frame(width: 214)
    }

    private func pill(_ filter: CommunityFilter) -> some View {
        let isSelected = filter == selection
        return NotoText.text(filter.title, size: 6.8)
            .foregroundStyle(isSelected ? .white : SettingsCardStyle.subtitleColor)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(Capsule().fill(isSelected ? V5P.blue : SettingsCardStyle.cardFill))
            .overlay(Capsule().stroke(isSelected ? .clear : SettingsCardStyle.cardBorder, lineWidth: 0.6))
            .contentShape(Capsule())
            .onTapGesture { selection = filter }
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("communityFilterPill_\(filter.id)")
    }
}

// MARK: - 市場予想アンケートカード

private struct CommunityPollOption {
    let label: String
    let percent: Double
    let color: Color
}

struct CommunityMarketPollCard: View {
    private let options: [CommunityPollOption] = [
        CommunityPollOption(label: "利下げ", percent: 68, color: V5P.blue),
        CommunityPollOption(label: "据え置き", percent: 24, color: SettingsCardStyle.subtitleColor),
        CommunityPollOption(label: "利上げ", percent: 8, color: Color(red: 0.62, green: 0.42, blue: 0.95))
    ]
    private let totalVotes: Double = 12345

    private var donutSegments: [(id: String, start: CGFloat, end: CGFloat, color: Color)] {
        var start: CGFloat = 0
        return options.map { option in
            let end = start + CGFloat(option.percent / 100)
            let segment = (option.label, start, end, option.color)
            start = end
            return segment
        }
    }

    var body: some View {
        // ユーザー指摘(2026-11-19、2回目)「市場予測アンケートも余白が広いからもう少し
        // 狭めてください」: カード内の余白・行間を詰める。
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 4) {
                Image(systemName: "chart.pie.fill").font(.system(size: 10)).foregroundStyle(V5P.blue)
                NotoText.text("市場予想アンケート", size: 7.6).foregroundStyle(.white)
                Spacer(minLength: 4)
                HStack(spacing: 1) {
                    NotoText.text("すべて見る", size: 6).foregroundStyle(V5P.blue)
                    Image(systemName: "chevron.right").font(.system(size: 5.5, weight: .bold)).foregroundStyle(V5P.blue)
                }
            }
            NotoText.text("次回FOMCはどうなる?", size: 8.7).foregroundStyle(.white)
            HStack(alignment: .center, spacing: 6) {
                donutChart
                // ユーザー指摘(2026-11-19、2回目)「利下げとかをもう少し中心に」:
                // ラベルと%を離して両端に寄せず、1行にまとめて中央寄りに詰める。
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(options, id: \.label) { option in
                        HStack(spacing: 4) {
                            Circle().fill(option.color).frame(width: 6, height: 6)
                            NotoText.text(option.label, size: 6.3).foregroundStyle(.white)
                            NotoText.text(ValueFormat.percent(option.percent, fractionDigits: 0), size: 6.3).foregroundStyle(.white)
                        }
                    }
                }
                Spacer(minLength: 0)
                VStack(spacing: 2) {
                    NotoText.text("総投票数", size: 5.4).foregroundStyle(SettingsCardStyle.subtitleColor)
                    NotoText.text(ValueFormat.number(totalVotes, fractionDigits: 0), size: 8).foregroundStyle(.white)
                }
                .padding(.horizontal, 5)
                .padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 5).fill(Color.white.opacity(0.05)))
            }
        }
        .padding(7)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
        .accessibilityIdentifier("communityMarketPollCard")
    }

    private var donutChart: some View {
        // ユーザー指摘(2026-11-19、2回目)「円グラフですがもう少し参考画像のように
        // 太くしてください」: 輪の太さを7→11に。
        ZStack {
            ForEach(donutSegments, id: \.id) { segment in
                Circle()
                    .trim(from: segment.start, to: segment.end)
                    .stroke(segment.color, style: StrokeStyle(lineWidth: 11, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
            }
            NotoText.text(ValueFormat.percent(options[0].percent, fractionDigits: 0), size: 8.7).foregroundStyle(.white)
        }
        .frame(width: 42, height: 42)
    }
}

// MARK: - 投稿カード一覧

private struct CommunityPostDirection {
    enum Kind { case up, down, neutral }
    let kind: Kind
    let label: String

    var color: Color {
        switch kind {
        case .up: return V5P.green
        case .down: return V5P.red
        case .neutral: return SettingsCardStyle.subtitleColor
        }
    }

    var icon: String? {
        switch kind {
        case .up: return "arrow.up.right"
        case .down: return "arrow.down.right"
        case .neutral: return nil
        }
    }
}

private struct CommunityPost: Identifiable {
    let id: String
    let avatarSymbol: String
    let avatarColor: Color
    let username: String
    let verified: Bool
    let timeAgo: String
    let pair: String
    let direction: CommunityPostDirection
    let title: String
    let body: String
    let likeCount: Int
    let commentCount: Int
    let isFollowing: Bool
    /// サムネイルのローソク足の相対高さ(0...1)。見た目の傾向(上昇/下降)を示すだけの
    /// ダミー描画で、実際の値動きではない。
    let candleTrend: [CGFloat]
    let isBullishChart: Bool
}

private let communityDummyPosts: [CommunityPost] = [
    CommunityPost(
        id: "p1",
        avatarSymbol: "mountain.2.fill",
        avatarColor: Color(red: 0.40, green: 0.52, blue: 0.66),
        username: "FXトレーダーK",
        verified: true,
        timeAgo: "2時間前",
        pair: "USD/JPY",
        direction: CommunityPostDirection(kind: .up, label: "上昇予想"),
        title: "米CPIの結果を受けて、ドル買い優勢は続くと考えます",
        body: "インフレの粘着性が確認され、FRBの利下げは年内1回にとどまる可能性が高いです。",
        likeCount: 342,
        commentCount: 48,
        isFollowing: true,
        candleTrend: [0.3, 0.34, 0.4, 0.48, 0.55, 0.6, 0.68, 0.76, 0.84, 0.9],
        isBullishChart: true
    ),
    CommunityPost(
        id: "p2",
        avatarSymbol: "cat.fill",
        avatarColor: Color(red: 0.55, green: 0.50, blue: 0.42),
        username: "為替の森",
        verified: false,
        timeAgo: "3時間前",
        pair: "EUR/USD",
        direction: CommunityPostDirection(kind: .down, label: "下落予想"),
        title: "ユーロ圏の景気減速で、下値を試す展開を予想",
        body: "ドイツの製造業PMIが予想を下回り、ユーロ売り圧力が強まっています。",
        likeCount: 188,
        commentCount: 32,
        isFollowing: false,
        candleTrend: [0.9, 0.82, 0.75, 0.68, 0.6, 0.5, 0.42, 0.35, 0.3, 0.25],
        isBullishChart: false
    ),
    CommunityPost(
        id: "p3",
        avatarSymbol: "sun.horizon.fill",
        avatarColor: Color(red: 0.72, green: 0.55, blue: 0.35),
        username: "相場の達人",
        verified: true,
        timeAgo: "5時間前",
        pair: "GBP/USD",
        direction: CommunityPostDirection(kind: .neutral, label: "中立"),
        title: "1.3200〜1.3350のレンジで推移と予想",
        body: "英国の金利見通しが不透明で、方向感に欠ける展開が続くと考えています。",
        likeCount: 125,
        commentCount: 21,
        isFollowing: false,
        candleTrend: [0.5, 0.58, 0.48, 0.6, 0.45, 0.55, 0.5, 0.62, 0.47, 0.53],
        isBullishChart: true
    )
]

struct CommunityPostListCard: View {
    var body: some View {
        VStack(spacing: 6) {
            ForEach(communityDummyPosts) { post in
                CommunityPostCard(post: post)
            }
        }
    }
}

private struct CommunityPostCard: View {
    let post: CommunityPost

    // ユーザー指摘(2026-11-19、2回目)「投稿カードの枠が縦に長すぎます/投稿カード内の
    // 配置も違うので修正してください」: 行間・余白を詰め、サムネイルを縮小して
    // 縦に間延びしないようにする。
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                ZStack {
                    Circle().fill(post.avatarColor)
                    Image(systemName: post.avatarSymbol).font(.system(size: 8)).foregroundStyle(.white.opacity(0.85))
                }
                .frame(width: 20, height: 20)
                HStack(spacing: 2) {
                    NotoText.text(post.username, size: 7).foregroundStyle(.white)
                    if post.verified {
                        Image(systemName: "checkmark.seal.fill").font(.system(size: 6.5)).foregroundStyle(V5P.blue)
                    }
                }
                NotoText.text(post.timeAgo, size: 5.8).foregroundStyle(SettingsCardStyle.subtitleColor)
                Spacer(minLength: 0)
            }

            HStack(alignment: .center, spacing: 6) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 5) {
                        NotoText.text(post.pair, size: 6)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Color.white.opacity(0.08)))
                        HStack(spacing: 2) {
                            if let icon = post.direction.icon {
                                Image(systemName: icon).font(.system(size: 6, weight: .bold))
                            }
                            NotoText.text(post.direction.label, size: 6)
                        }
                        .foregroundStyle(post.direction.color)
                    }
                    NotoText.text(post.title, size: 7.3)
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 4)
                CommunityCandleThumbnail(trend: post.candleTrend, isBullish: post.isBullishChart)
                    .frame(width: 34, height: 30)
            }

            (NotoText.text(post.body, size: 6.3).foregroundColor(SettingsCardStyle.subtitleColor)
                + Text(" もっと見る").font(.system(size: 6.3)).foregroundColor(V5P.blue))
                .lineLimit(2)

            HStack(spacing: 10) {
                footerItem(icon: "heart.fill", value: "\(post.likeCount)", color: Color(red: 0.95, green: 0.32, blue: 0.52))
                footerItem(icon: "bubble.left", value: "\(post.commentCount)", color: SettingsCardStyle.subtitleColor)
                footerItem(icon: "bookmark", value: "保存", color: SettingsCardStyle.subtitleColor)
                Spacer(minLength: 0)
                NotoText.text(post.isFollowing ? "フォロー中" : "フォローする", size: 6)
                    .foregroundStyle(V5P.blue)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .overlay(Capsule().stroke(V5P.blue, lineWidth: 0.7))
            }
        }
        .padding(7)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
        .accessibilityIdentifier("communityPostCard_\(post.id)")
    }

    private func footerItem(icon: String, value: String, color: Color) -> some View {
        HStack(spacing: 2) {
            Image(systemName: icon).font(.system(size: 6.5)).foregroundStyle(color)
            NotoText.text(value, size: 6).foregroundStyle(color)
        }
    }
}

/// 投稿カード右上のローソク足風サムネイル(装飾のみ、実際の値動きではない)。
private struct CommunityCandleThumbnail: View {
    let trend: [CGFloat]
    let isBullish: Bool

    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .bottom, spacing: 1) {
                ForEach(trend.indices, id: \.self) { index in
                    Capsule()
                        .fill(isBullish ? V5P.green : V5P.red)
                        .frame(
                            width: max(1.5, (geo.size.width - CGFloat(trend.count - 1)) / CGFloat(trend.count)),
                            height: max(2, trend[index] * geo.size.height)
                        )
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .bottom)
        }
    }
}
