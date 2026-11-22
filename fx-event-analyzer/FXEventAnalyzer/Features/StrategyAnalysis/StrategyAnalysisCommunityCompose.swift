import SwiftUI

/// 投稿作成の「＋」ボタンと、そこから開く2つの入力フロー(HQ指示 2026-11-22
/// 「Claude Codeへの実装指示：みんなの分析画面」section 6)。
///
/// コミュニティ機能のBackend/APIがまだ存在しないため(`StrategyAnalysisCommunity.swift`
/// 冒頭の注記と同じ)、入力→確認画面までは一通り操作できるが、確認画面の「投稿する」
/// ボタンは無効化し、その理由を明記する(HQ指示 section 10「実装していない機能を動作
/// するように見せない」)。送信できる体裁を取り繕わない。

/// みんなの分析タブ右下の「＋」フローティングボタン。
struct CommunityComposeFAB: View {
    /// `V5BottomBar.barHeight`(39、private)をこの位置計算のためだけに複製している
    /// (`StrategyAnalysisView`側の`headerCenterY`複製と同じ理由・同じ手法)。
    private static let bottomBarHeight: CGFloat = 39
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(
                    Circle().fill(
                        LinearGradient(
                            colors: [V5P.blue, Color(red: 0.62, green: 0.42, blue: 0.95)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
                )
                // `.shadow()`はV5Viewportの`.scaleEffect`配下では描画されないことが既に
                // 判明している(`StrategyAnalysisCommunity.swift`より前のラウンドで確認済み)
                // ため、縁取りだけで浮遊感を出す。
                .overlay(Circle().stroke(Color.white.opacity(0.2), lineWidth: 0.7))
        }
        .buttonStyle(.plain)
        .position(x: V5P.W - 24, y: V5P.H - Self.bottomBarHeight - 24)
        .accessibilityLabel("投稿を作成")
        .accessibilityIdentifier("communityComposeFAB")
    }
}

/// 入力→確認の2ステップ共通。
enum CommunityComposeStep { case input, confirm }

/// Backend未対応であることの注意書きカード。入力フロー2つで共通。
private struct CommunityComposeNotReadyNotice: View {
    let detail: String

    var body: some View {
        AccountInfoCard(
            icon: "wrench.and.screwdriver.fill",
            title: "まだ投稿できません",
            text: detail,
            tint: V5P.yellow
        )
    }
}

private func communitySummaryRow(label: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
        NotoText.text(label, size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
        NotoText.text(value, size: 7.5).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
    }
    .frame(width: 214, alignment: .leading)
}

private func communityTextFieldRow(_ text: Binding<String>, placeholder: String) -> some View {
    TextField("", text: text, prompt: Text(placeholder).foregroundStyle(V5P.muted.opacity(0.8)))
        .font(.system(size: 9))
        .foregroundStyle(.white)
        .tint(V5P.cyan)
        .padding(.horizontal, 10)
        .frame(height: SettingsListLayout.rowHeight)
}

// MARK: - 選択肢A: 分析を投稿

/// 「分析を投稿」フォーム(HQ指示section 6「選択肢A」の入力項目どおり)。
struct CommunityPostComposeView: View {
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss
    @State private var step: CommunityComposeStep = .input
    @State private var pair = "USD/JPY"
    @State private var direction: CommunityPostDirection.Kind = .up
    @State private var title = ""
    @State private var analysisBody = ""
    @State private var highlightedPriceLevel = ""
    @State private var eventName = ""
    @State private var showsPairSheet = false
    @State private var showsDirectionSheet = false

    private static let pairOptions = ["USD/JPY", "EUR/USD", "GBP/USD", "AUD/USD", "EUR/JPY", "GBP/JPY", "USD/CHF", "NZD/USD", "USD/CAD"]

    private var canProceed: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !analysisBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        V5Viewport {
            V5Header(title: "分析を投稿", back: true, onBack: { dismiss() })
            ScrollView(showsIndicators: false) {
                VStack(spacing: 10) {
                    switch step {
                    case .input: inputForm
                    case .confirm: confirmView
                    }
                }
                .padding(.top, 6)
                .padding(.bottom, 10)
                .frame(width: V5P.W)
            }
            .frame(width: V5P.W, height: 398)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showsPairSheet) { pairSheet }
        .sheet(isPresented: $showsDirectionSheet) { directionSheet }
    }

