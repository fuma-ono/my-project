import SwiftUI

/// Pro イベント別トレード戦略分析(HQ指示 2026-11-06、api-design v1.48)。イベント詳細(SCR-007)から開く。
/// 同じ指標の過去5回の発表の、発表後の値動きの回数を数えて出す(売買の推奨ではない)。
///
/// HQ指示(2026-11-07「画面デザインの変更」、参考画像つき): カード単位でアイコン・色分けした件数・
/// パーセンテージ・凡例(内訳)で見せる構成に変更。通貨は国旗を2つ並べて表示(ホーム画面の通貨ペア一覧
/// `HomeView.pairRow`と同じ`CountryFlagView`の並べ方、重ねない)。V5Viewport・ヘッダー・ボトムバーは
/// 他の画面と共通のまま(234×491のV5キャンバス、214ptの列)で、中身のカードだけを刷新した。
/// 高値・安値ブレイクの15分・60分それぞれの件数(HQ必須要件)は、件数の合計が発表数を超えうることを
/// 「内訳」(高値のみ・安値のみ・両方・どちらもなし)で明示する形に置き換えた(旧`breakOverlapNote`の
/// 文言は、この画面ではVoiceOver用のaccessibilityLabelとしてのみ使う)。
struct StrategyAnalysisView: View {
    @StateObject private var viewModel: StrategyAnalysisViewModel
    @Binding var tabSelection: Int
    @State private var planPrompt: String?
    @Environment(\.dismiss) private var dismiss
    private let apiClient: APIClient

    /// 「両方ブレイク」専用の色(既存のV5P.blue/green/red/cyan/yellowとは別の3色目が要るため、
    /// この画面だけで使うトークンとして追加)。
    private static let overlapPurple = Color(red: 0.62, green: 0.46, blue: 0.98)

