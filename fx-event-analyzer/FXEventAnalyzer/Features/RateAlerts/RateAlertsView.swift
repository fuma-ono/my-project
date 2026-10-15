import Combine
import SwiftUI

/// `GET /rate-alerts`(api-design v1.27)。
struct RateAlertsResponse: Decodable, Equatable {
    let items: [RateAlert]
    let limit: Limit

    struct Limit: Decodable, Equatable {
        let maxForPlan: Int
        let proMax: Int

        enum CodingKeys: String, CodingKey {
            case maxForPlan = "max_for_plan"
            case proMax = "pro_max"
        }
    }
}

struct RateAlert: Decodable, Equatable, Identifiable {
    enum Direction: String, Codable, CaseIterable, Identifiable {
        case above = "ABOVE"
        case below = "BELOW"
        var id: String { rawValue }
        var label: String { self == .above ? "上回ったら" : "下回ったら" }
    }

    let id: String
    let fxPairId: String
    let symbol: String
    let direction: Direction
    let targetPrice: Double
    let isActive: Bool
    let triggeredAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, symbol, direction
        case fxPairId = "fx_pair_id"
        case targetPrice = "target_price"
        case isActive = "is_active"
        case triggeredAt = "triggered_at"
    }
}

private struct NewRateAlert: Encodable {
    let fx_pair_id: String
    let direction: String
    let target_price: Double
}

/// `GET /fx-pairs`の1件(レートアラートで通貨ペアのIDが要る)。
private struct RateAlertPair: Decodable, Equatable, Identifiable {
    let fxPairId: String
    let symbol: String
    var id: String { fxPairId }

    enum CodingKeys: String, CodingKey {
        case fxPairId = "fx_pair_id"
        case symbol
    }
}

private struct RateAlertPairList: Decodable {
    let data: [RateAlertPair]
}

@MainActor
final class RateAlertsViewModel: ObservableObject {
    enum State: Equatable {
        case loading
        case loaded
        case error(String)
    }

    @Published private(set) var state: State = .loading
    @Published private(set) var alerts: [RateAlert] = []
    @Published private(set) var limit: RateAlertsResponse.Limit?
    @Published fileprivate var pairs: [RateAlertPair] = []
    @Published var message: String?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    var activeCount: Int { alerts.filter(\.isActive).count }

    var canAdd: Bool {
        guard let limit else { return true }
        return activeCount < limit.maxForPlan
    }

    func load() async {
        do {
            let response: RateAlertsResponse = try await apiClient.send(Endpoint(path: "rate-alerts"))
            alerts = response.items
            limit = response.limit
            if pairs.isEmpty, let list: RateAlertPairList = try? await apiClient.send(Endpoint(path: "fx-pairs")) {
                pairs = list.data
            }
            state = .loaded
        } catch {
            state = .error("レートアラートの取得に失敗しました。")
        }
    }

    fileprivate func add(pair: RateAlertPair, direction: RateAlert.Direction, price: Double) async {
        do {
            let body = try JSONEncoder().encode(NewRateAlert(fx_pair_id: pair.fxPairId, direction: direction.rawValue, target_price: price))
            let _: RateAlert = try await apiClient.send(Endpoint(path: "rate-alerts", method: .post, body: body))
            message = "\(Self.pairLabel(pair.symbol)) が \(Self.priceText(price)) を\(direction == .above ? "上回った" : "下回った")ら通知します。"
            await load()
        } catch {
            message = "追加できませんでした。プランの上限に達していないかご確認ください。"
        }
    }

    func delete(_ alert: RateAlert) async {
        // 204(本文なし)は APIClient が EmptyResponse として返す。
        let _: EmptyResponse? = try? await apiClient.send(Endpoint(path: "rate-alerts/\(alert.id)", method: .delete))
        alerts.removeAll { $0.id == alert.id }
        await load()
    }

    static func pairLabel(_ symbol: String) -> String {
        let plain = symbol.replacingOccurrences(of: "/", with: "")
        guard plain.count == 6 else { return symbol }
        return "\(plain.prefix(3))/\(plain.suffix(3))"
    }

    /// JPYを含むペアは小数2桁、それ以外は4桁。
    static func priceText(_ price: Double, symbol: String? = nil) -> String {
        let digits = (symbol?.uppercased().contains("JPY") ?? (price >= 20)) ? 2 : 4
        return String(format: "%.\(digits)f", price)
    }

    static func parsePrice(_ text: String) -> Double? {
        let normalized = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "")
        guard let value = Double(normalized), value > 0 else { return nil }
        return value
    }
}

