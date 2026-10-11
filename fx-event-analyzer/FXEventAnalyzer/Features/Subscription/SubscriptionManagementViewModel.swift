import StoreKit
import Foundation

/// SCR-017 プラン・購読管理(HQ指示 2026-10-06の参考画像)。購読状態は
/// Backend(`GET /subscription`)を正とし、購入・復元・解約後は StoreKit の
/// 署名済みJWSを`POST /subscription/verify`で検証させてから表示を更新する
/// (api-design.md §25.1「StoreKitの端末上の状態は使わない」)。
@MainActor
final class SubscriptionManagementViewModel: ObservableObject {
    @Published private(set) var loadState: SettingsSectionLoadState = .loading
    @Published private(set) var subscription: SubscriptionResponse = .free
    @Published private(set) var products: [ProProduct] = ProProduct.fallback
    /// App Storeから価格を取得できた(購入できる)か。取得できない間は表示用の
    /// 予定価格のまま、購入は受け付けない。
    @Published private(set) var productsAvailable = false
    @Published private(set) var history: [PurchaseRecord] = []
    @Published private(set) var isWorking = false
    /// 購入・復元などの結果を知らせる一言(成功・失敗)。
    @Published var notice: String?

    private let service: SubscriptionService
    private let accountService: AccountService
    private let purchases: PurchaseClient

    private let apiClient: APIClient

    init(apiClient: APIClient, purchases: PurchaseClient? = nil) {
        self.apiClient = apiClient
        service = SubscriptionService(apiClient: apiClient)
        accountService = AccountService(apiClient: apiClient)
        self.purchases = purchases ?? StoreKitPurchaseClient()
    }

    func load() async {
        loadState = .loading
        do {
            subscription = try await service.fetchSubscription()
            loadState = .loaded
        } catch let error as APIError where error.isNotConfigured {
            loadState = .backendNotConfigured
            return
        } catch {
            loadState = .error("購読情報の取得に失敗しました。")
            return
        }
        if let loaded = try? await purchases.products(), !loaded.isEmpty {
            products = ProProduct.fallback.map { fallback in loaded.first { $0.id == fallback.id } ?? fallback }
            productsAvailable = true
        }
    }

    // MARK: - 表示

    var currentProduct: ProProduct? {
        guard subscription.isPro, let id = subscription.productId else { return nil }
        return products.first { $0.id == id }
    }

    var planTitle: String { subscription.isPro ? "プレミアムプラン" : "無料プラン" }

    var priceLabel: String {
        guard let product = currentProduct else {
            return subscription.isPro ? "ご利用中" : "基本機能をお試しいただけます。"
        }
        return "\(product.period.label) \(product.displayPrice)"
    }

    /// 「次回更新日 2026/11/06 (金)」。自動更新オフなら有効期限。
    var renewalLabel: String? {
        guard subscription.isPro, let expiresAt = subscription.expiresAt else { return nil }
        // 曜日は表示形式に関わらず添える(参考画像の「2025/04/10 (木)」)。
        // 曜日も日付と同じタイムゾーンで出す。
        Self.weekdayFormatter.timeZone = AppPreferences.shared.timeZone
        let date = AppPreferences.shared.dateString(expiresAt) + " (" + Self.weekdayFormatter.string(from: expiresAt) + ")"
        return subscription.isCanceled ? "有効期限 \(date)（自動更新オフ）" : "次回更新日 \(date)"
    }

    /// 解約できるのは自動更新中のProだけ。
    var canCancel: Bool { subscription.isPro && !subscription.isCanceled }

    private static let weekdayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "E"
        return formatter
    }()

    static func historyDate(_ date: Date) -> String {
        let preferences = AppPreferences.shared
        return "\(preferences.dateString(date)) \(preferences.timeString(date))"
    }

    // MARK: - 操作

    func purchase(_ product: ProProduct) async {
        await perform {
            // 購入をこのユーザーに紐付ける(Backendが他人の購入の流用を防ぐ)。
            let userID = try await self.accountService.fetchAccount().userID
            switch try await self.purchases.purchase(productID: product.id, appAccountToken: userID) {
            case .purchased(let signed):
                try await self.sync(signed)
                return "\(product.period.label)プランに登録しました。"
            case .pending:
                return "承認待ちです。承認されると自動で反映されます。"
            case .cancelled:
                return nil
            }
        }
    }

    func restore() async {
        await perform {
            guard let signed = try await self.purchases.restore() else { return "復元できる購入はありませんでした。" }
            try await self.sync(signed)
            return "購入を復元しました。"
        }
    }

    /// App Storeの管理画面(解約・プラン変更)から戻ったら、状態を送り直す。
    func manageSubscription() async {
        guard !isWorking else { return }
        await purchases.showManageSubscriptions()
        await perform {
            if let signed = await self.purchases.currentSubscription() {
                try await self.sync(signed)
            } else {
                self.subscription = try await self.service.fetchSubscription()
            }
            return nil
        }
    }

    func loadHistory() async {
        history = await purchases.history()
    }

    private func sync(_ signed: SignedPurchase) async throws {
        _ = try await service.verify(signed.request)
        // verifyの応答には商品が無いので、取り直して月額・年額も揃える。
        subscription = try await service.fetchSubscription()
        // 購入・復元・解約の結果を、カレンダーなどの使える範囲にもすぐ反映する。
        await PlanStore.shared.load(apiClient: apiClient)
    }

    private func perform(_ action: @escaping () async throws -> String?) async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            if let message = try await action() { notice = message }
        } catch StoreKitError.userCancelled {
            // Apple IDの確認を自分で閉じた(復元のキャンセルなど)。
        } catch APIError.server(code: _, message: _, httpStatus: 403) {
            notice = "別のアカウントで購入された購読のため、このアカウントでは利用できません。"
        } catch APIError.server(code: _, message: _, httpStatus: 409) {
            notice = "この購読は別のアカウントに登録されています。購入したアカウントでログインしてください。"
        } catch {
            notice = "処理に失敗しました。時間をおいてもう一度お試しください。"
        }
    }
}
