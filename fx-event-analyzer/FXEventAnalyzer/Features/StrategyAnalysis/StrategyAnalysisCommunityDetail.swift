import SwiftUI

/// 投稿詳細画面(HQ指示 2026-11-22「Claude Codeへの実装指示：みんなの分析画面」section 7)。
/// `AppRoute.communityPostDetail(id:)`経由で投稿一覧の各カードから遷移する。
///
/// コミュニティ機能のBackend/APIがまだ存在しないため(`StrategyAnalysisCommunity.swift`
/// 冒頭の注記と同じ)、この画面も投稿一覧と同じダミーデータ(`communityDummyPosts`)を
/// `id`で引いて表示するだけで、実データ・実APIには一切つながっていない。
struct CommunityPostDetailView: View {
    let postId: String
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss
    @State private var isLiked = false
    @State private var isSaved = false
    @State private var isFollowingLocal: Bool

    init(postId: String, tabSelection: Binding<Int>) {
        self.postId = postId
        _tabSelection = tabSelection
        _isFollowingLocal = State(initialValue: communityDummyPosts.first(where: { $0.id == postId })?.isFollowing ?? false)
    }

    private var post: CommunityPost? {
        communityDummyPosts.first(where: { $0.id == postId })
    }

    var body: some View {
        V5Viewport {
            V5Header(title: "投稿詳細", back: true, onBack: { dismiss() })
            Group {
                if let post {
                    ScrollView(showsIndicators: false) {
                        content(post)
                            .padding(.vertical, 6)
                            .frame(width: V5P.W)
                    }
                    .frame(width: V5P.W, height: 398)
                    .position(x: V5P.W / 2, y: 54 + 398 / 2)
                } else {
                    // ダミー配列にid一致が無い(通常は起きない)場合の安全網。架空の内容は出さない。
                    FXEmptyState(icon: "doc.text.magnifyingglass", title: "投稿が見つかりません", message: "")
                        .frame(width: V5P.W, height: 398)
                        .position(x: V5P.W / 2, y: 54 + 398 / 2)
                        .accessibilityIdentifier("communityPostDetailNotFound")
                }
            }
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private func content(_ post: CommunityPost) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            posterRow(post)
            HStack(spacing: 5) {
                NotoText.text(post.pair, size: 7)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.white.opacity(0.08)))
                HStack(spacing: 2) {
                    if let icon = post.direction.icon {
                        Image(systemName: icon).font(.system(size: 6.5, weight: .bold))
                    }
                    NotoText.text(post.direction.label, size: 6.5)
                }
                .foregroundStyle(post.direction.color)
            }
            NotoText.text(post.title, size: 8.5)
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            // HQ指示(2026-11-22、section 7)「添付チャート」。投稿カードと同じ理由
            // (`CommunityChartPlaceholder`のドキュメントコメント参照)で架空のチャートは
            // 描かず、空の枠だけを大きく表示する。
            CommunityChartPlaceholder()
                .frame(width: 214, height: 120)
                .accessibilityIdentifier("communityPostDetailChartPlaceholder")
            VStack(alignment: .leading, spacing: 3) {
                NotoText.text("分析根拠", size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
                NotoText.text(post.body, size: 7.3)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let level = post.highlightedPriceLevel {
                VStack(alignment: .leading, spacing: 3) {
                    NotoText.text("注目価格帯", size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
                    NotoText.text(level, size: 7.3).foregroundStyle(.white)
                }
            }
            Rectangle().fill(Color.white.opacity(0.08)).frame(height: 0.6)
            CommunityFooterActionsRow(post: post, isLiked: $isLiked, isSaved: $isSaved)
        }
        .padding(9)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
        .accessibilityIdentifier("communityPostDetail_\(post.id)")
    }

    private func posterRow(_ post: CommunityPost) -> some View {
        HStack(spacing: 8) {
            ZStack {
                Circle().fill(post.avatarColor)
                Image(systemName: post.avatarSymbol).font(.system(size: 13)).foregroundStyle(.white.opacity(0.85))
            }
            .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    NotoText.text(post.username, size: 8).foregroundStyle(.white)
                    if post.verified {
                        Image(systemName: "checkmark.seal.fill").font(.system(size: 7)).foregroundStyle(V5P.blue)
                    }
                }
                NotoText.text(post.timeAgo, size: 6.3).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            Spacer(minLength: 4)
            NotoText.text(isFollowingLocal ? "フォロー中" : "フォローする", size: 6.5)
                .foregroundStyle(isFollowingLocal ? V5P.blue : .white)
                .padding(.horizontal, 9)
                .padding(.vertical, 4)
                .background(Capsule().fill(isFollowingLocal ? Color.clear : V5P.blue))
                .overlay(Capsule().stroke(V5P.blue, lineWidth: isFollowingLocal ? 0.7 : 0))
                .contentShape(Capsule())
                .onTapGesture { isFollowingLocal.toggle() }
        }
    }
}