/// レートアラート(HQ指示 2026-10-15「レートアラートの通知も作成」)。
/// 通貨ペア・向き(上回ったら/下回ったら)・価格を決めて追加すると、その価格を超えたときに通知一覧へ届く。
/// 届いたアラートは止まる(もう一度使うときは追加し直す)。
struct RateAlertsView: View {
    @StateObject private var viewModel: RateAlertsViewModel
    @Binding var tabSelection: Int
    @State private var selectedPairID: String?
    @State private var direction: RateAlert.Direction = .above
    @State private var priceText = ""
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: RateAlertsViewModel(apiClient: apiClient))
        _tabSelection = tabSelection
    }

    var body: some View {
        V5Viewport {
            V5Header(title: "レートアラート", back: true, onBack: { dismiss() })
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 10) {
                    addCard
                    listCard
                }
                .frame(width: 214)
                .padding(.bottom, 8)
            }
            .frame(width: V5P.W, height: 392)
            .position(x: V5P.W / 2, y: 60 + 392 / 2)
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await viewModel.load() }
        .alert(viewModel.message ?? "", isPresented: Binding(get: { viewModel.message != nil }, set: { if !$0 { viewModel.message = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }

    private var selectedPair: RateAlertPair? {
        viewModel.pairs.first { $0.fxPairId == selectedPairID } ?? viewModel.pairs.first
    }

    private var addCard: some View {
        SettingsListSection(title: "アラートを追加") {
            Menu {
                ForEach(viewModel.pairs) { pair in
                    Button(RateAlertsViewModel.pairLabel(pair.symbol)) { selectedPairID = pair.fxPairId }
                }
            } label: {
                row(title: "通貨ペア") {
                    NotoText.text(selectedPair.map { RateAlertsViewModel.pairLabel($0.symbol) } ?? "--", size: SettingsListLayout.valueSize)
                        .foregroundStyle(.white)
                    Image(systemName: "chevron.down").font(.system(size: 6, weight: .bold)).foregroundStyle(V5P.muted)
                }
            }
            SettingsListSeparator()
            row(title: "条件") {
                Picker("条件", selection: $direction) {
                    ForEach(RateAlert.Direction.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(width: 110)
            }
            SettingsListSeparator()
            row(title: "価格") {
                TextField("例: 156.00", text: $priceText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .font(.system(size: 9))
                    .foregroundStyle(.white)
                    .frame(width: 90)
            }
            SettingsListSeparator()
            Button {
                guard let pair = selectedPair, let price = RateAlertsViewModel.parsePrice(priceText) else {
                    viewModel.message = "価格を正しく入力してください。"
                    return
                }
                Task {
                    await viewModel.add(pair: pair, direction: direction, price: price)
                    priceText = ""
                }
            } label: {
                NotoText.text(viewModel.canAdd ? "追加する" : "上限に達しています", size: 9)
                    .foregroundStyle(viewModel.canAdd ? V5P.cyan : SettingsCardStyle.subtitleColor)
                    .frame(maxWidth: .infinity)
                    .frame(height: SettingsListLayout.rowHeight)
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.canAdd)
        }
    }

    private var listCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                NotoText.text("設定中のアラート", size: SettingsListLayout.sectionTitleSize)
                    .foregroundStyle(SettingsListLayout.sectionTitleColor)
                Spacer()
                if let limit = viewModel.limit {
                    NotoText.text("\(viewModel.activeCount)/\(limit.maxForPlan)件", size: 7.5)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                }
            }
            .padding(.horizontal, 4)
            VStack(spacing: 0) {
                if viewModel.alerts.isEmpty {
                    NotoText.text(viewModel.state == .loading ? "読み込み中..." : "アラートはまだありません。", size: 8)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity, minHeight: 36)
                }
                ForEach(Array(viewModel.alerts.enumerated()), id: \.element.id) { index, alert in
                    if index > 0 { SettingsListSeparator() }
                    alertRow(alert)
                }
            }
            .frame(width: 214)
            .background(AccountCardBackground())
            if let limit = viewModel.limit, limit.maxForPlan < limit.proMax {
                NotoText.text("無料プランは\(limit.maxForPlan)件まで。プレミアムなら\(limit.proMax)件まで設定できます。", size: 6.5)
                    .foregroundStyle(V5P.cyan)
                    .padding(.horizontal, 4)
            }
        }
    }

    private func alertRow(_ alert: RateAlert) -> some View {
        HStack(spacing: 6) {
            OverlappingPairFlags(symbol: alert.symbol, diameter: 11)
            VStack(alignment: .leading, spacing: 1) {
                NotoText.text("\(RateAlertsViewModel.pairLabel(alert.symbol)) が \(RateAlertsViewModel.priceText(alert.targetPrice, symbol: alert.symbol)) を\(alert.direction.label)", size: 8.5)
                    .foregroundStyle(alert.isActive ? .white : SettingsCardStyle.subtitleColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                NotoText.text(alert.isActive ? "監視中" : "通知済み", size: 6.5)
                    .foregroundStyle(alert.isActive ? V5P.cyan : SettingsCardStyle.subtitleColor)
            }
            Spacer(minLength: 4)
            Button {
                Task { await viewModel.delete(alert) }
            } label: {
                Image(systemName: "trash").font(.system(size: 9, weight: .semibold)).foregroundStyle(V5P.red)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("アラートを削除")
        }
        .padding(.horizontal, 10)
        .frame(height: 34)
    }

    private func row(title: String, @ViewBuilder trailing: () -> some View) -> some View {
        HStack(spacing: 6) {
            NotoText.text(title, size: SettingsListLayout.rowTitleSize).foregroundStyle(.white)
            Spacer(minLength: 4)
            trailing()
        }
        .padding(.horizontal, 10)
        .frame(height: SettingsListLayout.rowHeight)
        .contentShape(Rectangle())
    }
}
