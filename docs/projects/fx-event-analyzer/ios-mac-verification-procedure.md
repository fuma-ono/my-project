# iOS実機検証の準備: Mac/Xcodeでの具体的な手順(HQ指示2026-10-17「iOS検証の準備」への回答)

作成: 2026-10-17。**本ドキュメントの手順は、Mac環境が無いこのセッションでは実行できていない
(手順の整理のみ)。** 実際に実行した結果は含まない。実行できたこと/できなかったことは
`data-quality-verification-2026-10-17.md` を参照。

## 1. Xcodeが必要なテスト と Backendだけで確認できるテストの区分

| # | 確認対象 | Xcode/Mac必須か | 実行方法 | このセッションでの実施状況 |
|---|---|---|---|---|
| 1 | 1分/5分/15分の**集計ロジック**の整合性(open/close/high/low、欠損時の扱い) | 不要 | `cd fx-event-analyzer-backend && npm test` | **実施済み**(697件中含む、全件成功。前回報告) |
| 2 | 時刻・タイムゾーン・DST境界の整合性(ロジック) | 不要 | 同上(`tests/domain/timezone.test.ts`) | **実施済み** |
| 3 | APIクレジット上限800/700の維持(ロジック) | 不要 | 同上(`tests/ingestion/fxGapRepair.test.ts`の credit ledger グループ) | **実施済み** |
| 4 | 複数ユーザーのデータ分離(RLS、DB側) | 不要(ただしDocker必須。CIでは実行済み) | `npm run -s ingest:...`系ではなく`npx vitest run tests/integration`(ローカルSupabase必須) | **CIでの既存実行結果を確認済み**(前回報告、183件成功)。本セッションでの新規実行は不可(Docker daemon未稼働) |
| 5 | 品質レポートの分類ロジック(自己一致/独立照合/差異) | 不要 | `npm test`(`tests/ingestion/dataQuality.test.ts`) | **実施済み** |
| 6 | 品質レポートの実データでの表示確認 | 不要(ブラウザのみ) | `/api/v1/quality-report?token=...` をブラウザで開く | **未実施**(開発DBの認証情報がこのセッションに無い) |
| 7 | 画面遷移・レイアウト(SCR-000〜SCR-026) | **Xcode/Mac必須**(Simulator) | 既存の`FXEventAnalyzerUIScreenshots`スキーム(モックサーバー使用) | **未実施**(このセッションにXcodeが無い) |
| 8 | ViewModelのエラー処理(単体テスト) | **Xcode/Mac必須** | `FXEventAnalyzerTests` | **未実施** |
| 9 | 実データでの1分/5分/15分の**表示** | **Xcode/Mac必須**(実機/Simulatorの手動操作) | §3参照 | **未実施** |
| 10 | 通信失敗/データなし/更新遅延の**画面表示** | **Xcode/Mac必須** | §4参照 | **未実施** |
| 11 | 複数端末・複数ユーザーのデータ分離(**UI側**の見え方) | **Xcode/Mac必須** | §5参照 | **未実施**(DB側のRLSは4で確認済み。UI側の見え方は別途確認が必要) |

## 2. 前提(Macで一度だけ行う準備)

```sh
# XcodeGenが無ければ
brew install xcodegen

cd fx-event-analyzer
xcodegen generate   # project.yml から .xcodeproj を生成
```

## 3. レイアウト確認(モックデータ、$0、既存のCIと同じ内容をMacで再現)

