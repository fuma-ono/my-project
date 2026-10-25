import Charts
import SwiftUI

/// SCR-008 相場反応詳細(HQ指示 2026-10-09の参考画像で作り直し)。上から、通貨ペアの
/// カード(国旗・USD/JPY・米ドル/円、発表60分後の価格と発表前からの変化)、
/// 1分足・5分足・15分足のローソク足チャート(発表の30分前〜60分後、発表時刻に縦線)、
/// 「値動きの分析」(数値から決まった型で作る文。AIの推測は使わない)。SCR-009への導線は
/// 指標詳細にある(HQ指示 2026-10-09「過去イベント比較の遷移元は指標詳細」)。
struct MovementDetailView: View {
    @StateObject private var viewModel: MovementDetailViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    /// チャートの足の種類(参考画像のタブ)。
    static let candleTimeframes = ["1m", "5m", "15m"]

    init(apiClient: APIClient, eventId: String, indicatorId: String, fxPairId: String, symbol: String, indicatorName: String, releaseDatetime: Date, isSpeech: Bool = false, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: MovementDetailViewModel(
            apiClient: apiClient,
            eventId: eventId,
            indicatorId: indicatorId,
            fxPairId: fxPairId,
            symbol: symbol,
            indicatorName: indicatorName,
            releaseDatetime: releaseDatetime,
            isSpeech: isSpeech,
            initialTimeframe: "1m"
        ))
        _tabSelection = tabSelection
    }

    /// HQ指示(2026-10-15)「要人発言では『発表』を『発言』に」。
    private var noun: String { viewModel.isSpeech ? "発言" : "発表" }

    var body: some View {
        content
            .toolbar(.hidden, for: .navigationBar)
            .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "値動き情報はまだ利用できません。") }
        case .notFound:
            loadingScaffold { FXEmptyState(icon: "questionmark.circle", title: "データが見つかりません", message: "指定されたイベント・通貨ペアの組み合わせが存在しません。") }
        case .notEntitled:
            loadingScaffold { FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは値動き情報を閲覧できません。") }
        case .loaded(let preReleasePrice, let reactions):
            V5Viewport {
                V5Header(title: "相場反応詳細", back: true, onBack: { dismiss() })
                ScrollView(showsIndicators: false) {
                    // HQ指示(2026-10-14、3回目)「少し上にあげることで余白が生まれるから
                    // 値動きの分析の枠の文字サイズを少し大きくできない？」: カード間の
                    // 間隔を詰めて(6→3)生まれた余白を、値動きの分析の文字サイズ拡大に
                    // 使った。
                    VStack(alignment: .leading, spacing: 3) {
                        priceCard(preReleasePrice: preReleasePrice, reactions: reactions)
                        analysisCard(reactions: reactions)
                    }
                    .frame(width: 214)
                    .padding(.vertical, 6)
                    .frame(width: V5P.W)
                }
                .frame(width: V5P.W, height: 398)
                .position(x: V5P.W / 2, y: 54 + 398 / 2)
                V5BottomBar(selected: $tabSelection)
            }
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    // MARK: - 通貨ペア・価格・チャート

    private func priceCard(preReleasePrice: Double?, reactions: [ReactionTimeframeEntry]) -> some View {
        let symbol = viewModel.symbol
        let latest = reactions.last { $0.analysisStatus == .ready && $0.postReleasePrice != nil }
        let digits = symbol.hasSuffix("JPY") ? 2 : 4
        return VStack(alignment: .leading, spacing: 5) {
            // HQ指示(2026-10-13、10回目)「先ほどまで1画面で収まってたから収めてください」:
            // 区切り線を別の子要素として追加すると外側VStackの間隔(spacing)が1つ増えて
            // 高さが余分に増えてしまうため、ヘッダー行と区切り線を1つの入れ子VStackに
            // まとめ、外側から見た子要素の数を変えないようにした。
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .top, spacing: 6) {
                    HStack(spacing: -4) {
                        CountryFlagView(currencyCode: String(symbol.prefix(3)), diameter: 20)
                        CountryFlagView(currencyCode: String(symbol.suffix(3)), diameter: 20)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        NotoText.text(FXPairSymbol.displayName(symbol), size: 11).foregroundStyle(.white)
                        NotoText.text(HomeCurrencyPairEditorViewModel.names(symbol), size: 7.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                    Spacer(minLength: 4)
                    // HQ指示(2026-10-13、8回目)「参考画像をピクセル単位で再現して」:
                    // 「発表◯分後の価格」を小さな字幕ではなく、行右上のバッジ(角丸の
                    // 縁取り)にした。
                    if let latest {
                        priceBadge(timeframe: latest.timeframe)
                    }
                }
                // HQ指示(2026-10-13、9回目)「国旗マークと154.71の間に線があるから付けて」:
                // ヘッダー行(国旗・通貨ペア名)と価格の間に区切り線を追加した。
                Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            }
            // HQ指示(2026-10-09)「価格情報を整理する」: 比較時点の小さなラベル → 価格(最も目立たせる)と
            // 変動幅・変動率を同じ行 → 変動の基準価格、の順。
            if let latest, let price = latest.postReleasePrice {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        HStack(alignment: .firstTextBaseline, spacing: 1) {
                            Text(ValueFormat.number(price, fractionDigits: digits))
                                .font(.system(size: 18, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(.white)
                            // HQ指示(2026-10-13、8回目): 参考画像どおり価格の右に単位「円」を
                            // 添えた(JPYペアのみ。それ以外は省略表記が無いため付けない)。
                            if symbol.hasSuffix("JPY") {
                                NotoText.text("円", size: 10).foregroundStyle(.white)
                            }
                        }
                        if let pre = preReleasePrice {
                            let change = price - pre
                            let percent = pre == 0 ? 0 : change / pre * 100
                            HStack(spacing: 2) {
                                // HQ指示(2026-10-13、8回目): 参考画像どおり、変動幅の前に
                                // 上昇/下落の三角マークを添えた。
                                Image(systemName: change >= 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                                    .font(.system(size: 8))
                                    .foregroundStyle(change >= 0 ? V5P.green : V5P.red)
                                Text("\(ValueFormat.number(change, fractionDigits: digits, signed: true)) (\(ValueFormat.number(percent, fractionDigits: 2, signed: true))%)")
                                    .font(.system(size: 12, weight: .semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(change >= 0 ? V5P.green : V5P.red)
                                    .lineLimit(1)
                                    .fixedSize()
                            }
                        }
                    }
                    if let pre = preReleasePrice {
                        NotoText.text("\(noun)直前 \(String(format: "%.\(digits)f", pre)) との比較", size: 6.5)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                }
            }
            timeframeTabs
            chartSection
                .frame(height: 114)
        }
        .padding(8)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }

    /// HQ指示(2026-10-13、8回目)「参考画像をピクセル単位で再現して」: ヘッダー行右上の
    /// 「発表◯分後の価格」バッジ(角丸の縁取り)。
    /// HQ指示(2026-10-13、9回目)「アイコンはいらないから消して」: 棒グラフアイコンを削除。
    /// HQ指示(2026-10-13、10回目)「発表60分後の価格の色は米ドル/円と同じ色にしてと
    /// 言った」: V5P.blueではなく、「米ドル/円」の字幕と同じSettingsCardStyle.subtitleColorに
    /// 修正。
    private func priceBadge(timeframe: String) -> some View {
        NotoText.text("\(noun)\(MovementAnalysisText.label(timeframe))後の価格", size: 6.5)
            .foregroundStyle(SettingsCardStyle.subtitleColor)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(Capsule().fill(Color.black.opacity(0.2)))
            .overlay(Capsule().stroke(SettingsCardStyle.subtitleColor.opacity(0.6), lineWidth: 0.6))
    }

    /// HQ指示(2026-10-15)「枠内の背景と1分、5分、15分のボタンのデザインを参考画像と
    /// 同じにして」: 参考画像をピクセル単位で実測(枠の塗り色≈#0E233F、縁の色は既存の
    /// `SettingsCardStyle.cardFill`/`cardBorder`と同系統、選択中タブは左から右へ
    /// 明→暗のブルーのグラデーション(左端≈#03AAFE、右端≈#276FFB)の全高ピル)。
    /// HQ指示(2026-10-15、2回目)「枠内の背景が少しグラデーションっぽい」: 選択タブ
    /// 以外の塗りも、複数行を平均した実測で左端≈RGB(15,36,67)→右端≈RGB(14,34,61)と
    /// わずかに右へ暗くなっていたため、単色から薄いグラデーションに変更した。
    /// 配置・サイズは変更していない(ボタン高さ20+余白2×2=合計24を維持、外側の
    /// `padding(2)`を無くして選択タブが枠の端まで隙間なく届くようにした)。
    private var timeframeTabs: some View {
        HStack(spacing: 0) {
            ForEach(Array(Self.candleTimeframes.enumerated()), id: \.element) { index, timeframe in
                let isSelected = viewModel.selectedTimeframe == timeframe
                Button { viewModel.selectedTimeframe = timeframe } label: {
                    NotoText.text(MovementAnalysisText.label(timeframe), size: 8.5)
                        .foregroundStyle(isSelected ? .white : SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity)
                        .frame(height: 24)
                        .background {
                            if isSelected {
                                Capsule().fill(Self.timeframeSelectedGradient)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])

                if index < Self.candleTimeframes.count - 1 {
                    let nextSelected = viewModel.selectedTimeframe == Self.candleTimeframes[index + 1]
                    if !isSelected && !nextSelected {
                        Rectangle().fill(Color.black.opacity(0.35)).frame(width: 0.6, height: 14)
                    }
                }
            }
        }
        .background(Capsule().fill(Self.timeframeContainerGradient))
        .overlay(Capsule().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    private static let timeframeSelectedGradient = LinearGradient(
        colors: [Color(red: 3 / 255, green: 170 / 255, blue: 254 / 255), Color(red: 39 / 255, green: 111 / 255, blue: 251 / 255)],
        startPoint: .leading,
        endPoint: .trailing
    )

    private static let timeframeContainerGradient = LinearGradient(
        colors: [Color(red: 15 / 255, green: 36 / 255, blue: 67 / 255), Color(red: 14 / 255, green: 34 / 255, blue: 61 / 255)],
        startPoint: .leading,
        endPoint: .trailing
    )

    @ViewBuilder
    private var chartSection: some View {
        switch viewModel.chartState {
        case .loading:
            LoadingView(caption: "データ取得中...")
        case .empty:
            // HQ指示(2026-10-09): データが無いときは架空の足を出さず「データなし」。
            FXEmptyState(icon: "chart.xyaxis.line", title: "データなし", message: "この時間足の価格データはまだありません。")
        case .error(let message):
            ErrorView(title: "チャート取得に失敗しました", message: message, onRetry: { viewModel.retryChart() })
        case .loaded(let chart):
            // 上の「発表 16:58」のラベルがタブに重ならないよう、少し間を空ける。
            CandleChart(
                chart: chart,
                digits: viewModel.symbol.hasSuffix("JPY") ? 2 : 4,
                timeframe: viewModel.selectedTimeframe,
                preReleasePrice: viewModel.preReleasePrice,
                pipSize: viewModel.symbol.hasSuffix("JPY") ? 0.01 : 0.0001,
                noun: noun
            )
                .padding(.top, 9)
        }
    }

    // MARK: - 値動きの分析

    @ViewBuilder
    private func analysisCard(reactions: [ReactionTimeframeEntry]) -> some View {
        let result = viewModel.eventSnapshot
        if let summary = MovementAnalysisText.summary(
            reactions: reactions, actual: result?.actual, forecast: result?.forecast, unit: result?.unit,
            marketViewAbove: viewModel.indicator?.marketViewAbove, marketViewBelow: viewModel.indicator?.marketViewBelow
        ) {
            // HQ指示(2026-10-09)「要点を分けて表示」「値動きの事実と相場の解釈は分ける」。
            // HQ指示(2026-10-14)「値動きの分析の構成を画像のようにして」: 事実(発表結果・
            // 初動・15分後)と「主な要因」(旧「解説」)を2列に並べ、その下に「過去の
            // 類似イベントとの比較」を追加。画像にあった「AI分析」バッジはこのアプリの
            // 「AIは使わず数値から決まった型で作る」方針(要件定義書12章)と矛盾するため、
            // HQ確認のうえ付けていない。
            // HQ指示(2026-10-14、2回目)「予想を...下回るは1行で収まるように」「きちんと
            // 参考画像をピクセル単位で見て」: 「発表結果」の値だけ下の行に値(1行)を置き、
            // 「初動」「15分後」はラベルと値を同じ行(ラベル左・値右)に並べる構成。
            // HQ指示(2026-10-14、4回目)「値動きの原因を断定するものではないの位置が
            // おかしくない？」: 2列の下に全幅で置いていたため「主な要因」との対応が
            // 分かりにくかった。「解説」ボックスの一部だった元の構成どおり、「主な要因」
            // の枠の中(本文の下)に戻した。
            // HQ指示(2026-10-14、7回目)「値動きの原因を断定するものではないは無くしていい。
            // その空いた分サイズをベストな調整して」: 免責文を削除して空いた「主な要因」
            // 枠の高さぶん、文字サイズを引き上げた。「今回の変動」の行は5回目の
            // オーバーフロー回帰の直接の原因だったため、comparisonSectionの数値2行
            // (平均変動・今回の変動の値とバッジ)はサイズを据え置き、安全マージンを確保。
            VStack(alignment: .leading, spacing: 4) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 4) {
                        Image(systemName: "chart.bar.fill")
                            .font(.system(size: 9.5, weight: .bold))
                            .foregroundStyle(V5P.cyan)
                        NotoText.text("値動きの分析", size: 11).foregroundStyle(.white)
                    }
                    Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
                }
                HStack(alignment: .top, spacing: 6) {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(summary.facts, id: \.label) { row in
                            if row.sign == nil {
                                VStack(alignment: .leading, spacing: 1) {
                                    NotoText.text(row.label, size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                                    NotoText.text(row.value, size: 7.5)
                                        .foregroundStyle(.white)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.7)
                                }
                            } else {
                                HStack(spacing: 2) {
                                    NotoText.text(row.label, size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                                    Spacer(minLength: 2)
                                    NotoText.text(row.value, size: 8)
                                        .foregroundStyle(row.sign! >= 0 ? V5P.green : V5P.red)
                                        .lineLimit(1)
                                        .fixedSize()
                                }
                            }
                        }
                    }
                    .frame(width: 96, alignment: .leading)
                    if let interpretation = summary.interpretation {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 2) {
                                Image(systemName: "person.fill")
                                    .font(.system(size: 7))
                                    .foregroundStyle(V5P.cyan)
                                NotoText.text("主な要因", size: 7).foregroundStyle(V5P.cyan)
                            }
                            NotoText.text(interpretation, size: 6.5)
                                .foregroundStyle(.white.opacity(0.85))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 5).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.6))
                    }
                }
                comparisonSection(reactions: reactions)
            }
            .padding(8)
            .frame(width: 214, alignment: .leading)
            .background(GradientCardBackground())
        } else {
            // HQ指示(2026-10-24)「相場反応詳細で分析の解説が表示されていない」:
            // 以前はsummaryがnilのとき(1分・5分いずれもanalysisStatus==.ready
            // の値動きが無い)、@ViewBuilderが暗黙にEmptyViewを返すため、
            // 「値動きの分析」の枠自体が消えていた。データが無い状態と取得
            // 失敗を分けて表示し、枠自体は常に出す。
            analysisUnavailableCard(reactions: reactions)
        }
    }

    /// `analysisCard`がsummaryを作れないときの代わりの表示。1分→5分の順で
    /// 見つかった`analysisStatus`から理由を出し分ける(`MovementAnalysisText.
    /// summary`の`ready(_:)`と同じ優先順位)。どちらも無ければ「取得中」扱い。
    private func analysisUnavailableCard(reactions: [ReactionTimeframeEntry]) -> some View {
        let status = reactions.first(where: { $0.timeframe == "1m" })?.analysisStatus
            ?? reactions.first(where: { $0.timeframe == "5m" })?.analysisStatus
        let message: String
        switch status {
        case .dataUnavailable:
            message = "値動きのデータが取得できなかったため、分析を表示できません。"
        case .notAnalyzable:
            message = "この発表は値動きの分析の対象外です。"
        case .ready, .dataPending, nil:
            message = "値動きのデータを取得中です。しばらくしてから確認してください。"
        }
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Image(systemName: "chart.bar.fill")
                    .font(.system(size: 9.5, weight: .bold))
                    .foregroundStyle(V5P.cyan)
                NotoText.text("値動きの分析", size: 11).foregroundStyle(.white)
            }
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            NotoText.text(message, size: 7.5)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        }
        .padding(8)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }

    /// HQ指示(2026-10-14)「値動きの分析の構成を画像のようにして」「過去イベントを見るで
    /// 過去イベント比較に動線を作成して」: 過去イベント比較(SCR-009)と同じBackend集計
    /// (`comparisonStats`)から、今回の15分後pipsと過去の平均pipsを並べる。平均が
    /// 取れていない(取得失敗・分析可能な過去イベントが無い)ときはこの区画ごと出さない。
    @ViewBuilder
    private func comparisonSection(reactions: [ReactionTimeframeEntry]) -> some View {
        if let average = viewModel.comparisonStats?.averagePips,
           let count = viewModel.comparisonAnalyzableEvents, count > 0,
           let current = reactions.first(where: { $0.timeframe == "15m" && $0.analysisStatus == .ready })?.pips {
            // HQ指示(2026-10-14、7回目)「免責文を無くした空きぶん文字サイズをベストな
            // 調整」: このセクションの見出し行は引き上げたが、5回目のオーバーフロー
            // 回帰の直接の原因だった下の数値2行(平均変動・今回の変動)はサイズ据え置き。
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 3) {
                    Image(systemName: "lightbulb.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(V5P.cyan)
                    NotoText.text("過去の類似イベントとの比較", size: 7.5)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    Spacer(minLength: 4)
                    NavigationLink(value: AppRoute.historicalComparison(
                        indicatorId: viewModel.indicatorId,
                        indicatorName: viewModel.indicatorName,
                        fxPairId: viewModel.fxPairId,
                        fxPairSymbol: viewModel.symbol
                    )) {
                        HStack(spacing: 1) {
                            NotoText.text("過去イベントを見る", size: 6.5).foregroundStyle(V5P.cyan)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 6, weight: .semibold))
                                .foregroundStyle(V5P.cyan)
                        }
                        .lineLimit(1)
                        .fixedSize()
                    }
                }
                Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
                // HQ指示(2026-10-14、6回目)「+18.7pipsの位置が間違ってる。-41.3pipsと
                // 同じ高さの位置に揃えて」: 「今回の変動」の行は値の後ろに「大きい」等の
                // バッジが続くぶん、値の右端が「平均変動」の行より左に来ていた。両方の
                // 行で値の右端が揃うよう、バッジが無い行にも同じ幅の透明プレースホルダーを
                // 置いて右端の位置を合わせた。
                HStack {
                    NotoText.text("過去\(count)回の平均変動（15分後）", size: 6.5)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    Spacer(minLength: 4)
                    NotoText.text(Self.signedPipsText(average), size: 7.5)
                        .foregroundStyle(average >= 0 ? V5P.green : V5P.red)
                        .lineLimit(1)
                        .fixedSize()
                    Color.clear.frame(width: Self.magnitudeBadgeWidth, height: 1)
                }
                HStack {
                    NotoText.text("今回の変動", size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                    Spacer(minLength: 4)
                    NotoText.text(Self.signedPipsText(current), size: 7.5)
                        .foregroundStyle(current >= 0 ? V5P.green : V5P.red)
                        .lineLimit(1)
                        .fixedSize()
                    if let magnitude = MovementAnalysisText.magnitudeLabel(current: current, average: average) {
                        NotoText.text(magnitude, size: 6)
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .frame(width: Self.magnitudeBadgeWidth)
                            .background(Capsule().fill(Color.black.opacity(0.2)))
                            .overlay(Capsule().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.6))
                    }
                }
            }
        }
    }

    private static func signedPipsText(_ value: Double) -> String {
        "\(ValueFormat.number(value, fractionDigits: 1, signed: true)) pips"
    }

    /// 「今回の変動」の「大きい」等バッジの固定幅。最長の「やや大きい/やや小さい」
    /// (5文字)でも収まる幅にし、バッジの無い「平均変動」の行にも同じ幅の透明
    /// プレースホルダーを置いて、pips値の右端を2行で揃える。
    private static let magnitudeBadgeWidth: CGFloat = 44

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: @escaping () -> some View) -> some View {
        V5Viewport {
            V5Header(title: "相場反応詳細", back: true, onBack: { dismiss() })
            content()
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            V5BottomBar(selected: $tabSelection)
        }
    }
}

