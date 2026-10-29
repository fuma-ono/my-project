import SwiftUI
import UIKit

/// SCR-009 過去イベント比較。HQ指示(2026-10-14)「ピクセル単位で参考画像を完全再現して」:
/// 上に国旗・指標名・「国旗 国 ｜ 通貨」、その下に過去の発表の表
/// (日時 ⇕ / 結果(実績) / 予想(市場予想) / 前回(前回値) / 1分・5分・15分(pips))。
/// 寸法は参考画像(幅544px)を表の幅214ptに合わせた比率(約0.393)で取っている。
/// 行を押すとその回のイベント詳細(SCR-007)へ。遷移元は指標詳細の「過去イベント比較」。
struct HistoricalComparisonView: View {
    @StateObject private var viewModel: HistoricalComparisonViewModel
    @Binding var tabSelection: Int
    private let apiClient: APIClient
    @State private var planPrompt: String?
    /// 日時の並び(参考画像の「日時 ⇕」)。既定は新しい順。
    @State private var newestFirst = true
    @Environment(\.dismiss) private var dismiss
    /// HQ指示(2026-10-29、7回目)「横画面にしたけど直ってない(表の両サイド・
    /// 日時の余白)」: OSのインターフェース自体を回転させる方式
    /// (`UIWindowScene.requestGeometryUpdate`、旧`OrientationLock.swift`)を
    /// 6回試みたが、実機確認のたびに「ウィンドウの実寸(画像サイズ)は横長に
    /// なるが、中身がPortrait時のレイアウトのまま小さく収まり、新しく
    /// 広がった分が黒いまま」という同じ壊れ方を繰り返した。アクセシビリ
    /// ティツリーの構造面アサーションは毎回パスしていたため「CIのスクリーン
    /// ショット取得タイミングの問題だろう」と判断していたが、実機での
    /// ユーザー確認でも同じ壊れ方が再現したため、その判断自体が誤りだった。
    /// 方針変更: アプリ全体をPortrait固定に戻し(project.yml)、OSの
    /// インターフェース回転には一切頼らない。この画面は端末の物理的な
    /// 向き(`UIDevice.orientation`)だけを見て、中身を`.rotationEffect`で
    /// 見かけ上回転させる(ウィンドウの実寸は常にPortraitのまま変わらない
    /// ため、ジオメトリ更新のタイミング起因の不具合が原理的に起こらない)。
    @State private var deviceOrientation: UIDeviceOrientation = UIDevice.current.orientation

    private var isLandscape: Bool {
        deviceOrientation == .landscapeLeft || deviceOrientation == .landscapeRight
    }

    /// `.landscapeLeft`(Appleの定義: ホームボタン/下端が右に来る向き = 端末を
    /// 反時計回りに90°回した状態)は、中身を時計回り(+90°)に回転させれば
    /// 正立する。`.landscapeRight`はその逆(-90°)。`UIDeviceOrientation`は
    /// 純粋な値なので、回転方向の正しさをレンダリングなしで単体テストできる。
    static func rotationAngle(for orientation: UIDeviceOrientation) -> Angle {
        switch orientation {
        case .landscapeLeft: return .degrees(90)
        case .landscapeRight: return .degrees(-90)
        default: return .degrees(0)
        }
    }

