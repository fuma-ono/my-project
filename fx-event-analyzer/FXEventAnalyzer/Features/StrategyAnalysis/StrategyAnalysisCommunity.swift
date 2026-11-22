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
///
/// HQ指示(2026-11-22「Claude Codeへの実装指示：みんなの分析画面」)への対応(続き)。
/// 投稿作成・アンケート作成・投稿詳細・ランキングの3種・フォロー導線・10件ずつの
/// 追加読み込みを新たに実装した。HQとの確認(section 10「実装していない機能を動作する
/// ように見せない」/「API・DBが未対応の場合は、必要な変更点を整理する」への対応方針)の
/// 結果:
/// - Backend/APIが一切無い前提は変わらないため、投稿・投票の「送信」や「集計」は一切
///   偽装しない。投稿作成・アンケート作成の確認画面では「投稿する」ボタンを無効化し、
///   理由を明記する(`StrategyAnalysisCommunityCompose.swift`)。
/// - 「10件ずつ追加読み込み」は、Backend側のページネーションAPIがまだ無いため、この
///   ファイルの固定ダミー配列(`communityDummyPosts`)から段階的に見せるだけのローカルな
///   演出にとどめる(`CommunityPostListCard`)。実際のAPIページネーションは
///   `PaginationMeta`(`Networking/PaginationMeta.swift`)の規約に合わせて別途実装が必要。
/// - ランキング(人気投稿/人気ユーザー/分析精度)は構造(セグメント+プレースホルダー)だけ
///   用意し、具体的な集計・「後から予想を書き換えて実績を操作できない」ための改ざん防止
///   設計はBackend側の設計が先に必要なため、ここでは架空の順位・数値を一切出さない
///   (`StrategyAnalysisCommunityRanking.swift`)。

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
            HStack(spacing: 4) {
                ForEach(CommunityFilter.allCases) { filter in
                    pill(filter)
                }
            }
        }
        .frame(width: 214)
    }

    private func pill(_ filter: CommunityFilter) -> some View {
        let isSelected = filter == selection
        // ユーザー指摘(2026-11-22、添付の参考画像との実測比較)「大きさが全然違う」:
        // 5つのピルが214pt列に1行で収まる参考画像のサイズに合わせ、文字サイズ・余白を縮小した
        // (6.8pt/横9・縦5 → 5.2pt/横6.5・縦3.2)。
        return NotoText.text(filter.title, size: 5.2)
            .foregroundStyle(isSelected ? .white : SettingsCardStyle.subtitleColor)
            .padding(.horizontal, 6.5)
            .padding(.vertical, 3.2)
            .background(Capsule().fill(isSelected ? V5P.blue : SettingsCardStyle.cardFill))
            .overlay(Capsule().stroke(isSelected ? .clear : SettingsCardStyle.cardBorder, lineWidth: 0.6))
            .contentShape(Capsule())
            .onTapGesture { selection = filter }
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("communityFilterPill_\(filter.id)")
    }
}

/// HQ指示(2026-11-22、添付の参考画像「みんなの分析」を再現): 参考画像から実測した
/// 色値。既存の`V5P`/`SettingsCardStyle`トークンでは表現できない、この画面固有の色のみ
/// ここにまとめる(実測はピクセルサンプリングによる。アンチエイリアスの影響で多少の
/// 誤差はあるが、参考画像と視覚的に一致することを優先した)。
enum CommunityPalette {
    /// 「USD/JPY」等の通貨ペアバッジ・「投票する」ボタン・「みんなで投票しよう！」
    /// ボタンの塗り(参考画像実測: およそ RGB(2,75,160))。
    static let solidBlue = Color(red: 2 / 255, green: 75 / 255, blue: 160 / 255)
    /// 投票割合バーの未塗り部分(参考画像実測: およそ RGB(27,39,66))。
    static let barTrack = Color(red: 27 / 255, green: 39 / 255, blue: 66 / 255)
    /// 「据え置き」バー・凡例の淡いラベンダー色(参考画像実測: およそ RGB(185,207,234))。
    static let barLavender = Color(red: 185 / 255, green: 207 / 255, blue: 234 / 255)
    /// 「FOMC」などのイベントタグバッジの塗り(参考画像実測: およそ RGB(62,53,33)、
    /// 燻んだゴールド)。
    static let eventTagFill = Color(red: 62 / 255, green: 53 / 255, blue: 33 / 255)
    /// イベントタグバッジの文字色(参考画像実測: およそ RGB(251,184,48)、明るいゴールド)。
    static let eventTagText = Color(red: 251 / 255, green: 184 / 255, blue: 48 / 255)
}

