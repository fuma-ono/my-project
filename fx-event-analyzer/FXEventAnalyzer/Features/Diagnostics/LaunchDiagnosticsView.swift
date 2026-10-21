import SwiftUI
import UIKit

/// HQ指示(2026-10-20)「FX Event Analyzer iPhone向け起動診断画面」。
///
/// 目的: TestFlight版で、Mac/Console.appを使わずiPhoneだけで、初回起動〜
/// ホーム表示までの約30秒の内訳を確認できるようにする。`DiagnosticsStore`
/// が保持する値を表示するだけの画面で、ここ自体は計測を行わない。
///
/// 既存のダークデザイン(`V5Viewport`/`V5Header`/`V5BottomBar`)は他の
/// 設定サブ画面と共有し、参考画像を持たないエンジニアリング用の画面の
/// ため、レイアウトは他画面のような1px単位の実測合わせはしていない。
struct LaunchDiagnosticsView: View {
    @ObservedObject private var store = DiagnosticsStore.shared
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss
    @State private var showsCopiedFeedback = false
    @State private var exportFileURL: URL?

    var body: some View {
        V5Viewport {
            V5Header(title: "起動診断", back: true, onBack: { dismiss() })
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 10) {
                    NotoText.text(
                        "初回起動からホーム画面が表示されるまでの時間の内訳です。この画面はローカルの計測値のみを表示し、外部への自動送信は行いません。",
                        size: 7.5
                    )
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)

                    sectionTitle("今回の起動")
                    summaryCard(store.current)
                    spansCard(store.current)
                    homeRequestCard(store.current)
                    networkCard(store.current)
                    homeSnapshotCard(store.current)

                    if let previous = store.previous {
                        sectionTitle("前回の起動")
                        summaryCard(previous)
                        intervalCard(previous: previous)
                    } else {
                        sectionTitle("前回の起動")
                        NotoText.text("前回の起動データはまだありません。", size: 7.5)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .padding(.horizontal, 4)
                    }

                    noteCard

                    actionButtons
                }
                .frame(width: 214)
                .padding(.vertical, 10)
                .frame(width: V5P.W)
            }
            .frame(width: V5P.W, height: 398)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: - セクション

    private func sectionTitle(_ title: String) -> some View {
        NotoText.text(title, size: 10.5)
            .foregroundStyle(SettingsListLayout.sectionTitleColor)
            .padding(.top, 4)
    }

    /// 項目1・10・11・2: 最終起動日時・起動シーケンス全体の時間・
    /// 計測成功/失敗/未計測の状態・起動シーケンス(Splash)の経過時間。
    private func summaryCard(_ diagnostics: LaunchDiagnostics) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            row("最終起動日時", Self.dateFormatter.string(from: diagnostics.startedAt))
            row("起動シーケンス全体の時間", LaunchDiagnostics.describe(diagnostics.totalUntilHomeReadyMs))
            row("起動シーケンス(Splash)の時間", LaunchDiagnostics.describe(diagnostics.runInitSequenceTotalMs))
            row("計測の状態", diagnostics.overallStatusDescription)
            row("区間外・未計測の時間", diagnostics.unaccountedMs.map { LaunchDiagnostics.describe($0) } ?? "算出不可")
        }
        .padding(10)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
    }

    /// 項目3〜9: 区間ごとの計測値(開始点・終了点つき)。
    private func spansCard(_ diagnostics: LaunchDiagnostics) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(diagnostics.spans.enumerated()), id: \.offset) { index, span in
                if index > 0 { SettingsListSeparator() }
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        NotoText.text(span.label, size: 8).foregroundStyle(.white)
                        Spacer()
                        NotoText.text(LaunchDiagnostics.describe(span.durationMs), size: 8)
                            .foregroundStyle(span.isMeasured ? V5P.cyan : SettingsCardStyle.subtitleColor)
                    }
                    NotoText.text("開始: \(span.startDescription)", size: 6)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                    NotoText.text("終了: \(span.endDescription)", size: 6)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                }
                .padding(.vertical, 6)
            }
        }
        .padding(.horizontal, 10)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
    }

    /// 項目12にあたる、/homeリクエスト固有の詳細(複数回走った場合の識別含む)。
    private func homeRequestCard(_ diagnostics: LaunchDiagnostics) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            row("/home取得回数(今回の起動内)", diagnostics.homeRequestCount == 0 ? "未実行" : "\(diagnostics.homeRequestCount)回")
            if diagnostics.homeRequestCount > 1 {
                NotoText.text("下の詳細は起動時(1回目)の値です。タブの出入り等での再取得で上書きしません。", size: 6)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            row("/homeリクエストの状態", diagnostics.homeRequestOutcome.rawValue)
            row("/home HTTPステータスコード", diagnostics.homeHTTPStatusCode.map(String.init) ?? "未計測")
        }
        .padding(10)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
    }

    /// HQ指示(2026-10-21)「通信遅延の詳細計測」: 起動後1回目の/home・/calendar・
    /// /speechesの通信の内訳(URLSessionTaskMetrics)。取れない値は「N/A(理由)」。
    private func networkCard(_ diagnostics: LaunchDiagnostics) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            NotoText.text("通信の内訳(起動後1回目の要求)", size: 8).foregroundStyle(.white)
            ForEach(LaunchDiagnostics.trackedAPIPaths, id: \.self) { path in
                SettingsListSeparator()
                NotoText.text("/\(path)", size: 7.5).foregroundStyle(V5P.cyan)
                if let request = diagnostics.apiRequests?[path] {
                    ForEach(Array(LaunchDiagnostics.networkRows(request).enumerated()), id: \.offset) { _, row in
                        self.row(row.0, row.1)
                    }
                } else {
                    NotoText.text("未実行(この起動ではまだ要求していない)", size: 6.5)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                }
            }
            NotoText.text("「応答待ち」には、サーバーの処理時間と、途中の中継(Renderの入り口など)での待ちの両方が入ります。この計測だけでは区別できません。", size: 6.3)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
    }

    /// HQ決定(2026-10-21「起動の遅れの改善A1」): 前回保存したホームの
    /// 内容を先に表示した場合の判定結果・古さ・表示時点。
    private func homeSnapshotCard(_ diagnostics: LaunchDiagnostics) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            NotoText.text("前回のホームデータの先行表示", size: 8).foregroundStyle(.white)
            row("判定結果", diagnostics.homeSnapshotOutcome ?? "未判定")
            row("表示した前回データの古さ", diagnostics.homeSnapshotAgeSeconds.map { String(format: "%.0f秒", $0) } ?? "該当データなし")
            row("前回データを表示した時点", LaunchDiagnostics.describe(diagnostics.homeSnapshotShownMs))
            row("最新データを表示した時点", LaunchDiagnostics.describe(diagnostics.homeReadyToDisplayMs))
        }
        .padding(10)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
    }

    /// HQ指示(2026-10-20、2回目「起動遅延の再調査」):「アプリをすぐ
    /// 再起動した場合」と「しばらく時間を空けた場合」を、追加の計測なしで
    /// 比較できるようにする。前回・今回それぞれの`startedAt`から計算する
    /// だけの表示専用カード。
    private func intervalCard(previous: LaunchDiagnostics) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            row("今回の起動との間隔", store.current.intervalSincePreviousDescription(previous: previous))
            NotoText.text("Renderの無料プランは15分アクセスが無いと休止し、次のアクセスで起きるまで最初の1回は30〜60秒かかります。間隔が短い起動と長い起動で「/home HTTP通信往復」の値を見比べる目安にしてください。", size: 6.3)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
        }
        .padding(10)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
    }

    private var noteCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            NotoText.text("注記", size: 8).foregroundStyle(.white)
            NotoText.text("・この計測の基準点(経過0ms)より前の時間(プロセス起動・Swiftランタイム初期化等)は、アプリ内計測だけでは直接測れません。", size: 6.3)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
            NotoText.text("・「表示イベント」はSwiftUIの.onAppearが発生した時刻で、描画が完全に終了したことの保証ではありません。", size: 6.3)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
            NotoText.text("・OS起動(端末の最後の再起動)からの経過秒数は参考値で、アプリの起動時間とは別物です。", size: 6.3)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
        }
        .padding(10)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            NotoText.text(label, size: 7.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            Spacer(minLength: 8)
            NotoText.text(value, size: 7.5).foregroundStyle(.white).multilineTextAlignment(.trailing)
        }
    }

    // MARK: - コピー・書き出し

    private var actionButtons: some View {
        VStack(spacing: 8) {
            if showsCopiedFeedback {
                NotoText.text("診断結果をコピーしました", size: 7)
                    .foregroundStyle(V5P.cyan)
            }
            AccountPrimaryButton(title: "診断結果をコピー") {
                UIPasteboard.general.string = reportText
                showsCopiedFeedback = true
                Task {
                    try? await Task.sleep(for: .seconds(2))
                    showsCopiedFeedback = false
                }
            }
            if let exportFileURL {
                ShareLink(item: exportFileURL) {
                    HStack(spacing: 5) {
                        Image(systemName: "square.and.arrow.up").font(.system(size: 10, weight: .semibold))
                        NotoText.text("診断結果を書き出す", size: AccountLayout.leadSize)
                    }
                    .foregroundStyle(.white)
                    .frame(width: 214, height: 29)
                    .background(
                        RoundedRectangle(cornerRadius: 7)
                            .fill(SettingsCardStyle.cardFill)
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(V5P.cyan.opacity(0.7), lineWidth: 0.8))
                    )
                }
            } else {
                Button {
                    exportFileURL = Self.writeExportFile(reportText)
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "square.and.arrow.up").font(.system(size: 10, weight: .semibold))
                        NotoText.text("診断結果を書き出す", size: AccountLayout.leadSize)
                    }
                    .foregroundStyle(.white)
                    .frame(width: 214, height: 29)
                    .background(
                        RoundedRectangle(cornerRadius: 7)
                            .fill(SettingsCardStyle.cardFill)
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(V5P.cyan.opacity(0.7), lineWidth: 0.8))
                    )
                }
            }
        }
        .padding(.top, 4)
    }

    private var reportText: String {
        store.current.reportText(appVersion: AppInfo.version, buildNumber: Self.buildNumber, previous: store.previous)
    }

    private static var buildNumber: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "-"
    }

    /// 書き出すテキストファイルを一時ディレクトリに作る。アプリ外への
    /// 自動送信は行わない — `ShareLink`は人がタップして初めて共有シートを
    /// 開く(この画面を開いた時点では何も送信していない)。
    private static func writeExportFile(_ text: String) -> URL? {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let filename = "FXEventAnalyzer-Diagnostics-\(formatter.string(from: Date())).txt"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
            return url
        } catch {
            return nil
        }
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "yyyy/MM/dd HH:mm:ss"
        return formatter
    }()
}
