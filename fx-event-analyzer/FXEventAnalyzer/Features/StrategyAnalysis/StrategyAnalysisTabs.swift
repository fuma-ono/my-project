import SwiftUI

/// HQ指示(2026-11-19「トレード戦略分析画面の作り直し」): 旧コンセプト(ピル型4タブ:
/// イベント戦略・通貨分析・価格帯分析・AI分析)を廃止し、ユーザー提示の参考画像
/// (アイコン+ラベルの4列、選択中は青色+下線、列の間に縦の区切り線)どおりの
/// イベント分析・市場分析・価格帯分析・みんなの分析の4タブに作り直す。今回はタブ自体の
/// 見た目のみを再現し、①イベント分析(旧イベント戦略)は既存の実データ表示をそのまま
/// 引き継ぐ。②③④は中身の設計がまだ無いため、架空の値を作らず「準備中」のプレースホルダー
/// にとどめる(具体的な中身は別タスクで指示される)。
enum StrategyAnalysisTab: Int, CaseIterable, Identifiable {
    case eventAnalysis
    case marketAnalysis
    case priceRangeAnalysis
    case communityAnalysis

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .eventAnalysis: return "イベント分析"
        case .marketAnalysis: return "市場分析"
        case .priceRangeAnalysis: return "価格帯分析"
        case .communityAnalysis: return "みんなの分析"
        }
    }

    /// 参考画像のアイコンに合わせたSF Symbol(2026-11-19、5回目のカード型タブ参考画像:
    /// イベント分析=折れ線+棒、市場分析=地球儀、価格帯分析=ローソク足風の縦棒、
    /// みんなの分析=2人のシルエット)。
    var icon: String {
        switch self {
        case .eventAnalysis: return "chart.line.uptrend.xyaxis"
        case .marketAnalysis: return "globe"
        case .priceRangeAnalysis: return "chart.bar.fill"
        case .communityAnalysis: return "person.2.fill"
        }
    }

    /// 価格帯分析だけ参考画像どおりアイコンが緑(ローソク足を連想させる配色)。他は白。
    var iconTint: Color {
        switch self {
        case .priceRangeAnalysis: return V5P.green
        default: return .white
        }
    }

    /// カード型タブの2行ラベル(参考画像どおり「①イベント/分析」のように番号+1行目/2行目に分割)。
    var displayFirstLine: String {
        switch self {
        case .eventAnalysis: return "①イベント"
        case .marketAnalysis: return "②市場"
        case .priceRangeAnalysis: return "③価格帯"
        case .communityAnalysis: return "④みんなの"
        }
    }

    var displaySecondLine: String { "分析" }

    /// UIテスト用の`accessibilityIdentifier`。CIで原因調査した結果、このアプリの既存の
    /// `accessibilityIdentifier`は(表示文言が日本語の画面でも)すべてASCIIのみで付けられており、
    /// 日本語の`title`をそのまま識別子に使うと、XCUITestの`matching(identifier:)`がボタンを
    /// 一度も見つけられず「タップ可能な要素が見つからない」という決定的な失敗になることが判明した
    /// (同じ構成のまま識別子だけASCIIに変えたところ再現しなくなった)。既存の慣習どおりASCIIのみにする。
    var testIdentifier: String {
        switch self {
        case .eventAnalysis: return "eventAnalysis"
        case .marketAnalysis: return "marketAnalysis"
        case .priceRangeAnalysis: return "priceRangeAnalysis"
        case .communityAnalysis: return "communityAnalysis"
        }
    }
}

/// 4タブの切り替え。ユーザー提示の参考画像(2026-11-19、5回目「タブは画像のような
/// グラデーションにして」)どおり、4枚の独立した角丸カードを並べ、選択中のカードだけ
/// 背景を上が明るい青・下が濃い紺のグラデーションにして縁取りも明るい青にする。
/// 未選択のカードは暗い塗り+薄いグレーの縁取り。既存の214pt列の中に収める
/// (V5BottomBarの全幅チャンネルとは異なり、このタブバーは他のカードと同じScrollView内
/// で一緒にスクロールする構成を維持する — ScrollViewの外に出す構成は過去のCIで高さの
/// 伝播不良によるタップ不能を起こしたため)。
struct StrategyAnalysisTabBar: View {
    @Binding var selection: StrategyAnalysisTab