/// ローソク足(上昇は緑、下落は赤)と、発表時刻の縦線。価格は右側、時刻は下に出す。
private struct CandleChart: View {
    let chart: ChartResponse
    let digits: Int
    let timeframe: String
    /// 発表直前の価格。基準線を引き、最後の足に「発表時点からの変動幅(pips)」を出す。
    let preReleasePrice: Double?
    let pipSize: Double
    /// 「発表」か「発言」(要人発言の相場反応詳細、HQ指示 2026-10-15)。
    var noun: String = "発表"

    /// HQ指示(2026-10-09)の表示範囲: 発表時刻を基準に、1分足は前後15分(初動)、5分足は
    /// 前後60分(短期の流れ)、15分足は前後3時間(全体の流れ)。Backendの`window_from`/`window_to`
    /// を使い、無い古いBackendだけ同じ規則で計算する。データが無い部分に足は補わない。
    private var window: (from: Date, to: Date) {
        if let from = chart.windowFrom, let to = chart.windowTo { return (from, to) }
        let release = chart.releaseDatetime
        let minutes: Double = timeframe == "1m" ? 15 : timeframe == "5m" ? 60 : 180
        return (release.addingTimeInterval(-minutes * 60), release.addingTimeInterval(minutes * 60))
    }

    /// 足1本の秒数。端の足が枠にかからないよう、表示範囲の左右をこの分だけ広げる。
    private var stepSeconds: TimeInterval {
        switch timeframe {
        case "1m": return 60
        case "5m": return 300
        default: return 900
        }
    }