```sh
# 1. モックサーバーを起動(別ターミナル)
cd fx-event-analyzer-backend
node scripts/ui-screenshot-mock-server.mjs 8090

# 2. ビルド(iPhoneシミュレータ名は `xcrun simctl list devices available` で確認)
cd ../fx-event-analyzer
xcodebuild build-for-testing \
  -project FXEventAnalyzer.xcodeproj \
  -scheme FXEventAnalyzerUIScreenshots \
  -destination "platform=iOS Simulator,name=<iPhoneシミュレータ名>" \
  -derivedDataPath DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  SUPABASE_URL="http://127.0.0.1:8090" \
  SUPABASE_ANON_KEY="ui-screenshot-mock-anon-key" \
  API_BASE_URL="http://127.0.0.1:8090/api/v1"

# 3. 実行(スクリーンショットは .xcresult に保存される)
xcodebuild test-without-building \
  -project FXEventAnalyzer.xcodeproj \
  -scheme FXEventAnalyzerUIScreenshots \
  -destination "platform=iOS Simulator,name=<iPhoneシミュレータ名>" \
  -derivedDataPath DerivedData \
  -resultBundlePath DerivedData/iPhone.xcresult \
  CODE_SIGNING_ALLOWED=NO

# 4. 結果を見る(Xcodeが.xcresultを開き、スクリーンショットを一覧表示する)
open DerivedData/iPhone.xcresult
```

**これはモックデータでの確認であり、実データの正確性は確認できない**(表1の既知の限界)。

### 3.1 ViewModelの単体テスト(`FXEventAnalyzerTests`、モック・Xcode必須)

`project.yml`で確認した実際のスキーム構成どおり、`FXEventAnalyzer`スキームの Test Action が
`FXEventAnalyzerTests`ターゲットを対象にしている(`FXEventAnalyzerUITests`とは別ターゲット)。

```sh
xcodebuild test \
  -project FXEventAnalyzer.xcodeproj \
  -scheme FXEventAnalyzer \
  -destination "platform=iOS Simulator,name=<iPhoneシミュレータ名>" \
  -only-testing:FXEventAnalyzerTests \
  CODE_SIGNING_ALLOWED=NO
```

通信失敗・データなしの扱いを確認する既存テスト(ソースコード上で確認済み。コマンドは未実行):
`HomeViewModelTests.testLoadOtherFailureShowsGenericError`、
`Phase3ViewModelTests.testLoadGenericErrorShowsErrorState`、
`Phase3ViewModelTests.testLoadNotFoundIndicatorShowsError`。

## 4. 実データでの1分/5分/15分足の確認(dev環境、追加費用0円 — 既存のRender無料プラン+既存の開発Supabaseを使うだけ)

既存の`dev-environment.md` §4・§5に記載の、既に動いている構成を使う(新規インフラ不要)。

```sh
xcodebuild build-for-testing \
  -project FXEventAnalyzer.xcodeproj \
  -scheme FXEventAnalyzer \
  -destination "platform=iOS Simulator,name=<iPhoneシミュレータ名>" \
  -derivedDataPath DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  SUPABASE_URL="https://<開発用Supabaseプロジェクト>.supabase.co" \
  SUPABASE_ANON_KEY="<開発用anon鍵>" \
  API_BASE_URL="https://<既存のRenderサービス名>.onrender.com/api/v1"
```

ビルド後、Xcodeから実行(Cmd+R)するか、`xcrun simctl install`/`launch`でシミュレータへ入れて
実際に操作する。確認方法:

1. 新規または既存の確認用アカウント(`dev-check@fx-event-analyzer.invalid`、dev-environment.md
   §5)でログインする。
2. 指標詳細→イベント詳細→相場反応詳細(SCR-008)へ進み、1分/5分/15分の値動き(pips)・
   表示時刻を確認する。
3. 同じ発表回・同じ通貨ペアについて、ブラウザで`/api/v1/quality-report`(トークンが設定済みの
   場合)を開き、品質レポート側の数値(差異あり一覧・異常値一覧)と矛盾しないか比較する。
4. Render無料プランは15分アクセスが無いと休止する(dev-environment.md §4)。アプリを開く前に
   `https://<名前>.onrender.com/health`を一度開いて起こしておくと、最初の確認がタイムアウトしにくい。

## 5. 通信失敗・データなし・更新遅延の画面表示の確認方法(追加費用0円)

