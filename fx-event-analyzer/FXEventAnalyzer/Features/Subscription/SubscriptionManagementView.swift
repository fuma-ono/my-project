import SwiftUI
import UIKit

/// SCR-017 プラン・購読管理。HQ指示(2026-10-06)の参考画像の配置
/// (プランのカード → 4つの操作 → 購読を解約)を、ヘッダー下〜タブバー上
/// (V5座標の約54〜452)に置く。購入・解約はApp Store(StoreKit 2)で行い、
/// 状態はBackendで検証してから出す(`SubscriptionManagementViewModel`)。
struct SubscriptionManagementView: View {
    @StateObject private var viewModel: SubscriptionManagementViewModel
    @Binding var tabSelection: Int
    @State private var sheet: Sheet?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private enum Sheet: String, Identifiable {
        case plans, history, benefits
        var id: String { rawValue }
    }

    init(apiClient: APIClient, tabSelection: Binding<Int>, purchases: PurchaseClient? = nil) {
        _viewModel = StateObject(wrappedValue: SubscriptionManagementViewModel(apiClient: apiClient, purchases: purchases))
        _tabSelection = tabSelection
    }

    var body: some View {
        V5Viewport {
            V5Header(title: "プラン・購読管理", back: true, onBack: { dismiss() })
            switch viewModel.loadState {
            case .loading:
                centered { LoadingView(caption: "読み込み中...") }
            case .backendNotConfigured:
                centered { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "購読情報はまだ利用できません。") }
            case .error(let message):
                centered { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { Task { await viewModel.load() } }) }
            case .loaded:
                VStack(spacing: viewModel.subscription.isPro ? 14 : 10) {
                    planCard
                    if !viewModel.subscription.isPro { upgradeSection }
                    menuCard
                    if viewModel.canCancel { cancelCard }
                }
                .accountPinned(top: 66, height: 380)
            }
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await viewModel.load() }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .plans: planSheet
            case .history: historySheet
            case .benefits: benefitsSheet
            }
        }
        .alert(viewModel.notice ?? "", isPresented: Binding(get: { viewModel.notice != nil }, set: { if !$0 { viewModel.notice = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }

    private func centered(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
            .padding(.top, 53)
    }

    // MARK: - プランのカード

    private var planCard: some View {
        HStack(spacing: 12) {
            Image(systemName: viewModel.subscription.isPro ? "crown.fill" : "person.crop.circle")
                .font(.system(size: 17, weight: .semibold))
                // 有料プランは金色の丸の中に、カードと同じ紺色で王冠を抜く(HQ指示 2026-10-06)。
                .foregroundStyle(viewModel.subscription.isPro ? SettingsCardStyle.cardFill : V5P.cyan)
                .frame(width: 36, height: 36)
                .background(Circle().fill(viewModel.subscription.isPro ? SubscriptionPalette.gold : Color.black.opacity(0.18)))
                .overlay(Circle().stroke(viewModel.subscription.isPro ? Color.clear : SettingsCardStyle.cardBorder, lineWidth: 1))
            VStack(alignment: .leading, spacing: 4) {
                V5JPFont.text(viewModel.planTitle, size: 12, weight: .bold)
                    .foregroundStyle(viewModel.subscription.isPro ? SubscriptionPalette.gold : .white)
                NotoText.text(viewModel.priceLabel, size: viewModel.subscription.isPro ? 11.5 : 8)
                    .foregroundStyle(.white)
                if let renewal = viewModel.renewalLabel {
                    NotoText.text(renewal, size: 7.5)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        // 無料プランは下に案内が入るので、カードを低くして1画面に収める。
        .frame(width: 214, height: viewModel.subscription.isPro ? 86 : 62)
        .background(
            RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
                .fill(SettingsCardStyle.cardFill)
                .overlay(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius).stroke(V5P.blue.opacity(0.8), lineWidth: 0.8))
                .shadow(color: V5P.blue.opacity(0.35), radius: 6)
        )
    }

    // MARK: - 無料プランの案内

    /// 無料プランのときだけ出す、プレミアムプランの案内(HQ指示 2026-10-06の参考画像)。
    /// 通知・設定などは無料でも使えるので、文言は実際の特典(高度な統計)に合わせた。
    private var upgradeSection: some View {
        VStack(alignment: .leading, spacing: 5) {
            V5JPFont.text("プレミアムプランでできること", size: 8.5, weight: .bold)
                .foregroundStyle(SubscriptionPalette.heading)
                .padding(.leading, 4)
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "crown.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(V5P.blue.opacity(0.45)))
                VStack(alignment: .leading, spacing: 3) {
                    V5JPFont.text("より多くの機能を利用するには", size: 7.5, weight: .bold).foregroundStyle(.white)
                    V5JPFont.text("プレミアムプランにご登録ください。", size: 7.5, weight: .bold).foregroundStyle(V5P.cyan)
                    V5JPFont.text("過去の発表時の詳しい値動き統計など、すべての機能が利用可能になります。", size: 6, weight: .regular)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .fixedSize(horizontal: false, vertical: true)
                    // ボタンは文の下に置き、文を横幅いっぱいに使う(折り返しを減らす)。
                    HStack {
                        Spacer(minLength: 0)
                        Button { sheet = .plans } label: {
                            V5JPFont.text("プランを確認する", size: 6.5, weight: .bold)
                                .foregroundStyle(.white)
                                .padding(.horizontal, 10)
                                .frame(height: 19)
                                .background(Capsule().fill(V5P.blue))
                                .fixedSize()
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.top, 2)
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 8)
            .frame(width: 214)
            .background(AccountCardBackground())
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "info.circle.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(V5P.blue)
                V5JPFont.text("無料プランは、いつでもプレミアムプランにアップグレードできます。アップグレード後は、すぐにすべての機能をご利用いただけます。", size: 6, weight: .regular)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 6)
            .padding(.top, 2)
        }
        .frame(width: 214, alignment: .leading)
    }

    // MARK: - 操作

    private var menuCard: some View {
        VStack(spacing: 0) {
            SubscriptionMenuRow(icon: "arrow.triangle.2.circlepath", title: viewModel.subscription.isPro ? "プランを変更" : "プランを選ぶ") {
                sheet = .plans
            }
            SubscriptionSeparator()
            SubscriptionMenuRow(icon: "creditcard", title: "支払い方法の管理") {
                // 支払い方法はAppleのアカウントで管理する(アプリは扱わない)。
                if let url = URL(string: "https://apps.apple.com/account/billing") { openURL(url) }
            }
            SubscriptionSeparator()
            SubscriptionMenuRow(icon: "list.bullet.rectangle", title: "購入履歴") {
                sheet = .history
                Task { await viewModel.loadHistory() }
            }
            SubscriptionSeparator()
            SubscriptionMenuRow(icon: "gift", title: "特典内容の確認") { sheet = .benefits }
        }
        .frame(width: 214)
        .background(AccountCardBackground())
        .disabled(viewModel.isWorking)
    }

    private var cancelCard: some View {
        SubscriptionMenuRow(icon: "trash", title: "購読を解約", tint: AccountPalette.destructive) {
            Task { await viewModel.manageSubscription() }
        }
        .frame(width: 214)
        .background(AccountCardBackground())
        .disabled(viewModel.isWorking)
    }

    // MARK: - シート

    private var planSheet: some View {
        SubscriptionSheet(title: viewModel.subscription.isPro ? "プランを変更" : "プランを選ぶ") {
            VStack(spacing: 0) {
                ForEach(viewModel.products) { product in
                    let isCurrent = viewModel.currentProduct?.id == product.id
                    Button {
                        if viewModel.subscription.isPro {
                            // 加入中のプランの切り替えはApp Storeの管理画面で行う。
                            Task { await viewModel.manageSubscription() }
                        } else {
                            Task { await viewModel.purchase(product) }
                        }
                        sheet = nil
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(product.period.label)プラン").foregroundStyle(.white)
                                Text(product.displayPrice + (product.period == .monthly ? " / 月" : " / 年"))
                                    .font(.footnote)
                                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                            }
                            Spacer()
                            if isCurrent {
                                Text("ご利用中").font(.footnote.weight(.semibold)).foregroundStyle(V5P.cyan)
                            }
                        }
                        .padding(.horizontal, 16)
                        .frame(height: 56)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(isCurrent)
                }
            }
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.06)))
            .padding(.horizontal, 16)

            Button("購入を復元") {
                Task { await viewModel.restore() }
                sheet = nil
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(V5P.cyan)
            .padding(.top, 14)

            Text("お支払いはApple IDに請求されます。購読は期間終了の24時間前までに解約しない限り自動で更新されます。解約はApp Storeのサブスクリプション管理から行えます。")
                .font(.caption)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .padding(.horizontal, 24)
                .padding(.top, 10)
        }
    }

    private var historySheet: some View {
        SubscriptionSheet(title: "購入履歴") {
            if viewModel.history.isEmpty {
                Text("購入履歴はありません。")
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .padding(.top, 24)
            } else {
                VStack(spacing: 0) {
                    ForEach(viewModel.history) { record in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(ProProduct.period(of: record.productID)?.label ?? "")プラン").foregroundStyle(.white)
                                Text(SubscriptionManagementViewModel.historyDate(record.purchaseDate))
                                    .font(.footnote)
                                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                            }
                            Spacer()
                            Text(record.isRevoked ? "返金済み" : (record.price ?? ""))
                                .font(.footnote)
                                .foregroundStyle(record.isRevoked ? AccountPalette.destructive : .white)
                        }
                        .padding(.horizontal, 16)
                        .frame(height: 52)
                    }
                }
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.06)))
                .padding(.horizontal, 16)
            }
        }
    }

    private var benefitsSheet: some View {
        SubscriptionSheet(title: "特典内容の確認") {
            VStack(alignment: .leading, spacing: 14) {
                benefit("chart.xyaxis.line", "高度な統計", "過去の同じ指標の発表時に、為替がどう動いたかの詳しい統計を見られます。")
                benefit("checkmark.seal", "無料プランの全機能", "経済指標・要人発言・通知など、無料プランの機能もすべて使えます。")
            }
            .padding(.horizontal, 24)
        }
    }

    private func benefit(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).foregroundStyle(V5P.cyan).frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                Text(detail).font(.footnote).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
    }
}