// MARK: - 市場予想アンケートカード

private struct CommunityPollOption {
    let label: String
    let percent: Double
    let color: Color
}

/// HQ指示(2026-11-22、添付の参考画像どおりピクセル単位・色味を完全再現): 見出しを
/// 「公式アンケート」に、各選択肢を横棒の進捗バー表示に、総投票数を「○○人が投票」の
/// 文言に、「投票する」ボタンを新設するなど、参考画像どおりに全面的に作り直した。
/// 投票の送信・集計はBackend未対応のため(ファイル冒頭の注記参照)、「投票する」
/// ボタンはタップ操作を持たない静的な表示にとどめる(偽の投票成功を見せない)。
struct CommunityMarketPollCard: View {
    private let options: [CommunityPollOption] = [
        CommunityPollOption(label: "利下げ", percent: 68, color: V5P.blue),
        CommunityPollOption(label: "据え置き", percent: 24, color: CommunityPalette.barLavender),
        CommunityPollOption(label: "利上げ", percent: 8, color: Color(red: 0.62, green: 0.42, blue: 0.95))
    ]
    private let voterCount: Double = 12458
    private let daysRemaining = 2

    private var donutSegments: [(id: String, start: CGFloat, end: CGFloat, color: Color)] {
        var start: CGFloat = 0
        return options.map { option in
            let end = start + CGFloat(option.percent / 100)
            let segment = (option.label, start, end, option.color)
            start = end
            return segment
        }
    }