| 状態 | 確認方法 |
|---|---|
| **通信失敗** | ①§4の設定でアプリを起動した後、Macのネットワーク(Wi-Fi)を切る、または`API_BASE_URL`を一時的に存在しないURL(例: `https://127.0.0.1:9`)に変えて再ビルドし、画面を開く。②Simulatorでは「Features」メニューに直接のairplane modeは無いため、Macのネットワーク切断か、無料のApple公式ツール「Network Link Conditioner」(Xcodeの「Additional Tools for Xcode」に含まれる、Apple IDでダウンロード可能・追加費用無し)での100%パケットロス設定が使える |
| **データなし** | 実データ環境(§4)で、まだ取り込みが始まっていない日付・通貨ペアの相場反応詳細を開く(dev-environment.mdに記載の`firstCandleAt`より前の日時)。モック環境では、要人発言の`reaction_*`が元々nullで返る発言(スクリプト22行目のコメント「本番のreaction_*は値動きのデータが無いためnull」)が既存のデータなし状態として使える |
| **更新遅延** | 為替データの取り込みは20分ごと(dev-environment.md §3)。品質レポート(`/api/v1/quality-report`)の「時刻ずれ」欄(最新1分足の経過時間)を確認し、意図的に遅延させる場合はGitHub Actionsの定期実行を一時的に止める(ワークフローの有効/無効切り替えはデータを書き込む操作ではないが、**実施前にHQへ報告し承認を得ること** — 既存のデータ取得処理自体は変更しない) |

## 6. 複数端末・複数ユーザーのデータ分離(UI側の見え方)

DB側のRLS(他ユーザーの行を直接読めないこと)はBackendの統合テストで既に確認済み
(前回報告、183件成功)。**UI側で「実際に2つのアカウントでログインしても互いのデータが
混ざって見えないか」はXcodeでの手動操作が必要**で、このセッションでは未確認。

1. 複数のiOS Simulatorインスタンスを同時に起動する(`xcrun simctl boot`を2回、別のUDIDで)。
2. それぞれに異なる確認用アカウントでログインする。
3. ホーム通貨ペア編集(SCR-026)・お気に入り・アラート設定など、端末ローカルではなくAPI経由で
   保存される項目を一方の端末で変更し、もう一方の端末に反映されないことを確認する。

## 7. 1分・5分・15分の価格反応: どの層まで検証できたか(HQ指示2026-10-17「記録する」への回答)

「価格反応の検証」は実際には3つの異なる層であり、層ごとに検証状況が異なる。混同しない。

| 層 | 内容 | 検証状況 |
|---|---|---|
| ① APIレスポンス(Backendが返すJSON) | `GET /events/{id}`等が返す`pips`・`movement`・各時間足の値 | **未検証**。開発DBの認証情報がこのセッションに無く、実際のAPIレスポンスを取得できていない |
| ② 集計結果(1分足→5分/15分足のロジック) | `aggregateMinuteRows`が正しく集計するか | **検証済み**(前回報告、`npm test`、`tests/ingestion/fxGapRepair.test.ts`等、697件中含む全件成功)。ただしこれは**ロジックの正しさ**の検証であり、実際のdev DBに入っている実データそのものを対象にしたものではない |
| ③ 画面表示(iOSアプリが実際に表示する値) | SCR-008相場反応詳細に表示される値・時刻 | **未検証**(Xcode必須、このセッションでは実行不可) |

**結論**: ②(集計ロジックの正しさ)は検証済み。①(実データでのAPIレスポンス)・③(画面表示)は
このセッションでは未検証のまま。①③を確認するには、§4の手順でMac上でビルド・実行し、
実際に画面を開いて値を目視するか、`curl`等でBackendのAPIレスポンスを直接取得する必要がある
(Macが無くてもAPIレスポンスの取得自体は可能 — ただし開発DBの認証情報を持つ人が、
`https://<既存のRenderサービス名>.onrender.com/api/v1/events/{id}`等を直接叩けば、
Xcode無しでも①は確認できる。これは次に人が行える作業として記録する)。

## 8. 結果記入欄(Macを使う担当者が実行後に記入する。このセッションでは空欄のまま)

