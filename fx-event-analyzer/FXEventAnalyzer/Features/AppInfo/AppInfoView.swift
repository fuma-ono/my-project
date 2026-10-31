import StoreKit
import SwiftUI

/// SCR-023 アプリ情報(HQ指示 2026-10-07の参考画像)。アイコンは本アプリのもの
/// (参考画像のアイコンは使わない)。X(Twitter)の公式アカウントは無いので行ごと
/// 外す。公式サイトの行は出しておき、URLが決まるまでは準備中と知らせる
/// (`AppInfo.websiteURL`)。
struct AppInfoView: View {
    @Binding var tabSelection: Int
    @State private var page: Page?
    @State private var showsWebsitePending = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.requestReview) private var requestReview

    /// 行の高さ(HQ指示 2026-10-07「プラン購読管理の各カードの縦幅くらいに」)。
    private static let rowHeight: CGFloat = 33

    enum Page: String, Identifiable, Hashable {
        case license, openSource, libraries, dataSources
        var id: String { rawValue }
    }

    var body: some View {
        V5Viewport {
            V5Header(title: "アプリ情報", back: true, onBack: { dismiss() })
            VStack(spacing: 12) {
                VStack(spacing: 5) {
                    Image("AppInfoIcon")
                        .resizable()
                        .frame(width: 54, height: 54)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(V5P.blue.opacity(0.7), lineWidth: 0.8))
                        .shadow(color: V5P.blue.opacity(0.5), radius: 7)
                        .accessibilityHidden(true)
                    NotoText.text("FX Event Analyzer", size: 12.5)
                        .foregroundStyle(.white)
                        .padding(.top, 4)
                    NotoText.text("バージョン \(AppInfo.version)", size: 8.5)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                }
                .padding(.bottom, 4)

                VStack(spacing: 0) {
                    SettingsListValueRow(title: "ライセンス情報", value: "", height: Self.rowHeight) { page = .license }
                    SettingsListSeparator()
                    SettingsListValueRow(title: "オープンソースライセンス", value: "", height: Self.rowHeight) { page = .openSource }
                    SettingsListSeparator()
                    SettingsListValueRow(title: "利用しているライブラリ", value: "", height: Self.rowHeight) { page = .libraries }
                    SettingsListSeparator()
                    SettingsListValueRow(title: "データの出典", value: "", height: Self.rowHeight) { page = .dataSources }
                }
                .frame(width: 214)
                .background(AccountCardBackground())

                VStack(spacing: 0) {
                    linkRow("公式サイトを開く") {
                        if let url = AppInfo.websiteURL { openURL(url) } else { showsWebsitePending = true }
                    }
                    SettingsListSeparator()
                    linkRow("アプリを評価する") { requestReview() }
                }
                .frame(width: 214)
                .background(AccountCardBackground())

                // HQ指示(2026-10-13): FRB理事の公式写真はFRBのサイトの規約で「出典はFRBと書く」ことに
                // なっているので、ここに出典を書く(写真の出所は backend の assets/speaker-photos/SOURCES.md)。
                NotoText.text("要人の写真: 米国連邦準備制度理事会（FRB）", size: 7)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(width: 214, alignment: .leading)
                    .padding(.leading, 4)
            }
            .accountPinned(top: 64, height: 380)
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .alert("公式サイトは準備中です", isPresented: $showsWebsitePending) {
            Button("OK", role: .cancel) {}
        }
        .navigationDestination(item: $page) { page in
            switch page {
            case .license: LegalDocumentView(document: AppInfo.licenseDocument, tabSelection: $tabSelection)
            case .openSource: OpenSourceLicensesView(tabSelection: $tabSelection)
            case .libraries: LegalDocumentView(document: AppInfo.librariesDocument, tabSelection: $tabSelection)
            case .dataSources: LegalDocumentView(document: AppInfo.dataSourcesDocument, tabSelection: $tabSelection)
            }
        }
    }

    /// 参考画像の水色の文字だけの行(押すと外部を開く)。
    private func linkRow(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            NotoText.text(title, size: SettingsListLayout.rowTitleSize)
                .foregroundStyle(V5P.cyan)
                .padding(.horizontal, 10)
                .frame(width: 214, height: Self.rowHeight, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
        .accessibilityAddTraits(.isLink)
    }
}

