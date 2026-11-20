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
        // ユーザー指摘(2026-11-19、4回目)「円グラフをもう少し右に/次回FOMCはどうなる？を
        // もう少し上に/68%や24%、8%をもう少し右にして右揃えにして/総投票数、12,345の
        // 文字を2pt大きくして」。
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                // ユーザー指摘(2026-11-19、9回目)「市場予測アンケートのアイコンがただの
                // 円になっている。参考画像のようにしてほしい」: 前回`circle.fill`に
                // 差し替えたが単純な丸すぎたため、参考画像どおりの円グラフアイコンに戻す。
                // 小さいサイズで円が割れて見えた(7回目の指摘)原因はサイズが小さすぎた
                // ことのため、サイズを大きくして対応する。
                Image(systemName: "chart.pie.fill").font(.system(size: 13)).foregroundStyle(V5P.blue)
                NotoText.text("市場予想アンケート", size: 7.6).foregroundStyle(.white)
                Spacer(minLength: 4)
                HStack(spacing: 1) {
                    NotoText.text("すべて見る", size: 6).foregroundStyle(V5P.blue)
                    Image(systemName: "chevron.right").font(.system(size: 5.5, weight: .bold)).foregroundStyle(V5P.blue)
                }
            }
            .padding(.bottom, 2)
            NotoText.text("次回FOMCはどうなる?", size: 8.7).foregroundStyle(.white)
                .padding(.bottom, 4)
            // ユーザー指摘(2026-11-19、5回目)「市場分析アンケートの枠を少し縦を伸ばして、
            // それに合わせて円グラフを少し下に」: 下の行に上の余白を足して、縦に伸ばした
            // 枠の中で下寄りに配置する。
            HStack(alignment: .center, spacing: 0) {
                Spacer(minLength: 6)
                donutChart
                Spacer(minLength: 10)
                VStack(alignment: .trailing, spacing: 3) {
                    ForEach(options, id: \.label) { option in
                        HStack(spacing: 4) {
                            Circle().fill(option.color).frame(width: 6, height: 6)
                            NotoText.text(option.label, size: 6.3).foregroundStyle(.white)
                            Spacer(minLength: 4)
                            NotoText.text(ValueFormat.percent(option.percent, fractionDigits: 0), size: 6.3).foregroundStyle(.white)
                        }
                        .frame(width: 70)
                    }
                }
                Spacer(minLength: 6)
                VStack(spacing: 2) {
                    // ユーザー指摘(2026-11-19、5回目)「総投票数だけ文字サイズを1pt小さく
                    // して、12345はそのまま」。
                    NotoText.text("総投票数", size: 6.4).foregroundStyle(SettingsCardStyle.subtitleColor)
                    NotoText.text(ValueFormat.number(totalVotes, fractionDigits: 0), size: 10).foregroundStyle(.white)
                }
                .padding(.horizontal, 5)
                .padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 5).fill(Color.white.opacity(0.05)))
            }
            .padding(.top, 6)
        }
        .padding(.horizontal, 7)
        .padding(.top, 5)
        .padding(.bottom, 12)
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
            // ユーザー指摘(2026-11-19、8回目)「68%の数字を0.5pt大きくして」。
            NotoText.text(ValueFormat.percent(options[0].percent, fractionDigits: 0), size: 9.2).foregroundStyle(.white)
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
        isFollowing: true
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
        isFollowing: false
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
        isFollowing: false
    )
]

struct CommunityPostListCard: View {
    private static let dividerColor = Color(red: 0.35, green: 0.62, blue: 0.92).opacity(0.3)