    /// 時刻の目盛りの間隔。1分足は5分、5分足は20分、15分足は1時間ごと(重ならない数にする)。
    private var labelMinutes: Int {
        switch timeframe {
        case "1m": return 5
        case "5m": return 20
        default: return 60
        }
    }

    /// 時刻の目盛り。表示範囲の始まりからではなく、5分・15分・30分ちょうどの時刻
    /// (05:40、05:45…)に置く。
    private var axisDates: [Date] {
        let step = TimeInterval(labelMinutes * 60)
        var date = Date(timeIntervalSince1970: (window.from.timeIntervalSince1970 / step).rounded(.up) * step)
        var dates: [Date] = []
        // 右端に近すぎる目盛りは文字が切れる(「06:…」)ので出さない。
        while date <= window.to.addingTimeInterval(-step / 2) {
            dates.append(date)
            date = date.addingTimeInterval(step)
        }
        return dates
    }

    private var points: [ChartPricePoint] {
        chart.prices.filter { $0.timestamp >= window.from && $0.timestamp <= window.to }
    }


    var body: some View {
        let points = points
        let lows = points.map(\.low)
        let highs = points.map(\.high)
        let minY = lows.min() ?? 0
        let maxY = highs.max() ?? 1
        let pad = max((maxY - minY) * 0.08, 0.0001)
        let width = candleWidth
        Chart {
            // HQ指示(2026-10-15)「点線で十分だから不要」: 発表後の背景をうっすら塗る
            // 区切り(2026-10-14、2回目に追加)は、発表時点の縦の点線だけで十分として削除。
            // HQ指示(2026-10-09)「縦の点線を、発表や発表時刻と分かるように」。
            RuleMark(x: .value("発表", chart.releaseDatetime))
                .foregroundStyle(V5P.cyan.opacity(0.8))
                .lineStyle(StrokeStyle(lineWidth: 0.8, dash: [3, 2]))
                .annotation(position: .top, alignment: .center, spacing: 1) {
                    // HQ指示(2026-10-13、8回目)「参考画像をピクセル単位で再現して」:
                    // 「発表」ラベルの前に上向き三角マークを添えた。三角を足したことで
                    // 註釈の幅がチャート領域からはみ出し「発表 11:...」と省略される
                    // 回帰が起きたため、`.fixedSize()`で内容どおりの幅を強制した。
                    HStack(spacing: 2) {
                        Image(systemName: "arrowtriangle.up.fill")
                            .font(.system(size: 5))
                            .foregroundStyle(.white)
                        Text("\(noun) \(AppPreferences.shared.timeString(chart.releaseDatetime))")
                            .font(.system(size: 6, weight: .semibold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    .padding(.horizontal, 3)
                    .padding(.vertical, 1)
                    .background(V5P.cyan.opacity(0.35), in: Capsule())
                    .fixedSize()
                }
            // HQ指示(2026-10-09)「発表時点からの変動幅(pips)を確認しやすく」: 発表直前の価格に基準線。
            if let pre = preReleasePrice {
                RuleMark(y: .value("発表直前", pre))
                    .foregroundStyle(Color.white.opacity(0.45))
                    .lineStyle(StrokeStyle(lineWidth: 0.6, dash: [2, 2]))
            }
            ForEach(points) { point in
                let color = point.close >= point.open ? V5P.green : V5P.red
                RuleMark(
                    x: .value("時刻", point.timestamp),
                    yStart: .value("安値", point.low),
                    yEnd: .value("高値", point.high)
                )
                .lineStyle(StrokeStyle(lineWidth: 0.7))
                .foregroundStyle(color)
                RectangleMark(
                    x: .value("時刻", point.timestamp),
                    yStart: .value("始値", min(point.open, point.close)),
                    yEnd: .value("終値", max(point.open, point.close) + (point.open == point.close ? pad * 0.05 : 0)),
                    width: .fixed(width)
                )
                .foregroundStyle(color)
            }
            if let pre = preReleasePrice, let last = points.last {
                PointMark(x: .value("時刻", last.timestamp), y: .value("終値", last.close))
                    .symbolSize(10)
                    .foregroundStyle(.white)
            }
        }
        .chartYScale(domain: (minY - pad)...(maxY + pad))
        .chartXScale(domain: window.from.addingTimeInterval(-stepSeconds)...window.to.addingTimeInterval(stepSeconds))
        // HQ指示(2026-10-09)「数字ではなくローソク足の部分を枠で囲んで」: 目盛りの数字・時刻の
        // 外側ではなく、描画領域だけに角のない枠を付ける。
        .chartPlotStyle { plot in
            plot
                .background(Color.black.opacity(0.18))
                .overlay(Rectangle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.8))
        }
        // HQ指示(2026-10-14、2回目)「pipsの表示位置を改善する」: 最後の足に付けた註釈
        // (`PointMark`の`.annotation`)だとローソク足の位置によって重なってしまうため、
        // プロット領域右上に固定したバッジに変更した。1分/5分/15分を切り替えると
        // `points`(表示範囲)ごと変わるので、選んだ時間足に対応する変動幅がそのまま
        // 表示される。
        .chartOverlay { proxy in
            GeometryReader { geo in
                if let plotFrame = proxy.plotFrame, let pre = preReleasePrice, let last = points.last {
                    let frame = geo[plotFrame]
                    let pips = (last.close - pre) / pipSize
                    Text("\(ValueFormat.number(pips, fractionDigits: 1, signed: true)) pips")
                        .font(.system(size: 6.5, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .background(Capsule().fill((pips >= 0 ? V5P.green : V5P.red).opacity(0.9)))
                        .position(x: frame.maxX - 28, y: frame.minY + 9)
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { value in
                // HQ指示(2026-10-09)「縦線横線がしっかり見えるように」。
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.6)).foregroundStyle(SettingsCardStyle.cardBorder.opacity(0.9))
                AxisValueLabel {
                    if let price = value.as(Double.self) {
                        // 「155」ではなく「155.00」のように小数点以下の桁をそろえる。
                        Text(String(format: "%.\(digits)f", price))
                            .font(.system(size: 6))
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: axisDates) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.6)).foregroundStyle(SettingsCardStyle.cardBorder.opacity(0.9))
                // 文字の中心を縦線に合わせる(既定では線の右に寄ってずれて見えた)。
                AxisValueLabel(centered: false, anchor: .top) {
                    if let date = value.as(Date.self) {
                        // イベント詳細の発表日時と同じく、アプリの設定の時間帯(SCR-018)で出す。
                        // 端末の時間帯で出していたため、発表14:07なのに05:55〜と出ていた。
                        Text(AppPreferences.shared.timeString(date))
                            .font(.system(size: 6))
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                }
            }
        }
        .accessibilityLabel("ローソク足チャート")
    }

    /// 本数に合わせた足の幅。描画領域(約160)を本数+2で割った6割で、すき間を詰める。
    private var candleWidth: CGFloat {
        let count = max(points.count, 1) + 2
        return max(1.5, min(9, 160 / CGFloat(count) * 0.6))
    }
}