    @ViewBuilder private var inputForm: some View {
        SettingsListSection(title: "通貨ペア") {
            SettingsListValueRow(title: "通貨ペア", value: pair) { showsPairSheet = true }
        }
        SettingsListSection(title: "予想方向") {
            SettingsListValueRow(title: "予想方向", value: Self.directionLabel(direction)) { showsDirectionSheet = true }
        }
        SettingsListSection(title: "分析タイトル") {
            communityTextFieldRow($title, placeholder: "例: 米CPIの結果を受けて...")
        }
        SettingsListSection(title: "分析内容・根拠") { bodyEditor }
        SettingsListSection(title: "注目価格帯(任意)") {
            communityTextFieldRow($highlightedPriceLevel, placeholder: "例: 150.00円が目先のレジスタンス")
        }
        SettingsListSection(title: "対象イベント(任意)") {
            communityTextFieldRow($eventName, placeholder: "例: 米雇用統計")
        }
        SettingsListSection(title: "チャート画像(任意)") { attachPlaceholder }
        AccountPrimaryButton(title: "確認する", isEnabled: canProceed) { step = .confirm }
    }

    private var bodyEditor: some View {
        ZStack(alignment: .topLeading) {
            if analysisBody.isEmpty {
                NotoText.text("根拠となるデータや考え方を記入してください。", size: 8.5)
                    .foregroundStyle(V5P.muted.opacity(0.8))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 8)
                    .allowsHitTesting(false)
            }
            TextEditor(text: $analysisBody)
                .font(.system(size: 9))
                .foregroundStyle(.white)
                .tint(V5P.cyan)
                .scrollContentBackground(.hidden)
                .accessibilityLabel("分析内容・根拠")
        }
        .padding(6)
        .frame(height: 100)
    }

    /// 画像添付はBackend側のアップロード先(ストレージ)が無いと保存できないため、
    /// 実際に選べる体裁にはせず、無効な見た目のプレースホルダーにとどめる
    /// (HQ指示 section 10「実装していない機能を動作するように見せない」)。
    private var attachPlaceholder: some View {
        HStack(spacing: 6) {
            Image(systemName: "camera.on.rectangle").font(.system(size: 13)).foregroundStyle(SettingsCardStyle.subtitleColor)
            NotoText.text("Backend対応後に利用できます", size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .frame(height: SettingsListLayout.rowHeight)
        .opacity(0.6)
        .accessibilityIdentifier("communityPostComposeAttachPlaceholder")
    }

    private var pairSheet: some View {
        SettingsListOptionSheet(title: "通貨ペア", footer: nil) {
            ForEach(Self.pairOptions, id: \.self) { option in
                SettingsListOptionRow(label: option, isSelected: pair == option) {
                    pair = option
                    showsPairSheet = false
                }
            }
        }
    }

    private var directionSheet: some View {
        SettingsListOptionSheet(title: "予想方向", footer: nil) {
            ForEach([CommunityPostDirection.Kind.up, .down, .neutral], id: \.self) { kind in
                SettingsListOptionRow(label: Self.directionLabel(kind), isSelected: direction == kind) {
                    direction = kind
                    showsDirectionSheet = false
                }
            }
        }
    }

    private static func directionLabel(_ kind: CommunityPostDirection.Kind) -> String {
        switch kind {
        case .up: return "上昇予想"
        case .down: return "下落予想"
        case .neutral: return "中立"
        }
    }

    @ViewBuilder private var confirmView: some View {
        VStack(alignment: .leading, spacing: 8) {
            NotoText.text("入力内容の確認", size: 9).foregroundStyle(.white)
            communitySummaryRow(label: "通貨ペア", value: pair)
            communitySummaryRow(label: "予想方向", value: Self.directionLabel(direction))
            communitySummaryRow(label: "分析タイトル", value: title)
            communitySummaryRow(label: "分析内容・根拠", value: analysisBody)
            if !highlightedPriceLevel.isEmpty { communitySummaryRow(label: "注目価格帯", value: highlightedPriceLevel) }
            if !eventName.isEmpty { communitySummaryRow(label: "対象イベント", value: eventName) }
        }
        .padding(9)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
        .accessibilityIdentifier("communityPostComposeConfirm")

        CommunityComposeNotReadyNotice(
            detail: "投稿を保存・公開するBackend/APIが未対応のため、この画面は入力の流れだけを確認する仮実装です。実際の投稿は行われません。"
        )
        AccountPrimaryButton(title: "投稿する", isEnabled: false) {}
            .accessibilityIdentifier("communityPostComposeSubmitDisabled")
        AccountSecondaryButton(title: "編集に戻る") { step = .input }
    }
}

// MARK: - 選択肢B: 予想アンケートを作成

/// 「予想アンケートを作成」フォーム(HQ指示section 6「選択肢B」の入力項目どおり)。
struct CommunityPollComposeView: View {
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss
    @State private var step: CommunityComposeStep = .input
    @State private var question = ""
    @State private var options: [String] = ["", ""]
    @State private var pair = ""
    @State private var eventName = ""
    @State private var deadline = Date().addingTimeInterval(86400 * 3)

    private var filledOptions: [String] {
        options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    private var canProceed: Bool {
        !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && filledOptions.count >= 2
    }

    var body: some View {
        V5Viewport {
            V5Header(title: "予想アンケートを作成", back: true, onBack: { dismiss() })
            ScrollView(showsIndicators: false) {
                VStack(spacing: 10) {
                    switch step {
                    case .input: inputForm
                    case .confirm: confirmView
                    }
                }
                .padding(.top, 6)
                .padding(.bottom, 10)
                .frame(width: V5P.W)
            }
            .frame(width: V5P.W, height: 398)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    @ViewBuilder private var inputForm: some View {
        SettingsListSection(title: "質問") {
            communityTextFieldRow($question, placeholder: "例: 次回FOMCはどうなる?")
        }
        SettingsListSection(title: "選択肢") { optionsList }
        SettingsListSection(title: "対象通貨ペア(任意)") {
            communityTextFieldRow($pair, placeholder: "例: USD/JPY")
        }
        SettingsListSection(title: "対象イベント(任意)") {
            communityTextFieldRow($eventName, placeholder: "例: 米雇用統計")
        }
        SettingsListSection(title: "回答期限") {
            DatePicker("回答期限", selection: $deadline, displayedComponents: [.date])
                .labelsHidden()
                .tint(V5P.cyan)
                .padding(.horizontal, 10)
                .frame(height: SettingsListLayout.rowHeight, alignment: .leading)
                .colorScheme(.dark)
        }
        AccountPrimaryButton(title: "確認する", isEnabled: canProceed) { step = .confirm }
    }

    private var optionsList: some View {
        VStack(spacing: 0) {
            ForEach(options.indices, id: \.self) { index in
                HStack(spacing: 6) {
                    TextField(
                        "", text: Binding(get: { options[index] }, set: { options[index] = $0 }),
                        prompt: Text("選択肢\(index + 1)").foregroundStyle(V5P.muted.opacity(0.8))
                    )
                    .font(.system(size: 9))
                    .foregroundStyle(.white)
                    .tint(V5P.cyan)
                    if options.count > 2 {
                        Button { options.remove(at: index) } label: {
                            Image(systemName: "minus.circle.fill").foregroundStyle(V5P.red.opacity(0.85))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 10)
                .frame(height: SettingsListLayout.rowHeight)
                if index < options.count - 1 { SettingsListSeparator() }
            }
            if options.count < 5 {
                SettingsListSeparator()
                Button { options.append("") } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus.circle.fill").foregroundStyle(V5P.blue)
                        NotoText.text("選択肢を追加", size: 7.5).foregroundStyle(V5P.blue)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10)
                    .frame(height: SettingsListLayout.rowHeight)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("communityPollComposeAddOption")
            }
        }
    }

    @ViewBuilder private var confirmView: some View {
        VStack(alignment: .leading, spacing: 8) {
            NotoText.text("入力内容の確認", size: 9).foregroundStyle(.white)
            communitySummaryRow(label: "質問", value: question)
            communitySummaryRow(label: "選択肢", value: filledOptions.joined(separator: " / "))
            if !pair.isEmpty { communitySummaryRow(label: "対象通貨ペア", value: pair) }
            if !eventName.isEmpty { communitySummaryRow(label: "対象イベント", value: eventName) }
            communitySummaryRow(label: "回答期限", value: deadline.formatted(date: .abbreviated, time: .omitted))
        }
        .padding(9)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
        .accessibilityIdentifier("communityPollComposeConfirm")

        CommunityComposeNotReadyNotice(
            detail: "アンケートを保存・集計するBackend/APIが未対応のため、この画面は入力の流れだけを確認する仮実装です。実際の投稿は行われません。"
        )
        AccountPrimaryButton(title: "投稿する", isEnabled: false) {}
            .accessibilityIdentifier("communityPollComposeSubmitDisabled")
        AccountSecondaryButton(title: "編集に戻る") { step = .input }
    }
}