    private static let cardSpacing: CGFloat = 4
    private static let cornerRadius: CGFloat = 10
    private static let unselectedFill = Color(red: 0.06, green: 0.09, blue: 0.16)
    private static let unselectedBorder = Color(red: 0.28, green: 0.33, blue: 0.44)
    private static let selectedBorder = Color(red: 0.42, green: 0.78, blue: 1.0)
    private static let selectedGradient = LinearGradient(
        gradient: Gradient(stops: [
            .init(color: Color(red: 0.30, green: 0.62, blue: 1.0), location: 0.0),
            .init(color: Color(red: 0.08, green: 0.22, blue: 0.55), location: 1.0),
        ]),
        startPoint: .top, endPoint: .bottom
    )

    var body: some View {
        HStack(spacing: Self.cardSpacing) {
            ForEach(StrategyAnalysisTab.allCases) { tab in
                tabCell(tab)
            }
        }
        .frame(width: 214)
    }

    private func tabCell(_ tab: StrategyAnalysisTab) -> some View {
        let isSelected = tab == selection
        return VStack(spacing: 4) {
            Image(systemName: tab.icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tab.iconTint)
            VStack(spacing: 0) {
                NotoText.text(tab.displayFirstLine, size: 5.8)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                NotoText.text(tab.displaySecondLine, size: 5.8)
                    .lineLimit(1)
            }
            .foregroundStyle(.white)
        }
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: Self.cornerRadius)
                .fill(isSelected ? AnyShapeStyle(Self.selectedGradient) : AnyShapeStyle(Self.unselectedFill))
        )
        .overlay(
            RoundedRectangle(cornerRadius: Self.cornerRadius)
                .stroke(isSelected ? Self.selectedBorder : Self.unselectedBorder, lineWidth: isSelected ? 1 : 0.7)
        )
        .contentShape(Rectangle())
        // V5BottomBarと同じ理由(`Button`+`.buttonStyle(.plain)`でも実機でシステム既定の
        // ハイライトカプセルが写り込んだ)で`onTapGesture`を使う。
        .onTapGesture { selection = tab }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("strategyAnalysisTab_\(tab.testIdentifier)")
    }
}

/// ②③④共通の「準備中」プレースホルダー(HQ指示 2026-11-19: タブの見た目を先に作り、
/// 各タブの中身は別途指示する)。架空の値は一切描かない。
struct StrategyAnalysisComingSoonCard: View {
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            NotoText.text(message, size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
        }
        .padding(9)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }
}

/// ヘッダー行の「PRO」表示(デザイン画像の王冠バッジ)。V5Header自体(共通コンポーネント、他の
/// 全画面で使われる)は変更せず、この画面のコンテンツ側に小さく添える。
struct StrategyAnalysisProBadge: View {
    var body: some View {
        // ユーザー指摘(2026-11-12)「PROの文字：13pt」。
        HStack(spacing: 2) {
            Image(systemName: "crown.fill").font(.system(size: 7.57, weight: .bold))
            NotoText.text("PRO", size: 7.57).fontWeight(.bold)
        }
        .foregroundStyle(.black)
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
        .background(Capsule().fill(SubscriptionPalette.gold))
    }
}

/// ②③④共通の見出しカード(参考画像の各タブ直下にある「アイコン+タイトル+サブタイトル」行)。
struct StrategySectionHeaderCard: View {
    let icon: String
    let title: String
    let subtitle: String
    var iconColor: Color = V5P.cyan

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundStyle(iconColor)
            // ユーザー指摘(2026-11-12)「イベント戦略：22pt」「...分析：13pt」。
            VStack(alignment: .leading, spacing: 1) {
                NotoText.text(title, size: 12.81).foregroundStyle(.white)
                NotoText.text(subtitle, size: 7.57).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            Spacer(minLength: 0)
        }
        .padding(9)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }
}