    // ユーザー指摘(2026-11-22、添付の参考画像との実測比較)「大きさが全然違う/円グラフの
    // 大きさが違う/枠が全体的に余白が多すぎる」: 参考画像をピクセル実測した結果、円グラフの
    // 外径が現状の約6割(frame 60→34, 線幅11→8)、カード全体の高さも約75%に縮む必要が
    // あると判明。行間・余白・見出し回りのフォントサイズも合わせて詰めた。
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 3) {
                Image(systemName: "megaphone.fill").font(.system(size: 10)).foregroundStyle(.white)
                NotoText.text("公式アンケート", size: 6.6).foregroundStyle(.white)
                Spacer(minLength: 4)
                HStack(spacing: 2) {
                    NotoText.text("みんなで投票しよう！", size: 5.2).foregroundStyle(V5P.blue)
                    Image(systemName: "chevron.right").font(.system(size: 4.8, weight: .bold)).foregroundStyle(V5P.blue)
                }
                .padding(.horizontal, 5)
                .padding(.vertical, 3)
                .background(Capsule().fill(CommunityPalette.solidBlue))
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                NotoText.text("次回FOMCはどうなる?", size: 7.6).foregroundStyle(.white)
                Spacer(minLength: 4)
                Image(systemName: "clock").font(.system(size: 5.8)).foregroundStyle(SettingsCardStyle.subtitleColor)
                NotoText.text("残り\(daysRemaining)日", size: 5.8).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            HStack(alignment: .center, spacing: 6) {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(options, id: \.label) { option in
                        HStack(spacing: 5) {
                            NotoText.text(option.label, size: 6.2).foregroundStyle(.white)
                                .frame(width: 30, alignment: .leading)
                            Capsule().fill(CommunityPalette.barTrack).frame(maxWidth: .infinity).frame(height: 5)
                                .overlay(alignment: .leading) {
                                    GeometryReader { geo in
                                        Capsule().fill(option.color)
                                            .frame(width: geo.size.width * option.percent / 100)
                                    }
                                }
                            NotoText.text(ValueFormat.percent(option.percent, fractionDigits: 0), size: 6.2)
                                .foregroundStyle(.white)
                                .frame(width: 20, alignment: .trailing)
                        }
                    }
                }
                donutChart
            }
            HStack(spacing: 4) {
                Image(systemName: "person.2.fill").font(.system(size: 6.3)).foregroundStyle(SettingsCardStyle.subtitleColor)
                NotoText.text("\(ValueFormat.number(voterCount, fractionDigits: 0))人が投票", size: 5.8)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                Spacer(minLength: 4)
                HStack(spacing: 3) {
                    NotoText.text("投票する", size: 6).foregroundStyle(.white)
                    Image(systemName: "lock.fill").font(.system(size: 5.3)).foregroundStyle(.white)
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 3.5)
                .background(Capsule().fill(CommunityPalette.solidBlue))
            }
        }
        .padding(.horizontal, 5)
        .padding(.top, 4)
        .padding(.bottom, 6)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
        .accessibilityIdentifier("communityMarketPollCard")
    }

    private var donutChart: some View {
        ZStack {
            ForEach(donutSegments, id: \.id) { segment in
                Circle()
                    .trim(from: segment.start, to: segment.end)
                    .stroke(segment.color, style: StrokeStyle(lineWidth: 8, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
            }
            NotoText.text(ValueFormat.percent(options[0].percent, fractionDigits: 0), size: 5.3).foregroundStyle(.white)
        }
        .frame(width: 34, height: 34)
    }
}

// MARK: - 投稿カード一覧

/// HQ指示(2026-11-22)の投稿作成フォーム(`StrategyAnalysisCommunityCompose.swift`)・
/// 投稿詳細画面(`StrategyAnalysisCommunityDetail.swift`)からも参照するため`private`を外す。
struct CommunityPostDirection {
    enum Kind: Hashable { case up, down, neutral }
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

/// 投稿詳細画面(`AppRoute.communityPostDetail(id:)`経由)が`id`で引けるよう`private`を外す。
struct CommunityPost: Identifiable {
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
    /// 投稿詳細画面の「注目価格帯」(任意、HQ指示 2026-11-22 section 4・7)。
    var highlightedPriceLevel: String? = nil
    /// 投稿カードの「対象イベント」バッジ(任意、HQ指示 2026-11-22 section 5「対象イベント
    /// （任意）」、添付の参考画像のゴールドの「FOMC」バッジ)。
    var eventTag: String? = nil
}

/// 投稿詳細画面からも`id`で引けるよう`private`を外す。HQ指示(2026-11-22)「ダミー投稿を
/// 増やしてスクロール読み込みのUXだけ再現」に対応し、3件→13件に拡張した(内容はすべて
/// ダミー、架空の集計やAPIページネーションは実装しない — ファイル冒頭の注記参照)。
let communityDummyPosts: [CommunityPost] = [
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
        highlightedPriceLevel: "155.00円が次の節目",
        eventTag: "FOMC"
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
    ),
    CommunityPost(
        id: "p4",
        avatarSymbol: "leaf.fill",
        avatarColor: Color(red: 0.35, green: 0.62, blue: 0.42),
        username: "為替アナリストS",
        verified: false,
        timeAgo: "4時間前",
        pair: "EUR/JPY",
        direction: CommunityPostDirection(kind: .up, label: "上昇予想"),
        title: "ECB高官のタカ派発言でユーロ円は底堅い展開に",
        body: "利下げ打ち止めを示唆する発言が相次ぎ、金利差縮小観測からユーロ買いが優勢です。",
        likeCount: 97,
        commentCount: 14,
        isFollowing: true,
        highlightedPriceLevel: "165.00円を上抜けると170円が視野に",
        eventTag: "ECB"
    ),
    CommunityPost(
        id: "p5",
        avatarSymbol: "building.columns.fill",
        avatarColor: Color(red: 0.45, green: 0.45, blue: 0.60),
        username: "金利ウォッチャー",
        verified: true,
        timeAgo: "6時間前",
        pair: "GBP/JPY",
        direction: CommunityPostDirection(kind: .down, label: "下落予想"),
        title: "BOEの利下げ転換観測でポンド円は上値が重い",
        body: "次回会合での利下げ開始観測が強まり、ポンド売りが優勢になると見ています。",
        likeCount: 210,
        commentCount: 40,
        isFollowing: false
    ),
    CommunityPost(
        id: "p6",
        avatarSymbol: "tortoise.fill",
        avatarColor: Color(red: 0.50, green: 0.58, blue: 0.40),
        username: "スイング職人",
        verified: false,
        timeAgo: "7時間前",
        pair: "USD/CHF",
        direction: CommunityPostDirection(kind: .neutral, label: "中立"),
        title: "重要指標待ちでドルスイスはしばらく静かな展開",
        body: "方向感を出す材料に乏しく、当面はレンジ内の値動きが続くと考えています。",
        likeCount: 54,
        commentCount: 9,
        isFollowing: false
    ),
    CommunityPost(
        id: "p7",
        avatarSymbol: "bolt.fill",
        avatarColor: Color(red: 0.70, green: 0.55, blue: 0.20),
        username: "値動きウォッチ",
        verified: true,
        timeAgo: "8時間前",
        pair: "AUD/USD",
        direction: CommunityPostDirection(kind: .up, label: "上昇予想"),
        title: "RBA据え置きもタカ派姿勢で豪ドルは底堅い",
        body: "声明文の利下げへの慎重な表現が好感され、豪ドル買いが続くと考えています。",
        likeCount: 301,
        commentCount: 55,
        isFollowing: true,
        highlightedPriceLevel: "0.6650が目先のレジスタンス",
        eventTag: "RBA"
    ),
    CommunityPost(
        id: "p8",
        avatarSymbol: "pawprint.fill",
        avatarColor: Color(red: 0.60, green: 0.45, blue: 0.70),
        username: "FX歴10年",
        verified: false,
        timeAgo: "9時間前",
        pair: "NZD/USD",
        direction: CommunityPostDirection(kind: .down, label: "下落予想"),
        title: "乳製品価格の下落でNZドルは軟調な展開に",
        body: "主要輸出品の価格下落が景気懸念につながり、NZドル売りが優勢と見ています。",
        likeCount: 76,
        commentCount: 11,
        isFollowing: false
    ),
    CommunityPost(
        id: "p9",
        avatarSymbol: "flame.fill",
        avatarColor: Color(red: 0.75, green: 0.35, blue: 0.30),
        username: "指標トレーダー",
        verified: true,
        timeAgo: "10時間前",
        pair: "USD/CAD",
        direction: CommunityPostDirection(kind: .up, label: "上昇予想"),
        title: "原油安を受けてカナダドルは対ドルで軟化",
        body: "資源国通貨への逆風が続き、ドルカナダは上昇基調が続くと考えています。",
        likeCount: 133,
        commentCount: 22,
        isFollowing: false
    ),
    CommunityPost(
        id: "p10",
        avatarSymbol: "ruler.fill",
        avatarColor: Color(red: 0.40, green: 0.60, blue: 0.65),
        username: "テクニカル重視",
        verified: false,
        timeAgo: "12時間前",
        pair: "EUR/USD",
        direction: CommunityPostDirection(kind: .neutral, label: "中立"),
        title: "米CPI発表待ちでユーロドルはレンジ内推移",
        body: "重要指標を控え様子見ムードが強く、当面は狭いレンジでの推移を予想します。",
        likeCount: 88,
        commentCount: 16,
        isFollowing: false
    ),
    CommunityPost(
        id: "p11",
        avatarSymbol: "binoculars.fill",
        avatarColor: Color(red: 0.30, green: 0.45, blue: 0.70),
        username: "長期目線",
        verified: true,
        timeAgo: "14時間前",
        pair: "USD/JPY",
        direction: CommunityPostDirection(kind: .up, label: "上昇予想"),
        title: "日米の金融政策スタンスの差は当面縮まらない",
        body: "日銀の緩やかな正常化ペースに対し、FRBの利下げも緩慢なため金利差は残ると見ています。",
        likeCount: 420,
        commentCount: 63,
        isFollowing: true,
        eventTag: "BOJ"
    ),
    CommunityPost(
        id: "p12",
        avatarSymbol: "sunrise.fill",
        avatarColor: Color(red: 0.80, green: 0.60, blue: 0.35),
        username: "朝型トレーダー",
        verified: false,
        timeAgo: "16時間前",
        pair: "GBP/USD",
        direction: CommunityPostDirection(kind: .down, label: "下落予想"),
        title: "英インフレ鈍化でポンドドルは上値を切り下げ",
        body: "市場予想を下回るインフレ指標が続き、利下げ観測の強まりからポンド売りを予想します。",
        likeCount: 61,
        commentCount: 8,
        isFollowing: false
    ),
    CommunityPost(
        id: "p13",
        avatarSymbol: "moon.stars.fill",
        avatarColor: Color(red: 0.45, green: 0.40, blue: 0.65),
        username: "週末だけ",
        verified: false,
        timeAgo: "18時間前",
        pair: "EUR/GBP",
        direction: CommunityPostDirection(kind: .neutral, label: "中立"),
        title: "薄商いの中、ユーロポンドは方向感に乏しい値動き",
        body: "休暇シーズンで市場参加者が少なく、目立った材料も無いため静かな展開を予想します。",
        likeCount: 29,
        commentCount: 5,
        isFollowing: false
    )
]

struct CommunityPostListCard: View {
    private static let dividerColor = Color(red: 0.35, green: 0.62, blue: 0.92).opacity(0.3)

    /// HQ指示(2026-11-22、section 5)「初回取得：10件/追加スクロール時：次の10件を取得/
    /// 読み込み中・投稿なし・エラーの状態も考慮する」への対応。ただしBackend側のページネー
    /// ションAPIがまだ無いため(ファイル冒頭の注記参照)、固定のダミー配列から段階的に見せる
    /// だけのローカルな演出にとどめる。本物のAPIページネーションに置き換える際は
    /// `PaginationMeta`(`Networking/PaginationMeta.swift`)の規約に合わせること。
    @State private var visibleCount = 5
    @State private var isLoadingMore = false

    private var posts: [CommunityPost] { communityDummyPosts }

    // ユーザー指摘(2026-11-19、4回目)「投稿カードは各カードで枠を囲むのではなく線で
    // 区切るようにしてください」: 個別のカード枠をやめ、1つの枠の中で投稿どうしを
    // 区切り線だけで並べる。
    // ユーザー指摘(2026-11-19、5回目)「FXトレーダーKとアイコンをもう少し投稿カードの
    // 上枠に近づけて」: 枠の上の余白だけ詰める(下・左右の余白は変えない)。
    // ユーザー指摘(2026-11-21)「FXトレーダーKの上の余白をなくして、今広いから」:
    // さらに詰める(0にする)。
    var body: some View {
        let visible = Array(posts.prefix(visibleCount))
        VStack(spacing: 0) {
            ForEach(Array(visible.enumerated()), id: \.element.id) { index, post in
                CommunityPostCard(post: post)
                if index < visible.count - 1 {
                    Rectangle().fill(Self.dividerColor).frame(height: 0.6)
                        .padding(.horizontal, 5)
                }
                if index == visible.count - 1 {
                    // 最後に見えている投稿が現れたタイミングで、次の10件を読み込む
                    // (スクロール読み込みのUXだけを再現する、高さの無いセンチネル)。
                    Color.clear.frame(height: 0.5)
                        .onAppear { loadMoreIfNeeded(total: posts.count) }
                        .accessibilityHidden(true)
                }
            }
            paginationFooter(total: posts.count, visible: visible.count)
        }
        .padding(.top, 3)
        .padding(.bottom, 7)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
        .accessibilityIdentifier("communityPostListCard")
    }

    private func loadMoreIfNeeded(total: Int) {
        guard visibleCount < total, !isLoadingMore else { return }
        isLoadingMore = true
        Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            visibleCount = min(visibleCount + 10, total)
            isLoadingMore = false
        }
    }

    @ViewBuilder
    private func paginationFooter(total: Int, visible: Int) -> some View {
        if isLoadingMore {
            LoadingView(caption: "読み込み中...")
                .frame(height: 36)
                .accessibilityIdentifier("communityPostListLoadingMore")
        } else if visible >= total {
            NotoText.text("すべて読み込みました", size: 6.5)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .accessibilityIdentifier("communityPostListEnd")
        }
    }

}

