import Foundation

/// 無料プラン・プレミアムプランの使える範囲(HQ指示 2026-10-08)。`GET /entitlements`の
/// `plan`・`limits`(api-design v1.15)を起動時・フォアグラウンド復帰時・購入後に
/// 読み込み、各画面はここを見て上限を出す。上限はBackendでも確かめる(§28)ので、
/// ここは「押す前に分かるようにする」ためのもの。
@MainActor
final class PlanStore: ObservableObject {
    static let shared = PlanStore()

    @Published private(set) var plan: EntitlementsResponse.Plan = .free
    @Published private(set) var limits: PlanLimits = .free()

    var isPro: Bool { plan == .pro }

    func load(apiClient: APIClient) async {
        do {
            let response = try await EntitlementsService(apiClient: apiClient).fetchEntitlements(timezone: TimeZone.current.identifier)
            plan = response.plan ?? .free
            limits = response.limits ?? (plan == .pro ? .pro() : .free())
        } catch {
            // 取れないときは前回の値のまま(起動直後は無料プランの範囲)。
        }
    }

    /// テスト用。
    func set(plan: EntitlementsResponse.Plan, limits: PlanLimits) {
        self.plan = plan
        self.limits = limits
    }
}

/// `GET /entitlements`の`limits`。古いBackend(項目なし)では端末で同じ規則を計算する。
struct PlanLimits: Decodable, Equatable {
    /// 経済カレンダーでさかのぼれる最初の日時(含む)。
    let calendarEarliestFrom: Date
    /// 経済カレンダーで見られる最後の日時(含まない)。
    let calendarLatestTo: Date
    /// お気に入りの上限。nilは無制限。
    let favoritesMax: Int?
    /// 通知で選べる重要度。
    let notificationImportances: [String]
    /// 通知の対象通貨ペアの上限。nilは無制限。
    let notificationFxPairsMax: Int?
    /// 過去イベント比較に使う回数。
    let historyEventsMax: Int

    enum CodingKeys: String, CodingKey {
        case calendarEarliestFrom = "calendar_earliest_from"
        case calendarLatestTo = "calendar_latest_to"
        case favoritesMax = "favorites_max"
        case notificationImportances = "notification_importances"
        case notificationFxPairsMax = "notification_fx_pairs_max"
        case historyEventsMax = "history_events_max"
    }

    /// 無料プラン: カレンダーは先月の1日から、お気に入り3件、通知はHIGHと通貨ペア1つ、比較は5回。
    static func free(now: Date = Date(), calendar: Calendar = .current) -> PlanLimits {
        PlanLimits(
            calendarEarliestFrom: monthStart(offset: -1, from: now, calendar: calendar),
            calendarLatestTo: yearStart(offset: 2, from: now, calendar: calendar),
            favoritesMax: 3,
            notificationImportances: ["HIGH"],
            notificationFxPairsMax: 1,
            historyEventsMax: 5
        )
    }

    /// プレミアムプラン: カレンダーは5年前の1月から、ほかは無制限、比較は20回。
    static func pro(now: Date = Date(), calendar: Calendar = .current) -> PlanLimits {
        PlanLimits(
            calendarEarliestFrom: yearStart(offset: -5, from: now, calendar: calendar),
            calendarLatestTo: yearStart(offset: 2, from: now, calendar: calendar),
            favoritesMax: nil,
            notificationImportances: ["HIGH", "MEDIUM", "LOW"],
            notificationFxPairsMax: nil,
            historyEventsMax: 20
        )
    }

    private static func monthStart(offset: Int, from now: Date, calendar: Calendar) -> Date {
        let start = calendar.date(from: calendar.dateComponents([.year, .month], from: now)) ?? now
        return calendar.date(byAdding: .month, value: offset, to: start) ?? start
    }

    private static func yearStart(offset: Int, from now: Date, calendar: Calendar) -> Date {
        let start = calendar.date(from: calendar.dateComponents([.year], from: now)) ?? now
        return calendar.date(byAdding: .year, value: offset, to: start) ?? start
    }
}
