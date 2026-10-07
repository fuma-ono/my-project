import Foundation

/// SCR-026 ホーム通貨ペア編集。ホームに出す通貨ペアを最大3つ選び(追加画面で
/// 選ぶ)、並べ替えて「保存」で`PATCH /settings`の`home`へ送る。ホームはBackendの`major_fx`を
/// この順で受け取るので、ホームの画面側の変更は要らない。
@MainActor
final class HomeCurrencyPairEditorViewModel: ObservableObject {
    @Published private(set) var loadState: SettingsSectionLoadState = .loading
    @Published private(set) var saveState: SettingsSectionSaveState = .idle
    /// 表示する通貨ペア(並び順どおり)。
    @Published private(set) var selected: [String] = []
    /// 選べる通貨ペアすべて。
    @Published private(set) var available: [String] = []
    private var saved: [String] = []

    private let service: SettingsService
    private let catalog: FXPairCatalog

    init(apiClient: APIClient, catalog: FXPairCatalog? = nil) {
        service = SettingsService(apiClient: apiClient)
        self.catalog = catalog ?? RemoteFXPairCatalog(apiClient: apiClient)
    }

    var others: [String] { available.filter { !selected.contains($0) } }
    var canAdd: Bool { selected.count < HomeSettings.maxPairs }
    var hasChanges: Bool { selected != saved }
    var canSave: Bool { loadState == .loaded && hasChanges && !selected.isEmpty && saveState != .saving }

    func load() async {
        loadState = .loading
        do {
            let settings = try await service.fetchSettings()
            let symbols = (try? await catalog.availableSymbols()) ?? StaticFXPairCatalog.seededSymbols
            let current = settings.home.fxPairs ?? HomeSettings.defaultPairs.filter(symbols.contains)
            selected = Array(current.prefix(HomeSettings.maxPairs))
            saved = selected
            // 保存済みだが候補に無い記号も消さずに残す。
            available = symbols + selected.filter { !symbols.contains($0) }
            loadState = .loaded
        } catch let error as APIError where error.isNotConfigured {
            loadState = .backendNotConfigured
        } catch {
            loadState = .error("設定の取得に失敗しました。")
        }
    }

    func add(_ symbol: String) {
        guard canAdd, !selected.contains(symbol) else { return }
        selected.append(symbol)
        saveState = .idle
    }

    func remove(_ symbol: String) {
        selected.removeAll { $0 == symbol }
        saveState = .idle
    }

    /// 追加画面の行のタップ。選択中なら外し、そうでなければ追加する。
    func toggle(_ symbol: String) {
        if selected.contains(symbol) { remove(symbol) } else { add(symbol) }
    }

    /// 追加画面に出す通貨ペア。`query`は「usd/jpy」「ドル」のように記号・
    /// 日本語名のどちらでも探せる。
    func pairs(in category: PairCategory, matching query: String) -> [String] {
        let keyword = Self.searchKey(query)
        return available.filter { symbol in
            (category == .all || Self.category(of: symbol) == category)
                && (keyword.isEmpty || Self.searchKey(symbol + Self.names(symbol)).contains(keyword))
        }
    }

    /// `symbol`を`target`の位置へ動かす(ドラッグでの並べ替え)。
    func move(_ symbol: String, to target: String) {
        guard symbol != target,
              let from = selected.firstIndex(of: symbol),
              let to = selected.firstIndex(of: target) else { return }
        selected.remove(at: from)
        selected.insert(symbol, at: to)
        saveState = .idle
    }

    func save() async -> Bool {
        guard canSave else { return false }
        saveState = .saving
        do {
            let response = try await service.updateSettings(SettingsUpdate(home: HomeSettings(fxPairs: selected)))
            AppPreferences.shared.apply(response)
            saved = response.home.fxPairs ?? selected
            selected = saved
            saveState = .saved
            return true
        } catch {
            saveState = .error("保存に失敗しました。もう一度お試しください。")
            return false
        }
    }

    // MARK: - 表示

    /// 追加画面の絞り込み(参考画像の「すべて／主要通貨／クロス円／その他」)。
    enum PairCategory: CaseIterable {
        case all, major, crossYen, other

        var label: String {
            switch self {
            case .all: return "すべて"
            case .major: return "主要通貨"
            case .crossYen: return "クロス円"
            case .other: return "その他"
            }
        }
    }

    /// 米ドルを含むペアは主要通貨、米ドル以外と円のペアはクロス円、残りはその他。
    static func category(of symbol: String) -> PairCategory {
        if symbol.contains("USD") { return .major }
        if symbol.hasSuffix("JPY") { return .crossYen }
        return .other
    }

    private static func searchKey(_ text: String) -> String {
        text.uppercased().filter { !$0.isWhitespace && $0 != "/" }
    }

    /// 「USD」→「米ドル」(参考画像の「ユーロ / 米ドル」)。
    static func currencyName(_ code: String) -> String {
        switch code {
        case "USD": return "米ドル"
        case "JPY": return "円"
        case "EUR": return "ユーロ"
        case "GBP": return "ポンド"
        case "AUD": return "豪ドル"
        case "NZD": return "NZドル"
        case "CAD": return "カナダドル"
        case "CHF": return "スイスフラン"
        case "CNH", "CNY": return "人民元"
        default: return code
        }
    }

    static func names(_ symbol: String) -> String {
        guard symbol.count == 6 else { return symbol }
        return "\(currencyName(String(symbol.prefix(3)))) / \(currencyName(String(symbol.suffix(3))))"
    }
}