    // ユーザー指摘(2026-11-19、4回目)「投稿カードは各カードで枠を囲むのではなく線で
    // 区切るようにしてください」: 個別のカード枠をやめ、1つの枠の中で投稿どうしを
    // 区切り線だけで並べる。
    // ユーザー指摘(2026-11-19、5回目)「FXトレーダーKとアイコンをもう少し投稿カードの
    // 上枠に近づけて」: 枠の上の余白だけ詰める(下・左右の余白は変えない)。
    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(communityDummyPosts.enumerated()), id: \.element.id) { index, post in
                CommunityPostCard(post: post)
                if index < communityDummyPosts.count - 1 {
                    Rectangle().fill(Self.dividerColor).frame(height: 0.6)
                        .padding(.horizontal, 7)
                }
            }
        }
        .padding(.top, 3)
        .padding(.bottom, 7)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }
}

private struct CommunityPostCard: View {
    let post: CommunityPost

    // ユーザー指摘(2026-11-19、3回目)「USD/JPY上昇予想はFXトレーダーの下にして、
    // アイコンに対して2行で」: その右にユーザー名+時刻(1行目)・通貨ペア+予想方向
    // (2行目)の2行をまとめる。
    // ユーザー指摘(2026-11-19、7回目)「投稿カードのアイコンの大きさを少し大きくして」:
    // アバターを20→24に。
    // ユーザー指摘(2026-11-19、9回目)「米CPIの結果が下すぎる。アイコンの下に来るように
    // して。そして、インフレの文章も同じように。ただし横の四角の大きさや位置は戻すに」:
    // タイトル・本文を、チャート枠(56x56)の高さに引っ張られて下がっていた全幅の別行
    // から、アバター横の列(通貨ペア行の下)に戻す。列の内容がチャート枠より低くても、
    // 次の行がチャート枠の高さ分だけ空かないようにする。チャート枠自体のサイズ・位置は
    // 変更しない。
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .top, spacing: 6) {
                ZStack {
                    Circle().fill(post.avatarColor)
                    Image(systemName: post.avatarSymbol).font(.system(size: 9.5)).foregroundStyle(.white.opacity(0.85))
                }
                .frame(width: 24, height: 24)

                VStack(alignment: .leading, spacing: 3) {
                    // ユーザー指摘(2026-11-19、5回目)「2時間前の位置はユーザー名の横に
                    // して」: 右端に離さず、ユーザー名のすぐ隣に置く。
                    HStack(spacing: 4) {
                        NotoText.text(post.username, size: 7).foregroundStyle(.white)
                        if post.verified {
                            Image(systemName: "checkmark.seal.fill").font(.system(size: 6.5)).foregroundStyle(V5P.blue)
                        }
                        NotoText.text(post.timeAgo, size: 5.8).foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
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
                    (NotoText.text(post.body, size: 6.3).foregroundColor(SettingsCardStyle.subtitleColor)
                        + Text(" もっと見る").font(.system(size: 6.3)).foregroundColor(V5P.blue))
                        .lineLimit(2)
                }

                Spacer(minLength: 4)
                CommunityChartPlaceholder()
                    .frame(width: 56, height: 56)
            }

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
        .padding(.horizontal, 7)
        .padding(.vertical, 7)
        .frame(width: 214, alignment: .leading)
        .accessibilityIdentifier("communityPostCard_\(post.id)")
    }

    // ユーザー指摘(2026-11-19、8回目)「ハート、342、48保存の文字をもう少し大きく」。
    private func footerItem(icon: String, value: String, color: Color) -> some View {
        HStack(spacing: 2) {
            Image(systemName: icon).font(.system(size: 7.5)).foregroundStyle(color)
            NotoText.text(value, size: 7).foregroundStyle(color)
        }
    }
}

/// 投稿カード右上のチャート枠(2026-11-19、5回目「チャートはユーザーがチャート画面を
/// 載せるので今はデータがなくていい。ただ、もう少し大きくして四角で囲むようにして」:
/// 架空のローソク足・抵抗帯の描画はやめ、ユーザーが将来チャート画像を貼る場所を示す
/// 空の角丸の枠だけにする)。
private struct CommunityChartPlaceholder: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 5)
            .stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7)
            .background(RoundedRectangle(cornerRadius: 5).fill(Color.white.opacity(0.03)))
    }
}