/// アプリの版・リンク・ライセンスの情報。
enum AppInfo {
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "-" }
    /// 公式サイトのURL。決まったら入れると「公式サイトを開く」で開く。
    static let websiteURL: URL? = nil

    struct Library: Identifiable {
        let name: String
        let purpose: String
        let license: String
        let copyright: String
        /// アプリに同梱したライセンス全文のファイル名(拡張子なし)。
        let licenseFile: String
        var id: String { name }
    }

    /// 本アプリに組み込まれているもの(supabase-swiftのAuthと、その依存先)。
    static let libraries: [Library] = [
        Library(name: "supabase-swift", purpose: "ログイン・アカウント管理", license: "MIT License", copyright: "Copyright (c) 2021 Supabase", licenseFile: "supabase-swift-LICENSE"),
        Library(name: "swift-crypto", purpose: "暗号処理（supabase-swiftが使用）", license: "Apache License 2.0", copyright: "Copyright (c) Apple Inc. and the SwiftCrypto project authors", licenseFile: "Apache-2.0"),
        Library(name: "swift-asn1", purpose: "暗号処理（swift-cryptoが使用）", license: "Apache License 2.0", copyright: "Copyright (c) Apple Inc. and the SwiftASN1 project authors", licenseFile: "Apache-2.0"),
        Library(name: "swift-http-types", purpose: "通信（supabase-swiftが使用）", license: "Apache License 2.0", copyright: "Copyright (c) Apple Inc. and the Swift HTTP Types project authors", licenseFile: "Apache-2.0"),
        Library(name: "swift-log", purpose: "ログ（supabase-swiftが使用）", license: "Apache License 2.0", copyright: "Copyright (c) Apple Inc. and the Swift Logging API project authors", licenseFile: "Apache-2.0"),
        Library(name: "swift-clocks", purpose: "時間の処理（supabase-swiftが使用）", license: "MIT License", copyright: "Copyright (c) 2022 Point-Free", licenseFile: "swift-clocks-LICENSE"),
        Library(name: "swift-concurrency-extras", purpose: "非同期処理（supabase-swiftが使用）", license: "MIT License", copyright: "Copyright (c) 2023 Point-Free", licenseFile: "swift-concurrency-extras-LICENSE"),
        Library(name: "swift-issue-reporting", purpose: "不具合の検出（supabase-swiftが使用）", license: "MIT License", copyright: "Copyright (c) 2021 Point-Free, Inc.", licenseFile: "swift-issue-reporting-LICENSE"),
        Library(name: "Noto Sans JP", purpose: "日本語フォント", license: "SIL Open Font License 1.1", copyright: "Copyright 2014-2021 Adobe (http://www.adobe.com/)", licenseFile: "NotoSansJP-OFL"),
    ]

    static let licenseDocument = LegalDocument(
        id: "app-license",
        screenTitle: "ライセンス情報",
        title: "FX Event Analyzer",
        sections: [
            .init(heading: "著作権", items: ["本アプリの著作権その他の知的財産権は、運営者または正当な権利者に帰属します。"]),
            .init(heading: "利用の許諾", items: ["本アプリは、利用規約に同意いただいた方に、利用規約の範囲で利用を許諾しています。本アプリの複製、改変、再配布、リバースエンジニアリングは禁止します。"]),
            .init(heading: "第三者の権利", items: ["本アプリには、第三者が著作権を持つオープンソースソフトウェアとフォントが含まれます。それぞれのライセンスは「オープンソースライセンス」でご確認いただけます。"]),
        ],
        footer: ["© 2026 FX Event Analyzer"]
    )

    static let librariesDocument = LegalDocument(
        id: "libraries",
        screenTitle: "利用しているライブラリ",
        title: "利用しているライブラリ",
        sections: libraries.map { library in
            .init(heading: library.name, items: ["用途：\(library.purpose)\nライセンス：\(library.license)"])
        },
        footer: []
    )

    /// データの出典と、各取得元の利用条件で求められている表示(HQ判断 2026-10-16「出典表示と利用条件を実際の画面に反映」)。
    /// 文言の根拠は docs/projects/fx-event-analyzer/data-sources.md 2章・11章。BLS の一文は利用条件の指定どおり英語のまま載せる。
    /// FRED は保存が規約で認められないため使っていない(11章)。使う許可を得たら FRED の指定の一文を足す。
    /// 取得元を契約・変更したら(経済カレンダー・為替)ここも直す。
    static let dataSourcesDocument = LegalDocument(
        id: "data-sources",
        screenTitle: "データの出典",
        title: "データの出典",
        sections: [
            .init(heading: "要人発言の予定・要人の写真", items: [
                "出典：米国連邦準備制度理事会（FRB）",
                "出典：欧州中央銀行（ECB）。ECB の情報は ECB のウェブサイトで無料で入手できます。",
            ]),
            .init(heading: "経済指標の結果の照合", items: [
                "出典：米国労働統計局（BLS）。各指標の発表日に取得しています。",
                "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov.",
                // HQ指示(2026-10-31)「出典表示」: ユーロ圏の経済指標(消費者物価指数・失業率)は
                // Eurostatの公表データを使用。文言はdomain/attribution.tsのEUROSTAT_ATTRIBUTIONと
                // 同じ(iOS側で独自の文言を作らない)。
                "出典：Eurostat（欧州連合統計局）。ユーロ圏の消費者物価指数・失業率に使用しています。",
                "Eurostat の公表データをもとに作成しています。Eurostat は本アプリでの利用について責任を負いません。",
            ]),
            .init(heading: "値動き・pipsについて", items: [
                "値動き（pips・変化率）は、取得した為替レートをもとに本アプリが計算したものです。取得元が提供した値ではありません。",
                "確認できないデータは表示せず、推測で補うこともしません。",
            ]),
        ],
        footer: []
    )

    static func licenseText(_ file: String) -> String {
        guard let url = Bundle.main.url(forResource: file, withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "ライセンス文を読み込めませんでした。" }
        return text
    }
}