    init(apiClient: APIClient, indicatorId: String, indicatorName: String, fxPairId: String, fxPairSymbol: String, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: HistoricalComparisonViewModel(
            apiClient: apiClient,
            indicatorId: indicatorId,
            indicatorName: indicatorName,
            fxPairId: fxPairId,
            fxPairSymbol: fxPairSymbol
        ))
        _tabSelection = tabSelection
    }

    var body: some View {
        content
            .toolbar(.hidden, for: .navigationBar)
            .task { viewModel.load() }
            .planLimitPrompt($planPrompt, apiClient: apiClient, tabSelection: $tabSelection)
            .onAppear {
                UIDevice.current.beginGeneratingDeviceOrientationNotifications()
                deviceOrientation = UIDevice.current.orientation
            }
            .onDisappear {
                UIDevice.current.endGeneratingDeviceOrientationNotifications()
            }
            .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
                let newOrientation = UIDevice.current.orientation
                // faceUp/faceDown/unknown(テーブルに置いた時など)は向きの
                // 情報として使えないため無視し、直前の状態を維持する。
                guard newOrientation.isValidInterfaceOrientation else { return }
                deviceOrientation = newOrientation
            }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "過去の比較データはまだ利用できません。") }
        case .notFound:
            loadingScaffold { FXEmptyState(icon: "questionmark.circle", title: "データが見つかりません", message: "指定された指標・通貨ペアの組み合わせが存在しません。") }
        case .notEntitled:
            loadingScaffold { FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは過去の比較データを閲覧できません。") }
        case .loaded(let response):
            // HQ指示(2026-10-25、再指示2026-10-26): 横画面では表が縦画面用の
            // V5キャンバス(234×491、`V5Viewport`参照)に収まらないため、
            // 横画面の時は`V5Viewport`のレターボックス表示をやめ、実寸
            // ポイントの専用レイアウト(`landscapeLayout`)に切り替える。
            // アプリ全体はPortrait固定のままなので、`geo.size`は常に縦長
            // (幅<高さ)。横長に組んだ`landscapeLayout`を`geo.size.height`
            // (回転後に横幅として使える寸法)で組み、`.rotationEffect`で
            // 見かけ上回転させてから、外側をPortraitの`geo.size`に収め直す
            // (SwiftUIで「向き固定のまま中身だけ回して見せる」定番の構成)。
            //
            // HQ指摘(2026-10-29)「横画面にした際の黒い画面の部分(右と左)は
            // 実機ではどうなる？黒くなるなら修正して、背景と同じ色で」への
            // 対応で、一度この`GeometryReader`自体に`.ignoresSafeArea()`を
            // 付け、`geo.size`をセーフエリアを除外しない実寸にする変更を
            // 試みたが、HQ再指摘(同日)「Wi-Fiや時間の部分がかぶさってる」の
            // 通り裏目に出た: この画面は物理的にはPortraitのまま
            // (`.rotationEffect`で見かけ上回転させているだけ、ウィンドウ自体は
            // 回転しない)ため、OSが描くステータスバー(時刻・Wi-Fi・バッテリー)は
            // 常にPortrait基準の実位置に居座ったまま。`geo.size`を実寸いっぱいに
            // 広げると、回転後の中身もその実寸いっぱいまで伸びてしまい、
            // ステータスバーの実位置に中身が重なって見えてしまっていた。
            // `.ignoresSafeArea()`は撤回し、`geo.size`は元通りセーフエリアを
            // 除いた寸法に戻した(＝中身の位置・大きさは最初の実装のまま)。
            //
            // 黒帯自体(セーフエリア分、中身が届かない領域)は中身の位置を
            // 変えずに済む方法で解消する: この`GeometryReader`と同じ階層に、
            // 画面全体(セーフエリアを含む実寸いっぱい)を覆う背景色の層を
            // 下敷きとして敷く。`V5Viewport`の背景(`DesignTokens.Colors.
            // backgroundPrimary`、縦画面の既定背景)と同じ色を使うことで、
            // 中身が届かない帯もただの黒ではなく背景色で埋まる。
            ZStack {
                DesignTokens.Colors.backgroundPrimary
                    .ignoresSafeArea()
                GeometryReader { geo in
                    if isLandscape {
                        landscapeLayout(response, availableWidth: geo.size.height)
                            .frame(width: geo.size.height, height: geo.size.width)
                            .rotationEffect(Self.rotationAngle(for: deviceOrientation))
                            .frame(width: geo.size.width, height: geo.size.height)
                            .animation(nil, value: deviceOrientation)
                    } else {
                        V5Viewport {
                            V5Header(title: "過去イベント比較", back: true, onBack: { dismiss() })
                            VStack(alignment: .leading, spacing: 8) {
                                header(response)
                                table(response)
                                if let limit = response.historyLimit, limit.isLimited {
                                    planLimitRow(limit)
                                }
                            }
                            .frame(width: 214)
                            .padding(.top, 8)
                            .frame(width: V5P.W, height: 398, alignment: .top)
                            .position(x: V5P.W / 2, y: 54 + 398 / 2)
                            V5BottomBar(selected: $tabSelection)
                        }
                    }
                }
            }
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    // MARK: - 横画面レイアウト

    /// HQ指示(2026-10-25、再指示2026-10-26)「縦画面に入らないから...この
    /// 画面だけ横画面できるようにしたい」: 縦画面用の表(`table(_:)`、V5
    /// キャンバス単位の小さいフォント・列幅)を使い回さず、実寸ポイントの
    /// 大きめの列幅・フォントで組んだ専用の表(`landscapeTable`)を使う。
    /// 横画面はiPhoneの横幅を活かせるため、列を増やしても基本的に横
    /// スクロール無しで収まる想定。タブバーは表示しない(横画面はこの表を
    /// 見るための一時的な向きという想定 — 他タブへはいったん縦に戻ってから
    /// 移動する)。
    private func landscapeLayout(_ response: ComparisonResponse, availableWidth: CGFloat) -> some View {
        let events = newestFirst
            ? response.events.sorted { $0.releaseDatetime > $1.releaseDatetime }
            : response.events.sorted { $0.releaseDatetime < $1.releaseDatetime }
        let showSecondary = Self.hasSecondaryColumn(events)
        // HQ指摘(2026-10-28、実機確認)「表の両サイドおかしすぎる」: 表の列幅
        // (`LandscapeColumn`)は固定のpt値で組んでいたため、横画面の実際の
        // 横幅(端末やモデルによって異なる、iPhone SEで約660pt〜Proサイズで
        // 約930pt)よりずっと狭い固定幅(前年/前月の有無で484pt/695pt)にしか
        // ならず、`alignment: .center`で中央寄せしても表の両脇に大きな空白が
        // 残っていた。表の内容の自然な幅(`Self.landscapeTableNaturalWidth`)
        // と実際に使える横幅(ここでの`availableWidth`、左右の余白18×2を
        // 引いた値)の比率を列幅の倍率(`columns`)にし、空白が残らないよう
        // 列を実際の横幅いっぱいまで広げる(ただし文字が間延びしすぎない
        // よう最大1.4倍、縮小はしない(最小1.0倍)よう制限する)。
        let naturalWidth = Self.landscapeTableNaturalWidth(showSecondary: showSecondary)
        let targetWidth = availableWidth - 36
        let scale = min(max(targetWidth / naturalWidth, 1.0), 1.4)
        let columns = LandscapeColumns(scale: scale)
        return ZStack {
            V5GlowBackground()
            VStack(alignment: .center, spacing: 12) {
                landscapeTopBar
                // HQ指摘(2026-10-28、実機確認)「ヘッダーが縦画面と異なる」:
                // `landscapeHeader`内の`Spacer(minLength:)`は、親から提案
                // された幅をそのまま引き継ぐ性質があり、ここの親
                // (`alignment: .center`のVStack)は`landscapeTopBar`の末尾の
                // `Spacer()`によって画面幅いっぱいに広がっていたため、
                // `landscapeHeader`自体も画面幅いっぱいまで伸び、指標名(左)と
                // 通貨ペア(右)が画面の両端に離れて見えていた(縦画面では
                // `header(_:)`が表と同じ固定幅のコンテナの中にあるため、
                // ここまで離れない)。表と同じ幅(`columns.totalWidth`)に
                // 明示的に収めることで、縦画面と同じく「表と同じ幅のまとまり」
                // として中央に来るようにした。
                landscapeHeader(response)
                    .frame(width: columns.totalWidth(showSecondary: showSecondary), alignment: .leading)
                landscapeTable(events, unit: response.indicator.unit, showSecondary: showSecondary, columns: columns)
                if let limit = response.historyLimit, limit.isLimited {
                    planLimitRow(limit)
                }
            }
            // HQ指摘(同上)「日時の左部分の余白が広いから狭めて」: 画面端からの
            // 余白を28→18に詰めた(`LandscapeColumns.date`・行の左パディングも
            // 合わせて詰めている、`landscapeTableRow`参照)。
            .padding(.horizontal, 18)
            .padding(.top, 14)
        }
        .ignoresSafeArea()
    }

    /// HQ指摘(2026-10-29)「ヘッダーを＜戻る　過去イベント比較にして(縦画面と
    /// 揃えるように)」: 従来はシェブロンのみ(「戻る」の文字が無い)・
    /// タイトルが左寄せで、縦画面の`V5Header`(＜ 戻る、水色文字＋タイトルは
    /// 全幅中央揃え)と構成が異なっていた。`V5Header`と同じ構成
    /// (戻るボタンとタイトルを別レイヤーのZStackにして、タイトルは
    /// 戻るボタンの有無に関係なく常に中央)に揃えた。
    private var landscapeTopBar: some View {
        ZStack {
            NotoText.text("過去イベント比較", size: 15)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .center)
            HStack(spacing: 0) {
                Button(action: { dismiss() }) {
                    HStack(spacing: 2) {
                        Image(systemName: "chevron.left").font(.system(size: 16, weight: .semibold))
                        NotoText.text("戻る", size: 13)
                    }
                    .foregroundStyle(V5P.cyan)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("戻る")
                .accessibilityIdentifier("historyLandscapeBack")
                Spacer()
            }
        }
        // `.accessibilityElement(children: .contain)`: 中の戻るボタンを個別に
        // タップ可能なまま保ちつつ、このZStack自体もXCUITestから識別子で
        // 問い合わせられる要素にする。
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("historyLandscapeTopBar")
    }

    /// HQ指摘(2026-10-26)「ヘッダーや指標名や国旗マークとかの大きさが
    /// 縦画面と違います。揃えてください」: 縦画面の`header(_:)`はV5キャンバス
    /// 単位(国旗34・名前11等)で書かれており、`V5Viewport`の
    /// `scaleEffect(scale)`(実機ではおよそ1.72倍、`V5P.headerRefScale`参照)
    /// を経て初めて実寸になる。横画面(`landscapeLayout`)は`V5Viewport`を
    /// 経由せず実寸ポイントでそのまま描画するため、`header(_:)`を直接
    /// 呼ぶと見た目が縦画面よりひとまわり小さくなっていた。`header(_:)`と
    /// 同じ構成を`V5P.headerRefScale`倍した専用版を使い、見た目の大きさを
    /// 縦画面と揃えた。
    private func landscapeHeader(_ response: ComparisonResponse) -> some View {
        let scale = V5P.headerRefScale
        let indicator = response.indicator
        let country = indicator.countryCode ?? ""
        let name = CountryFlag.indicatorDisplayText(indicator.name, countryCode: country, displayName: indicator.displayName)
        return HStack(spacing: 8 * scale) {
            CountryFlagView(countryCode: country, diameter: 34 * scale)
            VStack(alignment: .leading, spacing: 3 * scale) {
                NotoText.text(name, size: 11 * scale)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                HStack(spacing: 3 * scale) {
                    NotoText.text(CountryFlag.japaneseName(forCountry: country), size: 8.5 * scale)
                    NotoText.text("｜", size: 8.5 * scale).opacity(0.6)
                    NotoText.text(indicator.currencyCode ?? "", size: 8.5 * scale)
                    Spacer(minLength: 4 * scale)
                    OverlappingPairFlags(symbol: viewModel.fxPairSymbol, diameter: 10 * scale)
                    NotoText.text(Self.pairLabel(viewModel.fxPairSymbol), size: 9 * scale)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }
                .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .frame(height: 36 * scale)
        .padding(.horizontal, 2 * scale)
    }

    /// 横画面の表の列幅。HQ指摘(2026-10-28、実機確認)「表の両サイドが
    /// おかしい」: 固定pt値のままだと実際の横幅よりずっと狭くなるため、
    /// 基準値(`scale`1.0時の値、以前の固定値と同じ)を`landscapeLayout`で
    /// 計算した倍率でまとめて拡大できるようにした。
    private struct LandscapeColumns {
        let scale: CGFloat
        // HQ指摘(2026-10-26)「日時の横の余白枠いらないから消して」:
        // 76ptでもまだ「MM/dd」+「HH:mm」の文字そのものより広く、左右に
        // 余白が残っていた。62に詰めた(`landscapeTableRow`の左パディングも
        // 6→4に詰め、見出しの「日時」ラベルも中央揃えから左揃えに変えて
        // 行のデータと同じ位置に揃えている)。
        var date: CGFloat { 62 * scale }
        var value: CGFloat { 70 * scale }
        var pips: CGFloat { 70 * scale }

        /// 表全体の幅(縦線の分も含む)。`landscapeHeader`を表と同じ幅に
        /// 揃えるため(`landscapeLayout`参照)に使う。
        func totalWidth(showSecondary: Bool) -> CGFloat {
            var width = date + 1 + value * 3 + 1 + pips * 3
            if showSecondary { width += value * 3 + 1 }
            return width
        }
    }

    /// `LandscapeColumns(scale: 1.0)`(以前の固定値)での表全体の幅。
    /// `landscapeLayout`で実際の横幅との比率から`scale`を逆算するための
    /// 基準値として使う。
    private static func landscapeTableNaturalWidth(showSecondary: Bool) -> CGFloat {
        LandscapeColumns(scale: 1.0).totalWidth(showSecondary: showSecondary)
    }

    private func landscapeTable(_ events: [ComparisonEventSummary], unit: String?, showSecondary: Bool, columns: LandscapeColumns) -> some View {
        let shape = RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
        return VStack(spacing: 0) {
            landscapeTableHeader(showSecondary: showSecondary, columns: columns)
            if events.isEmpty {
                NotoText.text("過去の発表はまだありません。", size: 13)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(maxWidth: .infinity, minHeight: 80, alignment: .center)
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                            if index > 0 {
                                Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.6)).frame(height: 0.5)
                            }
                            NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                                landscapeTableRow(event, unit: unit, showSecondary: showSecondary, columns: columns)
                            }
                            .buttonStyle(SettingsRowPressStyle())
                            .accessibilityIdentifier("historyEventRow")
                        }
                    }
                }
                .frame(maxHeight: 250)
            }
        }
        .background(V5CardGradient.fill)
        .clipShape(shape)
        .overlay(shape.stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    /// HQ指示(2026-10-25)「過去イベント比較は前年の結果予想前回、前月の
    /// 結果予想前回が必要」: 列見出しの上にもう1段、グループ見出し
    /// (「前年」「前月」)を出して2つの結果/予想/前回を区別する。
    /// HQ指示(2026-10-26)「前年前月の線がないので結果、前回の縦線を伸ばして
    /// ください」(縦画面向けの対応を横画面にも同様に適用): グループ見出し
    /// 行〜列見出し行〜各データ行まで実際の縦線(`landscapeGroupDivider`)が
    /// つながるようにした。
    private func landscapeGroupHeaderRow(showSecondary: Bool, columns: LandscapeColumns) -> some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: columns.date)
            landscapeGroupDivider
            landscapeGroupLabel("前年", width: columns.value * 3)
            if showSecondary {
                landscapeGroupDivider
                landscapeGroupLabel("前月", width: columns.value * 3)
            }
            landscapeGroupDivider
            Color.clear.frame(width: columns.pips * 3)
        }
        .frame(height: 20)
    }

    private var landscapeGroupDivider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 1, height: 20)
    }

    /// `landscapeTableRow`(行の高さ44)用の縦線。`landscapeGroupDivider`
    /// (グループ見出し行の高さ20専用)とは高さが異なるため別に用意し、
    /// グループ見出し行〜列見出し行〜各データ行まで同じ横位置で縦線が
    /// 一直線につながるようにした(HQ指示 2026-10-26「結果、前回の縦線を
    /// 伸ばしてください」、縦画面向けの対応を横画面にも適用)。
    private var landscapeRowDivider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.5)).frame(width: 1, height: 44)
    }

    private func landscapeGroupLabel(_ title: String, width: CGFloat) -> some View {
        NotoText.text(title, size: 11)
            .foregroundStyle(SettingsCardStyle.subtitleColor)
            .frame(width: width, alignment: .center)
    }

    private func landscapeTableHeader(showSecondary: Bool, columns: LandscapeColumns) -> some View {
        VStack(spacing: 0) {
            landscapeGroupHeaderRow(showSecondary: showSecondary, columns: columns)
            HStack(spacing: 0) {
                Button { newestFirst.toggle() } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "calendar").font(.system(size: 12, weight: .semibold))
                        NotoText.text("日時", size: 13)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    // HQ指摘(2026-10-26)「日時の横の余白枠いらない」:
                    // 既定(中央揃え)のままだと、下の各行の日時(左揃え、
                    // `landscapeTableRow`参照)とずれて、見出しの左右に
                    // 余白の箱があるように見えていた。行と同じ左揃え+
                    // 同じ左パディングに揃えた。
                    .padding(.leading, 4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // HQ指摘(2026-10-29)「タブ部分の縦線がバラバラ」: 固定幅の
                // `.frame(width:)`をボタンのラベル(内側)に付けていたため、
                // `Button`自体の実際のレイアウト上の幅がラベルの意図した
                // 幅と微妙にずれ(ボタンのタップ領域確保などの影響)、直後の
                // `landscapeDivider`の位置が`landscapeGroupHeaderRow`側の
                // 縦線(`Color.clear.frame(width: columns.date)`基準)と
                // 1px未満だけずれて二重線に見えていた。固定幅はラベルでは
                // なくボタン自体(外側)に付け、ラベル側は`maxWidth: .infinity`
                // で内側を埋めるだけにすることで、他の行の`columns.date`幅の
                // 要素と全く同じ幅計算になるようにした。
                .frame(width: columns.date, height: 40)
                .accessibilityLabel(newestFirst ? "日時 新しい順" : "日時 古い順")
                landscapeDivider
                landscapeHeaderCell("結果", "(実績)", width: columns.value)
                landscapeHeaderCell("予想", "(市場予想)", width: columns.value)
                landscapeHeaderCell("前回", "(前回値)", width: columns.value)
                if showSecondary {
                    landscapeDivider
                    landscapeHeaderCell("結果", "(実績)", width: columns.value)
                    landscapeHeaderCell("予想", "(市場予想)", width: columns.value)
                    landscapeHeaderCell("前回", "(前回値)", width: columns.value)
                }
                landscapeDivider
                landscapeHeaderCell("1分", "(pips)", width: columns.pips)
                landscapeHeaderCell("5分", "(pips)", width: columns.pips)
                landscapeHeaderCell("15分", "(pips)", width: columns.pips)
            }
            .frame(height: 40)
        }
        .background(Self.headerFill)
        .overlay(alignment: .bottom) {
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
        }
    }

    private var landscapeDivider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 1, height: 40)
    }

    /// HQ指摘(2026-10-29)「表の中の位置がバラバラ」: pipsの見出し(「1分」等)は
    /// 中央揃えのままだったが、対応するデータ(`landscapePipsCell`)は符号を
    /// 右端で揃えるため右揃え+右パディング4になっており、見出しとデータの
    /// 横位置がずれていた。一度は見出し側を右揃えに合わせたが、HQ指摘
    /// (2026-10-29、再指摘)「1分5分15分の部分が数字ともに右に寄りすぎて
    /// いておかしい」: pips列は幅に対して数字自体が短いため、右揃えだと
    /// 見出し・データとも列の右端に寄りすぎて列内の左側に不自然な余白が
    /// 残る見た目になっていた。右揃えではなく、結果/予想/前回と同じ中央
    /// 揃えに統一する方向で解決した(`landscapePipsCell`側も中央揃えに
    /// 変更、右パディングを撤廃)。
    private func landscapeHeaderCell(_ title: String, _ subtitle: String, width: CGFloat) -> some View {
        VStack(spacing: 2) {
            NotoText.text(title, size: 13).foregroundStyle(.white)
            NotoText.text(subtitle, size: 9)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(width: width, height: 40)
    }

    private func landscapeTableRow(_ event: ComparisonEventSummary, unit: String?, showSecondary: Bool, columns: LandscapeColumns) -> some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(Self.dateString(event.releaseDatetime))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Text(Self.timeString(event.releaseDatetime))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Self.timeColor)
            }
            .monospacedDigit()
            .padding(.leading, 4)
            .frame(width: columns.date, alignment: .leading)
            landscapeRowDivider
            landscapeValueCell(event.actual, unit: unit, width: columns.value)
            landscapeValueCell(event.forecast, unit: unit, width: columns.value)
            landscapeValueCell(event.previous, unit: unit, width: columns.value)
            if showSecondary {
                landscapeRowDivider
                landscapeValueCell(event.secondaryActual, unit: unit, width: columns.value)
                landscapeValueCell(event.secondaryForecast, unit: unit, width: columns.value)
                landscapeValueCell(event.secondaryPrevious, unit: unit, width: columns.value)
            }
            landscapeRowDivider
            landscapePipsCell(event.pipsByTimeframe?["1m"] ?? nil, width: columns.pips)
            landscapePipsCell(event.pipsByTimeframe?["5m"] ?? nil, width: columns.pips)
            landscapePipsCell(event.pipsByTimeframe?["15m"] ?? nil, width: columns.pips)
        }
        .frame(height: 44)
        .contentShape(Rectangle())
    }

    private func landscapeValueCell(_ value: Double?, unit: String?, width: CGFloat) -> some View {
        Text(Self.valueText(value, unit: unit))
            .font(.system(size: 13, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(width: width)
    }

    /// HQ指摘(2026-10-29)「1分5分15分の部分が数字ともに右に寄りすぎて
    /// いておかしい」: 右揃え+右パディング4だったため、見出し
    /// (`landscapeHeaderCell`)も右揃えに合わせた直後に、列の右端へ寄り
    /// すぎて不自然という指摘を受けた。結果/予想/前回(`landscapeValueCell`)
    /// と同じ中央揃えに変更した。
    private func landscapePipsCell(_ pips: Double?, width: CGFloat) -> some View {
        Text(Self.pipsText(pips))
            .font(.system(size: 13, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(pips.map { $0 >= 0 ? Self.plusColor : Self.minusColor } ?? SettingsCardStyle.subtitleColor)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(width: width)
    }

    /// 副指標(api-design v1.35、HQ指示2026-10-25「前年の結果予想前回、前月の
    /// 結果予想前回が必要」)の列が無い指標(米国CPI以外)では非表示にする —
    /// `secondaryActual`・`secondaryForecast`・`secondaryPrevious`のいずれかが
    /// ある行が1件もない場合は列ごと隠す。
    private static func hasSecondaryColumn(_ events: [ComparisonEventSummary]) -> Bool {
        events.contains { $0.secondaryActual != nil || $0.secondaryForecast != nil || $0.secondaryPrevious != nil }
    }

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: @escaping () -> some View) -> some View {
        V5Viewport {
            V5Header(title: "過去イベント比較", back: true, onBack: { dismiss() })
            content()
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            V5BottomBar(selected: $tabSelection)
        }
    }

    // MARK: - 見出し(国旗・指標名・国｜通貨)

    private func header(_ response: ComparisonResponse) -> some View {
        let indicator = response.indicator
        let country = indicator.countryCode ?? ""
        let name = CountryFlag.indicatorDisplayText(indicator.name, countryCode: country, displayName: indicator.displayName)
        // 2026-10-14: 文字を大きくしたら指標名が通貨ペアに押されて「消費者物価指数（C…」と切れたので、
        // 通貨ペアは2行目(国｜通貨)の右端に置き、指標名は1行目を全部使う。
        return HStack(spacing: 8) {
            // 2026-10-14「指標名と国旗はイベント詳細と同じ大きさに」: 国旗34・名前11。
            CountryFlagView(countryCode: country, diameter: 34)
            VStack(alignment: .leading, spacing: 3) {
                NotoText.text(name, size: 11)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                HStack(spacing: 3) {
                    // 「米国の横の小さい国旗は消して」(2026-10-14)。
                    NotoText.text(CountryFlag.japaneseName(forCountry: country), size: 8.5)
                    NotoText.text("｜", size: 8.5).opacity(0.6)
                    NotoText.text(indicator.currencyCode ?? "", size: 8.5)
                    Spacer(minLength: 4)
                    // HQ指示(2026-10-14)「通貨ペア名を出して」: 表のpipsがどのペアの値動きかを示す。
                    // 見た目はイベント詳細の値動き表のペア(重ねた国旗+USD/JPY)と同じ。
                    OverlappingPairFlags(symbol: viewModel.fxPairSymbol, diameter: 10)
                    NotoText.text(Self.pairLabel(viewModel.fxPairSymbol), size: 9)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }
                .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .frame(height: 36)
        .padding(.horizontal, 2)
    }

    /// 「USDJPY」「USD/JPY」のどちらでも「USD/JPY」にする。
    static func pairLabel(_ symbol: String) -> String {
        let compact = symbol.replacingOccurrences(of: "/", with: "")
        guard compact.count == 6 else { return symbol }
        return "\(compact.prefix(3))/\(compact.suffix(3))"
    }

    // MARK: - 表

    /// 列の幅(参考画像の比率: 日時110px・数値3列235px・pips3列199px → 43 / 30.7×3 / 26×3)。
    /// 2026-10-14: 文字を8.5にしたらpips(「-24.5」)が詰まって見えたので、数値列を少し狭めてpips列を広げた。
    private enum Column {
        static let date: CGFloat = 40
        static let value: CGFloat = 28
        static let pips: CGFloat = 30
    }

    private static let headerFill = Color(red: 0.06, green: 0.17, blue: 0.33)
    private static let tableFill = Color(red: 0.02, green: 0.09, blue: 0.20)
    private static let timeColor = Color(red: 0.36, green: 0.63, blue: 0.95)
    // HQ指示(2026-10-14)「プラスが赤・マイナスが緑」: イベント詳細など他の画面と同じ色。
    private static let plusColor = HomeView.changeUpColor
    private static let minusColor = HomeView.changeDownColor

    /// 表の列を全部並べた時の本来の幅。現在は214相当(日時40+区切り0.5+
    /// 数値3列84+区切り0.5+pips3列90)で、過去イベント比較の表示幅(214)と
    /// ほぼ一致するが、この先列が増えれば(例: 前月・前年の追加)この値も
    /// 自動的に大きくなる — 下の`table(_:)`はこの値を表の実寸として使い、
    /// 表示幅(214)に収まらない分は横スクロールで見せる。
    /// `includeSecondary`: 前年(結果/予想/前回)に加え、前月(結果/予想/前回)
    /// の3列も含めるか(HQ指示2026-10-25「前年の結果予想前回、前月の結果
    /// 予想前回が必要」) — 含める場合、区切り線がもう1本増える。
    private static func tableContentWidth(includeSecondary: Bool) -> CGFloat {
        let dividers: CGFloat = includeSecondary ? 1.5 : 1.0
        return Column.date + dividers + Column.value * (includeSecondary ? 6 : 3) + Column.pips * 3
    }

    /// HQ指示(2026-10-25)「縦画面に入らないから縦画面の場合は横スクロールで
    /// pipsが見えるようにして」: 表の本来の幅(`tableContentWidth`)が表示幅
    /// (214)を超えても列を切り詰めず、`ScrollView(.horizontal)`で表全体を
    /// 横にスクロールできるようにした(以前は`.frame(width: 214)`で強制的に
    /// 切り詰めていたため、列を増やすと右側のpipsが見えなくなっていた)。
    private func table(_ response: ComparisonResponse) -> some View {
        let events = newestFirst
            ? response.events.sorted { $0.releaseDatetime > $1.releaseDatetime }
            : response.events.sorted { $0.releaseDatetime < $1.releaseDatetime }
        let unit = response.indicator.unit
        let shape = RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
        // HQ指示(2026-10-25)「過去イベント比較は前年の結果予想前回、前月の
        // 結果予想前回が必要」: 副指標(米国CPIのMoM%)がある指標だけ「前月」の
        // 結果/予想/前回の3列を出す(api-design v1.35)。
        let showSecondary = Self.hasSecondaryColumn(events)
        let height = Self.tableHeight(
            rows: events.count,
            limited: response.historyLimit?.isLimited == true,
            showSecondary: showSecondary
        )
        let tableBody = VStack(spacing: 0) {
            tableHeader(showSecondary: showSecondary)
            if events.isEmpty {
                // ユーザー指摘(2026-10-20)「過去の発表はまだありませんの文字の
                // 位置がおかしい、下すぎる」: 以前はScrollViewの中に
                // `minHeight: 36`で置いていたため、表の実際の高さ(0件時は
                // ヘッダーを除くと約22.5pt)より中身の希望高さの方が大きく、
                // ScrollViewの中でコンテンツが窮屈にはみ出し、文字が本来の
                // 表示領域からズレて見えていた。ScrollViewの外に出し、
                // 残りの領域いっぱいに`.center`で配置することで、表の
                // 実際の高さに関わらず常に中央に来るようにした。
                NotoText.text("過去の発表はまだありません。", size: 7)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(maxHeight: .infinity, alignment: .center)
                    .frame(width: Self.tableContentWidth(includeSecondary: showSecondary))
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                            if index > 0 {
                                Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.6)).frame(height: 0.5)
                            }
                            NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                                tableRow(event, unit: unit, showSecondary: showSecondary)
                            }
                            .buttonStyle(SettingsRowPressStyle())
                            .accessibilityIdentifier("historyEventRow")
                        }
                    }
                }
            }
        }
        .frame(height: height, alignment: .top)
        // HQ指示(2026-10-15): 表の外枠もグラデーションに(見出しの帯は今の色のまま)。
        .background(V5CardGradient.fill)
        .clipShape(shape)
        .overlay(shape.stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))

        // HQ指示(2026-10-26)「横スクロールバーを下に表示させてください」:
        // 列が多く(前年/前月+pips)横に隠れていることに気づきにくいため、
        // スクロールバーを常に表示するようにした。
        return ScrollView(.horizontal, showsIndicators: true) {
            tableBody
        }
        .frame(width: 214, height: height, alignment: .topLeading)
    }

    /// 表の高さ。行が少なければ行の分だけ、多ければ画面に入る高さで止めて中をスクロールする。
    /// `showSecondary`: 前年/前月のグループ見出し行(`groupHeaderHeight`)が
    /// 付く分、表全体の高さも増える(HQ指示2026-10-25)。
    ///
    /// HQ指摘(2026-10-28、実機確認)「8/7の行が常時見切れている」: 行の積算
    /// (`rowHeight + 0.5`)だけでちょうどの高さを計算し、`.frame(height:)`+
    /// `.clipShape`で表の外枠を切り詰めていたため、最終行(特にロック印の
    /// アイコンなど)が外枠ぴったりの境界に接しており、実機のレンダリングで
    /// わずかにはみ出た分がそのまま切り取られていた(シミュレータのスクリー
    /// ンショットでは出ない、この画面特有の実機差異)。行数に関わらず一定の
    /// 余白(`bottomSafetyMargin`)を高さに足し、最終行と外枠の間に常に隙間が
    /// 残るようにした。
    static func tableHeight(rows: Int, limited: Bool, showSecondary: Bool) -> CGFloat {
        let header = headerHeight + (showSecondary ? groupHeaderHeight : 0)
        let content = header + CGFloat(max(rows, 1)) * (rowHeight + 0.5) + bottomSafetyMargin
        return min(content, limited ? 312 : 334)
    }

    private static let bottomSafetyMargin: CGFloat = 4

    /// HQ指示(2026-10-14)「参考画像と比べて文字が小さすぎる。枠も小さい。見やすく」:
    /// 見出し20→26・行18→24、文字は表の見出し6.5→8.5・数字6.5→8.5・時刻5→6.5に上げた。
    /// 2026-10-14(2回目)の指定: 見出し・日付・数値・pips 7、見出しの下の小さな字 5、見出しの帯24・行22。
    static let headerHeight: CGFloat = 24
    static let rowHeight: CGFloat = 22
    /// HQ指示(2026-10-25)「前年の結果予想前回、前月の結果予想前回が必要」:
    /// 2つの結果/予想/前回を区別するグループ見出し行(「前年」「前月」)の高さ。
    static let groupHeaderHeight: CGFloat = 11

    /// HQ指示(2026-10-25): 列見出しの上にグループ見出し行を出して、
    /// 前年の結果/予想/前回と前月の結果/予想/前回を区別する。
    /// HQ指示(2026-10-26)「前年前月の線がないので結果、前回の縦線を伸ばして
    /// ください」: 以前はこの行に実際の区切り線が無く(`Color.clear`の余白
    /// だけ)、下の`tableHeader`側の区切り線ともつながっていなかったため、
    /// 「前年」「前月」の境目が分かりにくかった。`tableHeader`・`tableRow`と
    /// 同じ位置に実際の縦線(`groupDivider`)を置き、グループ見出し行〜列見出し
    /// 行〜各データ行まで縦線が一直線につながるようにした。
    private func groupHeaderRow(showSecondary: Bool) -> some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: Column.date)
            groupDivider
            groupLabel("前年", width: Column.value * 3)
            if showSecondary {
                groupDivider
                groupLabel("前月", width: Column.value * 3)
            }
            groupDivider
            Color.clear.frame(width: Column.pips * 3)
        }
        .frame(height: Self.groupHeaderHeight)
    }

    private var groupDivider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 0.5, height: Self.groupHeaderHeight)
    }

    private func groupLabel(_ title: String, width: CGFloat) -> some View {
        NotoText.text(title, size: 6)
            .foregroundStyle(SettingsCardStyle.subtitleColor)
            .frame(width: width, alignment: .center)
    }

    private func tableHeader(showSecondary: Bool) -> some View {
        VStack(spacing: 0) {
            groupHeaderRow(showSecondary: showSecondary)
            HStack(spacing: 0) {
                Button { newestFirst.toggle() } label: {
                    HStack(spacing: 2) {
                        Image(systemName: "calendar").font(.system(size: 6.5, weight: .semibold))
                        NotoText.text("日時", size: 7)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 5, weight: .bold))
                    }
                    .foregroundStyle(.white)
                    .frame(width: Column.date, height: Self.headerHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(newestFirst ? "日時 新しい順" : "日時 古い順")
                divider
                headerCell("結果", "(実績)", width: Column.value)
                headerCell("予想", "(市場予想)", width: Column.value)
                headerCell("前回", "(前回値)", width: Column.value)
                // HQ指示(2026-10-25)「前年の結果予想前回、前月の結果予想前回が
                // 必要」: 副指標(米国CPIのMoM%)がある指標だけ、同じ3列構成を
                // もう1組出す(`groupHeaderRow`の「前月」label と対になる)。
                if showSecondary {
                    divider
                    headerCell("結果", "(実績)", width: Column.value)
                    headerCell("予想", "(市場予想)", width: Column.value)
                    headerCell("前回", "(前回値)", width: Column.value)
                }
                divider
                headerCell("1分", "(pips)", width: Column.pips)
                headerCell("5分", "(pips)", width: Column.pips)
                headerCell("15分", "(pips)", width: Column.pips)
            }
            .frame(height: Self.headerHeight)
        }
        .background(Self.headerFill)
        .overlay(alignment: .bottom) {
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
        }
    }

    private var divider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 0.5, height: Self.headerHeight)
    }

    private func headerCell(_ title: String, _ subtitle: String, width: CGFloat) -> some View {
        VStack(spacing: 0) {
            NotoText.text(title, size: 7).foregroundStyle(.white)
            NotoText.text(subtitle, size: 5)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(width: width, height: Self.headerHeight)
    }

    private func tableRow(_ event: ComparisonEventSummary, unit: String?, showSecondary: Bool) -> some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text(Self.dateString(event.releaseDatetime))
                    .font(.system(size: 7, weight: .semibold))
                    .foregroundStyle(.white)
                Text(Self.timeString(event.releaseDatetime))
                    .font(.system(size: 5.5, weight: .medium))
                    .foregroundStyle(Self.timeColor)
            }
            .monospacedDigit()
            .padding(.leading, 5)
            .frame(width: Column.date, alignment: .leading)
            // HQ指示(2026-10-26)「結果、前回の縦線を伸ばしてください」:
            // 列見出し(`tableHeader`)と同じ位置に縦線を入れ、グループ見出し行
            // 〜列見出し行〜各データ行まで縦線がつながって見えるようにした。
            rowDivider
            if event.isLocked {
                // 無料プランで隠された過去の発表(HQ指示 2026-10-22): 値・前月比・pipsの代わりに鍵の印。
                // 行を押すと従来どおりイベント詳細へ進み、そこで鍵の印とプランの案内が出る。
                // 幅は、隠した列(値3列・前月比3列・pips3列)と、その間の縦線を合わせたもの。
                PastReleaseLockBadge(size: 7)
                    .frame(width: Column.value * (showSecondary ? 6 : 3) + Column.pips * 3 + (showSecondary ? 1.0 : 0.5))
                    .accessibilityIdentifier("historyLockedRow")
            } else {
                valueCell(event.actual, unit: unit)
                valueCell(event.forecast, unit: unit)
                previousCell(event.previous, unit: unit, locked: event.isPreviousLocked)
                if showSecondary {
                    rowDivider
                    valueCell(event.secondaryActual, unit: unit)
                    valueCell(event.secondaryForecast, unit: unit)
                    // 副指標の前回(secondary_previous)も、ひとつ前のロックされた発表の値なので同じく隠す(v1.36)。
                    previousCell(event.secondaryPrevious, unit: unit, locked: event.isPreviousLocked)
                }
                rowDivider
                pipsCell(event.pipsByTimeframe?["1m"] ?? nil)
                pipsCell(event.pipsByTimeframe?["5m"] ?? nil)
                pipsCell(event.pipsByTimeframe?["15m"] ?? nil)
            }
        }
        .frame(height: Self.rowHeight)
        .contentShape(Rectangle())
    }

    private var rowDivider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.5)).frame(width: 0.5, height: Self.rowHeight)
    }

    /// 前回の列。ひとつ前の発表が無料プランでロックされているとき(`previous_locked`)は鍵の印(HQ指示 2026-10-22)。
    @ViewBuilder private func previousCell(_ value: Double?, unit: String?, locked: Bool) -> some View {
        if locked {
            Image(systemName: "lock.fill")
                .font(.system(size: 6, weight: .semibold))
                .foregroundStyle(V5P.cyan)
                .frame(width: Column.value)
                .accessibilityLabel(PastReleaseLock.label)
        } else {
            valueCell(value, unit: unit)
        }
    }

    private func valueCell(_ value: Double?, unit: String?) -> some View {
        Text(Self.valueText(value, unit: unit))
            .font(.system(size: 7, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(width: Column.value)
    }

    private func pipsCell(_ pips: Double?) -> some View {
        Text(Self.pipsText(pips))
            .font(.system(size: 7, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(pips.map { $0 >= 0 ? Self.plusColor : Self.minusColor } ?? SettingsCardStyle.subtitleColor)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.trailing, 2)
            .frame(width: Column.pips, alignment: .trailing)
    }

    private func planLimitRow(_ limit: ComparisonResponse.HistoryLimit) -> some View {
        Button {
            planPrompt = "無料プランで比べられるのは、直近\(limit.maxForPlan)回分です。プレミアムプランなら\(limit.proMax)回分(約5年)と比べられます。"
        } label: {
            HStack(spacing: 3) {
                Image(systemName: "lock.fill").font(.system(size: 5.5))
                NotoText.text("無料プランは直近\(limit.maxForPlan)回分です。プレミアムなら\(limit.proMax)回分", size: 6.5)
                Image(systemName: "chevron.right").font(.system(size: 5.5, weight: .semibold))
            }
            .foregroundStyle(V5P.cyan)
        }
        .buttonStyle(.plain)
        .padding(.leading, 4)
    }

    // MARK: - 書式

    /// 「3.1%」のように、小数は最大2桁で末尾の0を省く。単位(%)はそのまま後ろに付ける。
    static func valueText(_ value: Double?, unit: String?) -> String {
        guard let value else { return "--" }
        let number = Self.numberFormatter.string(from: NSNumber(value: value)) ?? "\(value)"
        guard let unit, unit == "%" else { return number }
        return number + unit
    }

    /// 「+2.1」「-8.2」(小数1桁、符号付き)。
    static func pipsText(_ pips: Double?) -> String {
        guard let pips else { return "--" }
        return String(format: "%+.1f", pips)
    }

    private static let numberFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.minimumFractionDigits = 1
        formatter.maximumFractionDigits = 2
        formatter.minimumIntegerDigits = 1
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM/dd"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    @MainActor private static func dateString(_ date: Date) -> String {
        // 表示設定の日付の形式(年なし)とタイムゾーン(HQ指示 2026-10-15)。
        AppPreferences.shared.shortDateString(date)
    }

    @MainActor private static func timeString(_ date: Date) -> String {
        // 表示設定の時刻の形式(24時間/12時間)とタイムゾーン(HQ指示 2026-10-15)。
        AppPreferences.shared.timeString(date)
    }
}