private struct CommunityPostCard: View {
    let post: CommunityPost
    // ユーザー指摘「ハートや保存などは押したら塗りつぶしになるようにして」:
    // タップでアウトライン⇄塗りつぶしを切り替えるダミーの状態(Backendには送らない)。
    @State private var isLiked = false
    @State private var isSaved = false
    /// HQ指示(2026-11-22、section 5)「フォロー操作」。ハート・保存と同じ、タップで
    /// ローカルに切り替わるだけのダミー状態(Backendには送らない)。
    @State private var isFollowingLocal: Bool

    init(post: CommunityPost) {
        self.post = post
        _isFollowingLocal = State(initialValue: post.isFollowing)
    }

    // ユーザー指摘(2026-11-19、3回目)「USD/JPY上昇予想はFXトレーダーの下にして、
    // アイコンに対して2行で」: その右にユーザー名+時刻(1行目)・通貨ペア+予想方向
    // (2行目)の2行をまとめる。
    // ユーザー指摘(2026-11-19、7回目)「投稿カードのアイコンの大きさを少し大きくして」:
    // アバターを20→24に。
    // ユーザー指摘(2026-11-19、13回目)「タイトル・本文が通貨ペア行ではなくアイコンと
    // 同じ左端にして/投稿カード内の四角をもう少し下に下げて」: チャート枠をHStackの
    // 子ではなくカード全体へのoverlayにして、枠の高さが他の行の位置に影響しないように
    // する。これによりタイトル・本文はアバター(アイコン)と同じ左端の、カード全体に
    // またがる別行として配置できる(通貨ペア行の下に間延びしない)。
    var body: some View {
        // HQ指示(2026-11-22、添付の参考画像どおりピクセル単位・色味を完全再現):
        // フォロー操作と「…」をヘッダー行の右端に移し、通貨ペアバッジを塗りつぶし、
        // 対象イベントのゴールドバッジを追加、チャート枠を実際の装飾チャート+
        // 「詳しく見る」ボタンに作り直した。
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 6) {
                // HQ指示(2026-11-22、section 7)「投稿をタップすると詳細画面を表示する」。
                // フォロー・「…」は個別にタップ操作を持つため、NavigationLinkの外に置く
                // (内側にネストした`onTapGesture`との競合を避ける)。
                NavigationLink(value: AppRoute.communityPostDetail(id: post.id)) {
                    HStack(alignment: .top, spacing: 6) {
                        ZStack {
                            Circle().fill(post.avatarColor)
                            Image(systemName: post.avatarSymbol).font(.system(size: 9.5)).foregroundStyle(.white.opacity(0.85))
                        }
                        .frame(width: 24, height: 24)
                        HStack(spacing: 4) {
                            NotoText.text(post.username, size: 7).foregroundStyle(.white)
                            if post.verified {
                                Image(systemName: "checkmark.seal.fill").font(.system(size: 6.5)).foregroundStyle(V5P.blue)
                            }
                            NotoText.text(post.timeAgo, size: 5.8).foregroundStyle(SettingsCardStyle.subtitleColor)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Spacer(minLength: 4)
                NotoText.text(isFollowingLocal ? "フォロー中" : "フォローする", size: 6)
                    .foregroundStyle(V5P.blue)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .overlay(Capsule().stroke(V5P.blue, lineWidth: 0.7))
                    .contentShape(Capsule())
                    .onTapGesture { isFollowingLocal.toggle() }
                Image(systemName: "ellipsis")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            .padding(.bottom, 3)

            NavigationLink(value: AppRoute.communityPostDetail(id: post.id)) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 5) {
                        NotoText.text(post.pair, size: 6)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2.5)
                            .background(Capsule().fill(CommunityPalette.solidBlue))
                        HStack(spacing: 2) {
                            if let icon = post.direction.icon {
                                Image(systemName: icon).font(.system(size: 6, weight: .bold))
                            }
                            NotoText.text(post.direction.label, size: 6)
                        }
                        .foregroundStyle(post.direction.color)
                        if let eventTag = post.eventTag {
                            NotoText.text(eventTag, size: 6)
                                .foregroundStyle(CommunityPalette.eventTagText)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2.5)
                                .background(Capsule().fill(CommunityPalette.eventTagFill))
                        }
                    }
                    .padding(.bottom, 3)

                    // ユーザー指摘(2026-11-20)「米CPIの結果と本文が右側の四角と重なっているので
                    // 折り返して」: チャート枠の幅の分だけ右の余白を確保し、枠と重ならない幅で
                    // 折り返させる。
                    // ユーザー指摘(2026-11-22、添付の参考画像との実測比較)「大きさが全然違う/
                    // 枠が全体的に余白が多すぎる」: 参考画像実測でチャート枠は84×58より
                    // ずっと小さい(約56×40)と判明。余白もそれに合わせて詰めた。
                    NotoText.text(post.title, size: 7.3)
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.trailing, 64)
                        .padding(.bottom, 1)
                    (NotoText.text(post.body, size: 6.3).foregroundColor(SettingsCardStyle.subtitleColor)
                        + Text(" もっと見る").font(.system(size: 6.3)).foregroundColor(V5P.blue))
                        .lineLimit(2)
                        .padding(.trailing, 64)
                        .padding(.bottom, 1)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            CommunityFooterActionsRow(post: post, isLiked: $isLiked, isSaved: $isSaved)
        }
        .padding(.horizontal, 5)
        .padding(.top, 5)
        .padding(.bottom, 5)
        .frame(width: 214, alignment: .leading)
        .overlay(alignment: .topTrailing) {
            VStack(spacing: 2) {
                CommunityChartIllustration(direction: post.direction.kind)
                    .frame(width: 56, height: 40)
                NavigationLink(value: AppRoute.communityPostDetail(id: post.id)) {
                    HStack(spacing: 2) {
                        NotoText.text("詳しく見る", size: 5.5).foregroundStyle(V5P.blue)
                        Image(systemName: "chevron.right").font(.system(size: 4.6, weight: .bold)).foregroundStyle(V5P.blue)
                    }
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .overlay(Capsule().stroke(V5P.blue, lineWidth: 0.7))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(.top, 20)
            .padding(.trailing, 5)
        }
        .accessibilityIdentifier("communityPostCard_\(post.id)")
    }
}