| # | 確認対象 | 実行日 | 実行者 | 結果(成功/失敗/問題点) | メモ・スクリーンショット保管先 |
|---|---|---|---|---|---|
| 7 | 画面遷移・レイアウト(§3) | | | | |
| 8 | ViewModel単体テスト(§3.1) | | | | |
| 9-① | 実データAPIレスポンス(§7) | | | | |
| 9-③ | 実データ画面表示(§4) | | | | |
| 10 | 通信失敗の表示(§5) | | | | |
| 10 | データなしの表示(§5) | | | | |
| 10 | 更新遅延の表示(§5) | | | | |
| 11 | 複数端末・複数ユーザー(§6) | | | | |

記入後、このファイルを更新してHQへ報告する(新しいファイルを作らず、この表を埋める)。

## 9. 未検証のまま残る項目(2026-10-17時点)

上記1節の表の通り、Xcode/Macが必要な項目(7〜11)はこのセッションでは**実行できない**
(Swift/Xcodeツールチェインが無い環境のため)。これらは実際にMacを使える人(大野さん等)が
本ドキュメントの手順に沿って実施する必要がある。**実行していないことを実行済みとは
報告しない。**

## 10. 2026-10-18追記: 実機テスト再開の最小条件・未署名IPAの再生成(HQ指示「実機テスト保留中の検証を進める」優先順位3への回答)

### 10.1 CIで確認済み・実機でしか確認できない項目の分離(再掲、変更なし)

本ファイル§1の表が示す区分は現在も有効(再調査していない): ビルド・単体テスト・
スクリーンショット・集計/時刻ロジック・RLSはCIで確認済み。実機でしか確認できないのは
「実データでの画面表示そのもの」「通信失敗・データなし・更新遅延・ログイン失敗時の
画面表示」「複数端末での見え方」(§7〜§11、結果記入欄は空欄のまま)。

### 10.2 実機テストを再開する最小条件と費用(`mac-free-development-plan-2026-10-17.md`から再掲)

| 条件 | 費用 | 備考 |
|---|---|---|
| AltStore PAL(EUの代替マーケットプレイス、iPhone単体で可) | **€1.50/年** | 開発者がEU圏内の場合のみ使える。未契約 |
| Apple Developer Program | **$99/年** | 保留中。TestFlight/Ad Hocが使えるようになる |
| Windows/MacのPCを一時的に借りる | **0円**(購入・レンタルではない) | 借りられればSideloadly等で既存の未署名IPAをそのまま使える(前回報告) |

いずれも今回は実行・契約していない。HQの判断待ち。

### 10.3 既存の未署名IPAの保存期限と再生成の確認

* 現在の未署名IPA(GitHub Actions run #39034362431のアーティファクト`FXEventAnalyzer-unsigned-ipa`)
  の保存期限は**2026-10-20**。本追記時点(2026-10-18)でまだ有効(残り2日)。
* **期限切れ時の再生成手順を確認した(今回は再生成していない。既に動作確認済みのため
  無駄な再実行はしない)**: `.github/workflows/fx-event-analyzer-ios-unsigned-ipa.yml`は
  現在`workflow_dispatch`(手動実行)のみで、このブランチ上に存在する。
  - mainブランチに取り込まれていれば、GitHub上の「Run workflow」ボタン、または
    `gh workflow run fx-event-analyzer-ios-unsigned-ipa.yml --ref <ブランチ>`で再生成できる。
  - mainに無い場合(現状)は、前回行ったのと同じ方法(このワークフローファイル自身に
    軽微な変更を加えてpushすると、そのpush自体がトリガーになる)で再生成できることを
    2026-10-17に実証済み(run #39034362431）。この方法は証明書・秘密鍵を一切使わないため、
    安全に繰り返せる。
* 結論: **保存期限が切れても、必要になった時点で同じ方法で0円のまま再生成できることを
  確認済み。** 現時点では期限内のため、新たな再生成は行わなかった。