/// オープンソースライセンスの一覧。名前をタップすると全文を開く。
struct OpenSourceLicensesView: View {
    @Binding var tabSelection: Int
    @State private var opened: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        V5Viewport {
            V5Header(title: "オープンソースライセンス", back: true, onBack: { dismiss() })
            ScrollView(showsIndicators: false) {
                VStack(spacing: 6) {
                    ForEach(AppInfo.libraries) { library in
                        VStack(alignment: .leading, spacing: 4) {
                            Button {
                                withAnimation(.easeInOut(duration: 0.15)) { opened = opened == library.name ? nil : library.name }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        NotoText.text(library.name, size: 9.5).foregroundStyle(.white)
                                        NotoText.text(library.license, size: 7.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                                    }
                                    Spacer()
                                    Image(systemName: opened == library.name ? "chevron.up" : "chevron.down")
                                        .font(.system(size: 9.5, weight: .semibold))
                                        .foregroundStyle(SettingsCardStyle.chevronColor)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if opened == library.name {
                                // 全文は英語のまま(ライセンスの原文)。英文はシステムのフォントで読みやすく出す。
                                Text(verbatim: library.copyright + "\n\n" + AppInfo.licenseText(library.licenseFile))
                                    .font(.system(size: 6.5))
                                    .foregroundStyle(.white.opacity(0.85))
                                    .fixedSize(horizontal: false, vertical: true)
                                    .padding(.top, 4)
                            }
                        }
                        .padding(10)
                        .frame(width: 214, alignment: .leading)
                        .background(AccountCardBackground())
                    }
                }
                .padding(.vertical, 6)
                .frame(width: V5P.W)
            }
            .frame(width: V5P.W, height: 398)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}
