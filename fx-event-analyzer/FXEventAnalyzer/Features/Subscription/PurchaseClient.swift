import StoreKit
import UIKit

/// Pro商品(api-design.md §25.2)。価格はApp Store Connectで決まるので、
/// StoreKitから取れたらその表示価格を使い、取れない間(審査前・シミュレーター)
/// は登録予定の価格を出す。
struct ProProduct: Equatable, Identifiable {
    enum Period: Equatable {
        case monthly, yearly

        var label: String { self == .monthly ? "月額" : "年額" }
    }

    let id: String
    let period: Period
    let displayPrice: String

    static let monthlyID = "com.fumaono.fxeventanalyzer.pro.monthly"
    static let yearlyID = "com.fumaono.fxeventanalyzer.pro.yearly"
    static let ids = [monthlyID, yearlyID]

    static let fallback = [
        ProProduct(id: monthlyID, period: .monthly, displayPrice: "¥980"),
        ProProduct(id: yearlyID, period: .yearly, displayPrice: "¥9,800"),
    ]

    static func period(of id: String) -> Period? {
        switch id {
        case monthlyID: return .monthly
        case yearlyID: return .yearly
        default: return nil
        }
    }
}

/// StoreKitが返した、Backendへ送る署名済みの購読(JWS)。
struct SignedPurchase: Equatable {
    let transaction: String
    let renewalInfo: String?

    var request: SubscriptionVerifyRequest {
        SubscriptionVerifyRequest(signedTransaction: transaction, signedRenewalInfo: renewalInfo)
    }
}

enum PurchaseOutcome: Equatable {
    case purchased(SignedPurchase)
    case cancelled
    /// 保護者の承認待ちなど。承認されると`Transaction.updates`で届く。
    case pending
}

/// 購入履歴の1行(StoreKitの`Transaction.all`)。
struct PurchaseRecord: Equatable, Identifiable {
    let id: String
    let productID: String
    let purchaseDate: Date
    let price: String?
    /// 返金・取り消し済み。
    let isRevoked: Bool
}

/// StoreKit 2の窓口。テストでは差し替える。秘密鍵やAPIキーは使わない
/// (署名の検証はBackendがAppleの公開証明書で行う)。
@MainActor
protocol PurchaseClient {
    func products() async throws -> [ProProduct]
    func purchase(productID: String, appAccountToken: UUID) async throws -> PurchaseOutcome
    /// 端末で今有効な購読。
    func currentSubscription() async -> SignedPurchase?
    /// App Storeと同期して購入を復元する。
    func restore() async throws -> SignedPurchase?
    func history() async -> [PurchaseRecord]
    /// App Storeの「サブスクリプションの管理」(解約・プラン変更)を開く。
    func showManageSubscriptions() async
}

enum PurchaseError: Error, Equatable {
    case productUnavailable
    case unverified
}

@MainActor
final class StoreKitPurchaseClient: PurchaseClient {
    func products() async throws -> [ProProduct] {
        try await Product.products(for: ProProduct.ids).compactMap { product in
            ProProduct.period(of: product.id).map { ProProduct(id: product.id, period: $0, displayPrice: product.displayPrice) }
        }
    }

    func purchase(productID: String, appAccountToken: UUID) async throws -> PurchaseOutcome {
        guard let product = try await Product.products(for: [productID]).first else { throw PurchaseError.productUnavailable }
        switch try await product.purchase(options: [.appAccountToken(appAccountToken)]) {
        case .success(let result):
            guard case .verified(let transaction) = result else { throw PurchaseError.unverified }
            let signed = SignedPurchase(transaction: result.jwsRepresentation, renewalInfo: await Self.renewalInfo(for: product))
            // 端末上の状態は使わず、Backendの検証結果で判定する(§25.1)。
            // finishしても有効な購読は`currentEntitlements`に残るので、送り直せる。
            await transaction.finish()
            return .purchased(signed)
        case .userCancelled:
            return .cancelled
        case .pending:
            return .pending
        @unknown default:
            return .cancelled
        }
    }

    func currentSubscription() async -> SignedPurchase? {
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result, ProProduct.ids.contains(transaction.productID) else { continue }
            var renewalInfo: String?
            if let product = try? await Product.products(for: [transaction.productID]).first {
                renewalInfo = await Self.renewalInfo(for: product)
            }
            return SignedPurchase(transaction: result.jwsRepresentation, renewalInfo: renewalInfo)
        }
        return nil
    }

    func restore() async throws -> SignedPurchase? {
        try await AppStore.sync()
        return await currentSubscription()
    }

    func history() async -> [PurchaseRecord] {
        var records: [PurchaseRecord] = []
        for await result in Transaction.all {
            guard case .verified(let transaction) = result, ProProduct.ids.contains(transaction.productID) else { continue }
            records.append(PurchaseRecord(
                id: String(transaction.id),
                productID: transaction.productID,
                purchaseDate: transaction.purchaseDate,
                price: Self.priceText(transaction),
                isRevoked: transaction.revocationDate != nil
            ))
        }
        return records.sorted { $0.purchaseDate > $1.purchaseDate }
    }

    func showManageSubscriptions() async {
        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0 is UIWindowScene }) as? UIWindowScene else { return }
        try? await AppStore.showManageSubscriptions(in: scene)
    }

    private static func renewalInfo(for product: Product) async -> String? {
        guard let statuses = try? await product.subscription?.status else { return nil }
        for status in statuses {
            if case .verified(let transaction) = status.transaction, transaction.productID == product.id {
                return status.renewalInfo.jwsRepresentation
            }
        }
        return statuses.first?.renewalInfo.jwsRepresentation
    }

    private static func priceText(_ transaction: Transaction) -> String? {
        guard let price = transaction.price, let code = transaction.currency?.identifier else { return nil }
        return price.formatted(.currency(code: code).locale(Locale(identifier: "ja_JP")))
    }
}

/// 起動中に届く購読の更新(自動更新・承認待ちの完了・返金など)をBackendへ
/// 送る。アプリ表示中に一度だけ始める。
@MainActor
final class SubscriptionSync {
    static let shared = SubscriptionSync()
    private var updatesTask: Task<Void, Never>?

    func start(apiClient: APIClient) {
        guard updatesTask == nil else { return }
        let service = SubscriptionService(apiClient: apiClient)
        updatesTask = Task {
            // 起動時に、端末で有効な購読を一度送り直す(更新・解約の反映)。
            if let current = await StoreKitPurchaseClient().currentSubscription() {
                _ = try? await service.verify(current.request)
            }
            for await result in Transaction.updates {
                guard case .verified(let transaction) = result, ProProduct.ids.contains(transaction.productID) else { continue }
                _ = try? await service.verify(SubscriptionVerifyRequest(signedTransaction: result.jwsRepresentation, signedRenewalInfo: nil))
                await transaction.finish()
            }
        }
    }
}
