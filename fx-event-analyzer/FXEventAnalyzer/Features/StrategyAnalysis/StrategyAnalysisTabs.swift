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

    /// 参考画像のアイコンに合わせたSF Symbol(市場分析=高さの異なる3本の棒グラフ、
    /// 価格帯分析=3本の縦スライダー、みんなの分析=2人のシルエット)。
    var icon: String {
        switch self {
        case .eventAnalysis: return "chart.line.uptrend.xyaxis"
        case .marketAnalysis: return "chart.bar.fill"
        case .priceRangeAnalysis: return "slider.vertical.3"
        case .communityAnalysis: return "person.2.fill"
        }
    }

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

/// 4タブの切り替え(ユーザー提示の参考画像どおり: アイコン+ラベルの等幅4列、列の間に
/// 縦の区切り線、タブ行全体の上下に1本ずつの横線。選択中の列はアイコン・ラベルが
/// 青(`V5P.blue`)になり、列全体を青い四角(角丸の枠線)で囲う(ユーザー指摘
/// 2026-11-19「タブの下に1本の線を引いてほしい/タブを選択すると四角で囲うように
/// してほしい」: 下線インジケーターから、下端の1本線+選択中セルの枠線囲みに変更)。
/// 既存の214pt列の中に収める(V5BottomBarの全幅チャンネルとは異なり、このタブバーは
/// 他のカードと同じScrollView内で一緒にスクロールする構成を維持する — ScrollViewの
/// 外に出す構成は過去のCIで高さの伝播不良によるタップ不能を起こしたため)。
struct StrategyAnalysisTabBar: View {
    @Binding var selection: StrategyAnalysisTab

    private static let selectedColor = V5P.blue
    /// V5BottomBarの非選択色(淡いラベンダー寄りの水色)をこのタブバーにも流用し、
    /// アプリ全体のナビゲーション要素の配色を揃える。
    private static let unselectedColor = Color(red: 128.0 / 255, green: 174.0 / 255, blue: 228.0 / 255)
    private static let dividerColor = Color(red: 0.35, green: 0.62, blue: 0.92).opacity(0.3)

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Self.dividerColor).frame(height: 0.6)
            HStack(spacing: 0) {
                ForEach(Array(StrategyAnalysisTab.allCases.enumerated()), id: \.element) { index, tab in
                    tabCell(tab)
                    if index < StrategyAnalysisTab.allCases.count - 1 {
                        Rectangle().fill(Self.dividerColor).frame(width: 0.6, height: 24)
                    }
                }
            }
            // ユーザー指摘(2026-11-19)「タブの下に1本の線を引いてほしい」: タブ行の
            // 下端にも上端と同じ横線を1本引く。
            Rectangle().fill(Self.dividerColor).frame(height: 0.6)
        }
        .frame(width: 214)
    }

    private func tabCell(_ tab: StrategyAnalysisTab) -> some View {
        let isSelected = tab == selection
        let color = isSelected ? Self.selectedColor : Self.unselectedColor
        return VStack(spacing: 3) {
            Image(systemName: tab.icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(color)
            NotoText.text(tab.title, size: 6.3)
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 2)
        .padding(.horizontal, 2)
        // ユーザー指摘(2026-11-19)「タブを選択すると四角で囲うようにしてほしい」:
        // 下線インジケーターの代わりに、選択中のセル全体を角丸の青い枠線で囲む。
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(isSelected ? Self.selectedColor : .clear, lineWidth: 1)
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