// MARK: - 部品

private enum SubscriptionPalette {
    /// 参考画像の王冠・プラン名の金色。
    static let gold = Color(red: 1.0, green: 0.80, blue: 0.36)
    /// 参考画像の見出し「プレミアムプランでできること」の水色。
    static let heading = Color(red: 0.55, green: 0.78, blue: 1.0)
}

private struct SubscriptionSeparator: View {
    var body: some View {
        Rectangle().fill(SettingsCardStyle.separator).frame(height: 0.6).padding(.horizontal, 8)
    }
}

/// アイコン・項目名・シェブロンの行。
private struct SubscriptionMenuRow: View {
    let icon: String
    let title: String
    var tint: Color = .white
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(tint == .white ? V5P.cyan : tint)
                    .frame(width: 16)
                V5JPFont.text(title, size: 9.5, weight: .medium).foregroundStyle(tint)
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 7.5, weight: .semibold))
                    .foregroundStyle(SettingsCardStyle.chevronColor)
            }
            .padding(.horizontal, 11)
            .frame(height: 33)
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isButton)
    }
}

/// 選択肢などのシート。固定キャンバスの拡大表示に入れず、通常サイズで出す。
private struct SubscriptionSheet<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .overlay(alignment: .trailing) {
                    Button("完了") { dismiss() }
                        .fontWeight(.semibold)
                        .foregroundStyle(V5P.cyan)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            ScrollView {
                VStack(spacing: 0) { content() }
                    .frame(maxWidth: .infinity)
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(SettingsCardStyle.cardFill)
    }
}