    init(apiClient: APIClient, eventId: String, indicatorName: String, fxPairId: String?, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: StrategyAnalysisViewModel(
            apiClient: apiClient, eventId: eventId, indicatorName: indicatorName, fxPairId: fxPairId
        ))
        _tabSelection = tabSelection
    }

    var body: some View {
        V5Viewport {
            // HQ指示(2026-11-09)「タイトルは短縮案でOK」: 「イベント別トレード戦略分析」(13文字)は
            // V5Headerの戻るボタンと視覚的に重なっていた(V5Headerはback==trueのとき、タイトルを
            // 戻るボタンと別レイヤーでヘッダー全幅中央に配置するため、長いタイトルだと重なる —
            // V5Header自体(共通コンポーネント)は変更しない)。ロック表示カードの見出しと同じ
            // 「トレード戦略分析」(8文字)に短縮した。
            V5Header(title: "トレード戦略分析", back: true, onBack: { dismiss() })
            content
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await viewModel.load() }
        .planLimitPrompt($planPrompt, apiClient: apiClient, tabSelection: $tabSelection)
    }

    @ViewBuilder private var content: some View {
        switch viewModel.state {
        case .loading:
            centered { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured, .notFound, .noPair:
            centered {
                FXEmptyState(icon: "chart.xyaxis.line", title: StrategyAnalysisText.preparing, message: "比べられる過去の値動きがありません。")
            }
        case .locked:
            column { lockedCard }
        // HQ指示(2026-11-07)「403などの権限エラーを単なる通信失敗として扱わず、適切な表示にする」:
        // ロック(Proへの案内)とは別の、権限そのものの問題(ログイン切れ等)の案内。
        case .notEntitled:
            centered {
                ErrorView(
                    title: "アクセスできません",
                    message: "この機能を利用する権限がありません。ログイン状態をご確認ください。",
                    onRetry: { Task { await viewModel.load() } }
                )
            }
            .accessibilityIdentifier("strategyAnalysisNotEntitled")
        case .error(let message):
            centered { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { Task { await viewModel.load() } }) }
        case .loaded(let pair, let analysis, let coReleasedIndicators):
            column {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 7) {
                        topDisclaimerBanner
                        currencyIndicatorCard(pair: pair)
                        if !analysis.isReady {
                            V5Badge(text: "\(StrategyAnalysisText.preparing)（比べられる発表が\(analysis.minimumSamples)回未満）", color: V5P.cyan)
                                .accessibilityIdentifier("strategyAnalysisPreparing")
                        }
                        // HQ指示(2026-11-10「重複排除・集計改善・AI分析基盤の整備」STEP1):
                        // この発表が他の指標と同時発表(例: 米雇用統計のNFP・失業率・平均時給)なら明示し、
                        // 複数の指標を別々の発表として数えてしまう誤解を防ぐ。
                        if !coReleasedIndicators.isEmpty {
                            V5Badge(
                                text: "同時発表: \(coReleasedIndicators.map(\.indicatorCode).joined(separator: "・"))",
                                color: V5P.cyan
                            )
                            .accessibilityIdentifier("strategyAnalysisCoReleased")
                        }
                        breaksCard(
                            title: "過去5回の分析結果（15分以内）",
                            summary: analysis.summary.breaks15m,
                            sampleWindow: analysis.sampleWindow
                        )
                        breaksCard(
                            title: "過去5回の分析結果（60分以内）",
                            summary: analysis.summary.breaks60m,
                            sampleWindow: analysis.sampleWindow
                        )
                        directionStatsCard(analysis.summary.direction1m, sampleWindow: analysis.sampleWindow)
                        patternStatsCard(analysis.summary.pattern15m, sampleWindow: analysis.sampleWindow)
                        sellTheFactCard(analysis.summary.sellTheFact, releases: analysis.releases)
                        releasesCard(analysis)
                        notesCard
                    }
                    .padding(.bottom, 8)
                }
                .accessibilityIdentifier("strategyAnalysisContent")
            }
        }
    }

    private func column(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: 214)
            .padding(.top, 8)
            .frame(width: V5P.W, height: 398, alignment: .top)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
    }

    private func centered(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
            .padding(.top, 53)
    }

    // MARK: - 画面上部の注意書き

    private var topDisclaimerBanner: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(V5P.yellow)
            NotoText.text(StrategyAnalysisText.topDisclaimer, size: 6.5)
                .foregroundStyle(V5P.yellow)
                .lineSpacing(1)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("strategyAnalysisTopDisclaimer")
        }
        .padding(8)
        .frame(width: 214, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
                .fill(V5P.yellow.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
                        .stroke(V5P.yellow.opacity(0.45), lineWidth: 0.7)
                )
        )
    }

    // MARK: - 通貨ペア・指標名

    /// 通貨は国旗2つを隣接させて表示(HQ指示「通貨の部分はホーム画面と同じで丸国旗を2つ並べて」。
    /// `HomeView.pairRow`と同じ並べ方 — `OverlappingPairFlags`のように重ねない)。
    private func currencyIndicatorCard(pair: StrategyFxPair) -> some View {
        plainCard {
            HStack(spacing: 8) {
                VStack(spacing: 3) {
                    HStack(spacing: 2) {
                        CountryFlagView(currencyCode: String(pair.symbol.prefix(3)), diameter: 20)
                        CountryFlagView(currencyCode: String(pair.symbol.suffix(3)), diameter: 20)
                    }
                    NotoText.text(HistoricalComparisonView.pairLabel(pair.symbol), size: 7).foregroundStyle(V5P.cyan)
                }
                Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 0.5, height: 30)
                HStack(spacing: 5) {
                    Image(systemName: "calendar").font(.system(size: 10, weight: .semibold)).foregroundStyle(V5P.cyan)
                    NotoText.text(viewModel.indicatorName, size: 8.5)
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: - 高値・安値ブレイク(15分・60分それぞれ)

    /// 高値・安値・両方の3つを色分けした件数とパーセンテージで見せ、「内訳」(高値のみ・安値のみ・
    /// 両方・どちらもなし)で合計が発表数を超えうることを明示する(HQ指示 2026-11-07)。
    private func breaksCard(title: String, summary: StrategyBreakSummary?, sampleWindow: Int) -> some View {
        plainCard {
            HStack(spacing: 5) {
                Image(systemName: "chart.bar.fill").font(.system(size: 9, weight: .bold)).foregroundStyle(V5P.blue)
                NotoText.text(title, size: 7.5).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.85)
                Spacer(minLength: 4)
                analysisCountBadge(samples: summary?.samples, sampleWindow: sampleWindow)
            }
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            if let summary {
                HStack(spacing: 0) {
                    statTile(label: "高値ブレイク", count: summary.high, samples: summary.samples, color: V5P.blue)
                    statTile(label: "安値ブレイク", count: summary.low, samples: summary.samples, color: V5P.green)
                    statTile(label: "両方ブレイク", count: summary.both, samples: summary.samples, color: Self.overlapPurple)
                }
                Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.5)).frame(height: 0.5)
                NotoText.text("内訳", size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], spacing: 3) {
                    legendDot(V5P.blue, "高値のみ", summary.high - summary.both)
                    legendDot(V5P.green, "安値のみ", summary.low - summary.both)
                    legendDot(Self.overlapPurple, "両方", summary.both)
                    legendDot(SettingsCardStyle.subtitleColor, "どちらもなし", summary.neither)
                }
            } else {
                NotoText.text(StrategyAnalysisText.preparing, size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(title)。\(StrategyAnalysisText.breakLine(summary))\(StrategyAnalysisText.breakOverlapNote(summary).map { "。" + $0 } ?? "")"
        )
    }

    // MARK: - 発表直後(1分後)の傾向

    private func directionStatsCard(_ summary: StrategyDirectionSummary?, sampleWindow: Int) -> some View {
        plainCard {
            HStack(spacing: 5) {
                Image(systemName: "arrow.up.arrow.down").font(.system(size: 9, weight: .bold)).foregroundStyle(V5P.cyan)
                NotoText.text("発表直後（1分後）の傾向", size: 7.5).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.85)
                Spacer(minLength: 4)
                analysisCountBadge(samples: summary?.samples, sampleWindow: sampleWindow)
            }
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            if let summary {
                HStack(spacing: 0) {
                    statTile(label: "上昇", count: summary.up, samples: summary.samples, color: V5P.cyan)
                    statTile(label: "下落", count: summary.down, samples: summary.samples, color: V5P.red)
                    statTile(label: "横ばい", count: summary.flat, samples: summary.samples, color: SettingsCardStyle.subtitleColor)
                }
            } else {
                NotoText.text(StrategyAnalysisText.preparing, size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("発表直後（1分後）の傾向。\(StrategyAnalysisText.directionLine(summary))")
    }

    // MARK: - 15分後までの反応(続いた/反転)

    private func patternStatsCard(_ summary: StrategyPatternSummary?, sampleWindow: Int) -> some View {
        plainCard {
            HStack(spacing: 5) {
                Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 9, weight: .bold)).foregroundStyle(V5P.cyan)
                NotoText.text("15分後までの反応", size: 7.5).foregroundStyle(.white)
                Spacer(minLength: 4)
                analysisCountBadge(samples: summary?.samples, sampleWindow: sampleWindow)
            }
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            if let summary {
                HStack(spacing: 0) {
                    statTile(label: "続いた", count: summary.continuation, samples: summary.samples, color: V5P.cyan)
                    statTile(label: "反転", count: summary.reversal, samples: summary.samples, color: V5P.yellow)
                }
            } else {
                NotoText.text(StrategyAnalysisText.preparing, size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("15分後までの反応。\(StrategyAnalysisText.patternLine(summary))")
    }

    // MARK: - Sell the Fact

    private func sellTheFactCard(_ summary: StrategySellTheFactSummary?, releases: [StrategyRelease]) -> some View {
        // HQ指示(2026-11-10 STEP5): 「件数不足」と「この指標はそもそも予想値が無い」を区別する。
        let hasAnyForecast = releases.contains { $0.forecast != nil }
        return plainCard {
            HStack(spacing: 5) {
                Image(systemName: "bolt.fill").font(.system(size: 9, weight: .bold)).foregroundStyle(V5P.yellow)
                NotoText.text("Sell the Fact 分析", size: 7.5).foregroundStyle(.white)
                Spacer(minLength: 4)
                if let summary {
                    V5Badge(text: "\(summary.samples)回中", color: V5P.cyan)
                } else {
                    V5Badge(text: hasAnyForecast ? "データ不足" : "予想値なし", color: SettingsCardStyle.subtitleColor)
                }
            }
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            if let summary {
                VStack(spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        NotoText.text("\(summary.occurred)", size: 16).foregroundStyle(V5P.yellow)
                        NotoText.text("回", size: 8).foregroundStyle(V5P.yellow)
                    }
                    NotoText.text("結果が良かった\(summary.samples)回中", size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                }
                .frame(maxWidth: .infinity)
            } else {
                VStack(spacing: 4) {
                    NotoText.text("— —", size: 14).foregroundStyle(SettingsCardStyle.subtitleColor)
                    NotoText.text(
                        hasAnyForecast
                            ? "過去のデータが不足しているため分析できません"
                            : "この指標は予想値が無いため判定できません",
                        size: 6.5
                    )
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Sell the Fact分析。\(StrategyAnalysisText.sellTheFactLine(summary, releases: releases))")
    }

    // MARK: - 発表ごとの実績

    private func releasesCard(_ analysis: StrategyAnalysis) -> some View {
        plainCard {
            HStack(spacing: 5) {
                Image(systemName: "list.bullet.rectangle").font(.system(size: 9, weight: .bold)).foregroundStyle(V5P.blue)
                NotoText.text("発表ごとの実績（過去\(analysis.sampleWindow)回）", size: 7.5).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.85)
            }
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            if analysis.releases.isEmpty {
                NotoText.text("過去の発表がまだありません。", size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            ForEach(analysis.releases) { release in
                releaseRow(release)
                if release.id != analysis.releases.last?.id {
                    Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.5)).frame(height: 0.5)
                }
            }
        }
    }

    /// 1行目: 判定できたか(○/--)を示す丸・日時・予想との差。2行目: 高値・安値ブレイクの個別表示
    /// (「あり/なし/--」、HQ指示「高値ブレイク数と安値ブレイク数をそれぞれ表示」)。3行目: 反応・Sell the Fact
    /// (既存どおり保持 — 参考画像は簡略化した例のため、この画面では既存の情報を削らない)。
    private func releaseRow(_ release: StrategyRelease) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Circle()
                    .strokeBorder(release.pips1m != nil ? V5P.green : SettingsCardStyle.subtitleColor, lineWidth: 1)
                    .background(Circle().fill(release.pips1m != nil ? V5P.green : Color.clear))
                    .frame(width: 7, height: 7)
                NotoText.text(AppPreferences.shared.dateString(release.releaseDatetime), size: 7.5).foregroundStyle(.white)
                Spacer(minLength: 2)
                NotoText.text(StrategyAnalysisText.surprise(release), size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            HStack(spacing: 10) {
                breakCellLabel("高値ブレイク", release.highBreak15m)
                breakCellLabel("安値ブレイク", release.lowBreak15m)
            }
            NotoText.text(
                "反応 \(StrategyAnalysisText.pattern(release))　Sell the Fact \(StrategyAnalysisText.sellTheFact(release))",
                size: 6.5
            )
            .foregroundStyle(SettingsCardStyle.subtitleColor)
        }
        .padding(.vertical, 3)
    }

    private func breakCellLabel(_ label: String, _ value: Bool?) -> some View {
        HStack(spacing: 2) {
            NotoText.text("\(label):", size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            NotoText.text(StrategyAnalysisText.breakCell(value), size: 6.5).foregroundStyle(.white)
        }
    }

    // MARK: - 補足事項(既存の詳しい注意事項、そのまま維持)

    private var notesCard: some View {
        plainCard {
            HStack(spacing: 5) {
                Image(systemName: "lightbulb.fill").font(.system(size: 9, weight: .bold)).foregroundStyle(V5P.yellow)
                NotoText.text("補足事項", size: 7.5).foregroundStyle(.white)
            }
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            ForEach(StrategyAnalysisText.notes, id: \.self) { note in
                HStack(alignment: .top, spacing: 4) {
                    Circle().fill(SettingsCardStyle.subtitleColor).frame(width: 3, height: 3).padding(.top, 3)
                    NotoText.text(note, size: 6)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: - 共通の小さい部品

    /// 「分析可能 X回 / 対象 Y回」(件数が足りて集計できているとき)・「準備中」(足りないとき)のバッジ。
    private func analysisCountBadge(samples: Int?, sampleWindow: Int) -> some View {
        Group {
            if let samples {
                V5Badge(text: "分析可能 \(samples)回 / 対象 \(sampleWindow)回", color: V5P.cyan)
            } else {
                V5Badge(text: "準備中", color: SettingsCardStyle.subtitleColor)
            }
        }
    }

    /// 色分けした大きい件数+パーセンテージの1列(「過去5回の分析結果」「発表直後の傾向」などの列)。
    private func statTile(label: String, count: Int, samples: Int, color: Color) -> some View {
        VStack(spacing: 2) {
            NotoText.text(label, size: 6).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.8)
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                NotoText.text("\(count)", size: 15).foregroundStyle(color)
                NotoText.text("回", size: 7.5).foregroundStyle(color)
            }
            NotoText.text("(\(StrategyAnalysisText.percentOfSamples(count, samples)))", size: 5.5).foregroundStyle(color.opacity(0.85))
        }
        .frame(maxWidth: .infinity)
    }

    /// 「内訳」の凡例1行(色の丸+ラベル+件数)。
    private func legendDot(_ color: Color, _ label: String, _ count: Int) -> some View {
        HStack(spacing: 3) {
            Circle().fill(color).frame(width: 5, height: 5)
            NotoText.text("\(label) \(count)回", size: 6).foregroundStyle(.white)
        }
    }

    private var lockedCard: some View {
        Button {
            planPrompt = "トレード戦略分析はプレミアムプランの機能です。過去5回の発表の値動きの傾向(高値・安値ブレイク、反応、Sell the Fact)を確認できます。"
        } label: {
            card(title: "トレード戦略分析") {
                HStack(spacing: 6) {
                    PastReleaseLockBadge(size: 10)
                    NotoText.text("プレミアムプランで解放", size: 8).foregroundStyle(V5P.cyan)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold)).foregroundStyle(V5P.cyan)
                }
                NotoText.text("過去5回の発表の値動きの傾向を、回数で確認できます。", size: 7)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("strategyAnalysisLocked")
    }

    private func card(title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            NotoText.text(title, size: 8.5).foregroundStyle(.white)
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            content()
        }
        .padding(8)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }

    /// `card(title:)`のタイトルなし版 — 新しいカード群はタイトル行にアイコン・バッジを個別に組むため、
    /// 枠(GradientCardBackground)と余白だけを共通化する。
    private func plainCard(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            content()
        }
        .padding(9)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }
}