/// いいね・コメント数・保存のアイコン+数値3つ組。投稿カード・投稿詳細画面の両方で使うため
/// 共通化した(HQ指示 2026-11-22、section 7で投稿詳細画面にも同じ操作が必要になったため)。
struct CommunityFooterItem: View {
    let icon: String
    let value: String
    let color: Color
    var onTap: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: icon).font(.system(size: 7.5)).foregroundStyle(color)
            NotoText.text(value, size: 7).foregroundStyle(color)
        }
        .contentShape(Rectangle())
        .onTapGesture { onTap?() }
    }
}

/// いいね・コメント・保存の3つをまとめた行(フォロー操作は含まない — 呼び出し側の
/// レイアウトによってフォロー操作の位置・大きさが異なるため)。
struct CommunityFooterActionsRow: View {
    let post: CommunityPost
    @Binding var isLiked: Bool
    @Binding var isSaved: Bool

    var body: some View {
        HStack(spacing: 8) {
            CommunityFooterItem(
                icon: isLiked ? "heart.fill" : "heart",
                value: "\(post.likeCount + (isLiked ? 1 : 0))",
                color: isLiked ? Color(red: 0.95, green: 0.32, blue: 0.52) : SettingsCardStyle.subtitleColor
            ) { isLiked.toggle() }
            CommunityFooterItem(icon: "bubble.left", value: "\(post.commentCount)", color: SettingsCardStyle.subtitleColor)
            CommunityFooterItem(
                icon: isSaved ? "bookmark.fill" : "bookmark",
                value: "保存",
                color: isSaved ? V5P.blue : SettingsCardStyle.subtitleColor
            ) { isSaved.toggle() }
        }
    }
}

