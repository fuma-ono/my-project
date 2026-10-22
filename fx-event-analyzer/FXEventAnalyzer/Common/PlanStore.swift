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
    /// HQ指示(2026-10-22「A1ホームスナップショットのプラン失効対策」):
    /// `plan`がBackendで実際に確認済みかどうか。起動直後・`load()`が一度も
    /// 成功していない間は`.notLoaded`、直前の取得が失敗していれば`.failed`
    /// (このとき`plan`自体は従来通り直前の値のまま変えない)。`load()`が
    /// 成功した場合だけ`.confirmed`になる。前回データ(`HomeSnapshotStore`)の
    /// 利用可否など、「今のプランが確実に分かっているときだけ」判断したい
    /// 側はこれを見る — プラン判定そのものをここ以外で重複実装しない。
    @Published private(set) var confirmationState: ConfirmationState = .notLoaded

    enum ConfirmationState: Equatable {
        case notLoaded
        case confirmed
        case failed
    }

    var isPro: Bool { plan == .pro }

    /// 同時に複数箇所(`RootView`のフォアグラウンド復帰処理、`HomeViewModel`の
    /// 前回データ判定など)から呼ばれても、entitlementsの取得は1回にまとめる
    /// — HQ指示「フォアグラウンド復帰時のプラン再取得とスナップショットの
    /// 利用判定が競合しないようにする」「独自のプラン判定を重複実装しない」
    /// への対応。後から呼んだ側は、新たに取得し直すのではなく進行中の結果を
    /// 待つだけになる。
    private var inFlightLoad: Task<ConfirmationState, Never>?

    @discardableResult
    func load(apiClient: APIClient) async -> ConfirmationState {
        if let inFlightLoad {
            return await inFlightLoad.value
        }
        let task = Task { () -> ConfirmationState in
            do {
                let response = try await EntitlementsService(apiClient: apiClient).fetchEntitlements(timezone: TimeZone.current.identifier)
                plan = response.plan ?? .free
                limits = response.limits ?? (plan == .pro ? .pro() : .free())
                confirmationState = .confirmed
            } catch {
                // 取れないときは前回の値のまま(起動直後は無料プランの範囲) —
                // ただし「確認済みか」は.failedにし、古いプランの値を確認済み
                // 扱いで使わせない(前回データ表示の可否判断等に影響)。
                confirmationState = .failed
            }
            return confirmationState
        }
        inFlightLoad = task
        let result = await task.value
        inFlightLoad = nil
        return result
    }

    /// テスト用。確認済みのプランとして扱う。
    func set(plan: EntitlementsResponse.Plan, limits: PlanLimits) {
        self.plan = plan
        self.limits = limits
        self.confirmationState = .confirmed
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