/// 投稿カード右上のチャート(HQ指示 2026-11-22、添付の参考画像を完全再現)。
///
/// 2026-11-19、5回目の指示「チャートはユーザーがチャート画面を載せるので今はデータが
/// なくていい」を受けて一度は空の枠だけにしていたが、2026-11-22に添付された参考画像
/// では実際のローソク足+移動平均線のチャートが描かれており、HQからの明示の指示で
/// これをピクセル単位・色味も含めて再現することになった。ここで描く値は実際の値動き
/// データではなく、投稿の予想方向(上昇・下落・中立)に合わせて見た目だけを変えた
/// 固定パターンの装飾(このタブの投稿自体が既にダミーであることの延長 — ファイル冒頭の
/// 注記参照。特定の価格水準やテクニカル分析結果を主張するものではない)。
/// 投稿詳細画面(`StrategyAnalysisCommunityDetail.swift`)でも同じ装飾を使うため`private`を外す。
struct CommunityChartIllustration: View {
    let direction: CommunityPostDirection.Kind

    /// 12本のローソク足の高さ(0...1、装飾用の固定値)。上昇・下落はなだらかな
    /// トレンド、中立はほぼ横ばいになるように並べた。
    private var candleHeights: [CGFloat] {
        switch direction {
        case .up: return [0.30, 0.38, 0.32, 0.46, 0.40, 0.55, 0.50, 0.64, 0.58, 0.74, 0.68, 0.86]
        case .down: return [0.86, 0.78, 0.70, 0.76, 0.60, 0.66, 0.50, 0.56, 0.40, 0.46, 0.30, 0.36]
        case .neutral: return [0.48, 0.55, 0.45, 0.52, 0.56, 0.44, 0.50, 0.57, 0.46, 0.51, 0.55, 0.47]
        }
    }
    /// 各ローソク足が陽線(緑)か陰線(赤)か。
    private var candleIsUp: [Bool] {
        switch direction {
        case .up: return [true, false, true, true, false, true, true, false, true, true, false, true]
        case .down: return [false, true, false, false, true, false, false, true, false, false, true, false]
        case .neutral: return [true, false, true, false, true, false, true, false, true, false, true, false]
        }
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let count = CGFloat(candleHeights.count)
            let slot = w / count
            ZStack(alignment: .bottomLeading) {
                Color.black.opacity(0.22)
                ForEach(Array(candleHeights.enumerated()), id: \.offset) { index, value in
                    let candleHeight = max(2, h * value * 0.82)
                    Rectangle()
                        .fill(candleIsUp[index] ? V5P.green : V5P.red)
                        .frame(width: slot * 0.5, height: candleHeight)
                        .position(x: slot * (CGFloat(index) + 0.5), y: h - candleHeight / 2)
                }
                trendLine(w: w, h: h, color: Color(red: 0.62, green: 0.42, blue: 0.95), yOffset: 0)
                trendLine(w: w, h: h, color: Color(red: 0.85, green: 0.82, blue: 0.30), yOffset: 7)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    private func trendLine(w: CGFloat, h: CGFloat, color: Color, yOffset: CGFloat) -> some View {
        let count = CGFloat(candleHeights.count)
        let slot = w / count
        return Path { path in
            for (index, value) in candleHeights.enumerated() {
                let x = slot * (CGFloat(index) + 0.5)
                let y = h - h * value * 0.82 + yOffset
                if index == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
            }
        }
        .stroke(color, lineWidth: 1)
    }
}
