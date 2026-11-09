# Macなし・追加費用0円での開発方針(HQ指示2026-10-17「Macなし・追加費用0円で開発を進める」への回答)

作成: 2026-10-17。既存資産(既存CI・既存ドキュメント)を再利用し、同じ調査は繰り返さない。
2026-10-17追記(HQ方針「iPhone・iPadのみで実機テストする方法を調査」): §7に追記。

## 1. iOS検証方法の再評価(Mac不要で実行できる検証の整理)

| 検証項目 | Mac不要で可能か | 根拠・実行方法 |
|---|---|---|
| ビルド・単体テスト(FXEventAnalyzer/FXEventAnalyzerTests) | **可能(既に実行されている)** | `fx-event-analyzer-ios-build.yml`、GitHub Actions の macOS runner。このリポジトリは**public**(2026-10-17確認)のため、標準runner(macOS含む)の利用は追加費用0円(GitHubの「GitHub Actions usage is free for standard GitHub-hosted runners in public repositories」)。直近の実行(2026-10-16、run #38880825483)は**成功**。再実行していない(既存ログを利用) |
| スクリーンショットテスト(画面遷移・レイアウト) | **可能(既に実行されている)** | `fx-event-analyzer-ui-screenshots.yml`、同じく macOS runner・public repoで0円。直近の実行(2026-10-16、run #38880825515)は**成功**。再実行していない |
| 1分/5分/15分の集計・時刻整合性(ロジック) | **可能(既に実行済み)** | `npm test`(Node.js、Mac不要)。前回・前々回の報告の通り697件中成功。再実行していない |
| 通信失敗・データなし・更新遅延(Backendロジック) | **可能(既に実行済み)** | 同上(`fxGapRepair.test.ts`等)。再実行していない |
| RLS・複数ユーザーのデータ分離(DB側) | **可能(既に実行済み)** | GitHub Actionsの`fx-event-analyzer-backend-ci.yml`(ubuntu runner、Docker、public repoで0円)。前回報告の通り183件成功(run #39005441068)。再実行していない |
| 画面表示そのもの(通信失敗・データなし・更新遅延のUI、実データでの価格反応) | **未確認(本節末で調査)** | §2参照 |
| 開発DB確認SQLの実行 | **Mac不要**(ブラウザのみ) | `dev-environment.md`§8.0。Supabaseダッシュボードはブラウザで開くだけで、Mac/Xcodeは一切不要 |

**結論**: ビルド・単体テスト・スクリーンショット・集計ロジック・RLSは、いずれも既存のGitHub Actions(public repoのため追加費用0円)で既に継続的に確認されている。Macを新たに用意する必要はない。残る未確認は「画面に実際に表示される見た目・実データでの値」のみ。

## 2. iPhone実機への配布方法(Mac購入・レンタルなし、Apple Developer Program登録なし)

### 2.1 技術的な前提(変わらない事実)

Appleは、実機にアプリを入れる署名処理をmacOS(Xcodeまたは同等の署名ツール)上でのみ許可している。したがって「ビルド」と「署名」は分けて考える必要がある。

* **ビルド**(ソースコードから.appを作る)は、GitHub Actionsの macOS runner で可能(Mac購入・レンタル不要、既存のCI runnerを使うだけ)。
* **署名**(その.appにAppleの許可(証明書)を付けて実機で起動できるようにする)は、従来はMac上のXcodeが必要だった。ただし、無料のApple ID(Personal Team、Apple Developer Program登録は不要)による署名処理自体は、**Windows上で動く無料の第三者ツール(AltStore/AltServer、Sideloadly、iLoader等)でも実行できる**ことを2026-10-17にWebSearch/WebFetchで確認した(出典は本節末)。

### 2.2 調査した配布方法の比較

| 方法 | Mac購入・レンタル | Apple Developer Program | 費用 | 制約 |
|---|---|---|---|---|
| ① GitHub Actions(macOS runner)で未署名の実機用.ipaを作り、Windows上のSideloadly/AltStore/iLoaderで開発者本人の無料Apple IDで署名してインストール | **不要** | **不要** | **0円** | 無料Apple IDは7日ごとに再署名が必要(各ツールに自動更新機能あり、iPhoneが再接続可能な状態を保つ必要)。iOS 16以降は端末の「デベロッパモード」を有効化する必要がある。Windows側ではiTunes/iCloudをMicrosoft Store版でなくApple公式サイト版で入れる必要がある(Sideloadly公式サイト・AltStore公式FAQで確認、2026-10-17)。知り合い本人がこの手順を自分のWindows PCで行う必要がある(開発者が代理では、知り合いの端末との初回USB接続が必要) |
| ② TestFlight / Ad Hoc配布 | 不要(配布自体はMac不要) | **必要($99/年)** | $99/年 | 前回までに報告済み。保留中 |
| ③ Xcode直接インストール(開発者のMac) | **必要(購入・レンタル)** | 不要 | Mac購入・レンタル費用 | 前々回報告済み。今回の前提(Macを持たない・買わない・借りない)では選択肢外 |

**①が、今回のHQ方針(Mac購入・レンタルなし、Apple Developer Program登録なし、追加費用0円)に唯一合致する候補。**

### 2.3 ①の技術的な可否(2026-10-17、実際にGitHub Actionsで試行)

「実際にCIで未署名の実機用ビルドが作れるか」を確認するため、既存のワークフローとは別の、調査専用・手動起動のみのワークフロー(`.github/workflows/fx-event-analyzer-ios-unsigned-ipa.yml`)を追加し、`claude/fx-settings-screens`ブランチ上で実行した(既存の`fx-event-analyzer-ios-build.yml`等は変更していない)。

**実行結果: 成功(2026-10-17、確認済み)**

GitHub Actions run #39034362431(`unsigned-device-build`ジョブ、macos-15 runner)が成功。
`CODE_SIGNING_ALLOWED=NO` / `CODE_SIGNING_REQUIRED=NO` での実機(iphoneos SDK)向けビルドが
通り、生成された`.app`を`Payload/`に入れてzip化した未署名`.ipa`(約13.2MB)がCIアーティファクト
として実際に作成された(`FXEventAnalyzer-unsigned-ipa`、3日間保存)。証明書・プロビジョニング
プロファイル・Apple IDは一切使っていない。

**これにより確認できたこと**: 「Mac購入・レンタル・Apple Developer Program登録のいずれも
行わずに、実機(iphoneos)向けの.appを作る」こと自体は**技術的に可能**であることを実機構成の
ビルドとして確認した。

**これでまだ確認できていないこと**(§2.4参照): この未署名.ipaを実際にWindows PC+Sideloadly等で
署名し、実際のiPhoneにインストールできるかどうかは、Mac/Windows/iPhoneのいずれも無い本
セッションの実行環境では確認できない。**そのため「知り合いの実機にアプリを配布できる」とは、
まだ報告しない。** 次の段階(Windows PCとiPhoneを使った実際の署名・インストール)は、本人また
担当者が行う必要がある。

### 2.4 まだ確認できていないこと(①が成功したとしても残る課題)

* 署名ツール(Sideloadly等)自体の実際の動作は、Windows PCと実機(iPhone)が必要で、**このセッションでは確認できない**(Mac/Windows/iPhoneのいずれも無い実行環境のため)。
* 知り合い複数人に配布する場合、①は各人が自分のPCで一度ツールを操作する必要があり、TestFlightのような「リンクを送るだけ」の手軽さは無い。
* 無料Apple IDでの署名はApple IDのパスワードを第三者ツール(オープンソース、AltStore/Sideloadlyとも開発元の公式サイトで確認)に入力する必要があり、これは一定のアカウントセキュリティ上の判断を伴う(悪意あるツールではないと判断できる根拠はあるが、入力する以上のリスクはゼロではない)。

### 出典(2026-10-17 WebSearch/WebFetch確認)

- [AltStore — How to Install (Windows)](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows)
- [Sideloadly公式サイト](https://sideloadly.io/)
- [GitHub Actions usage limits, billing, and administration](https://docs.github.com/en/actions/administering-github-actions/usage-limits-billing-and-administration)
- 実行結果: https://github.com/fuma-ono/my-project/actions/runs/39034362431(run #39034362431、成功)

## 6. 次に本人が行う操作(Windows PC + iPhoneがあれば、追加費用0円で進められる)

1. 上記run #39034362431のページを開き、「Artifacts」から`FXEventAnalyzer-unsigned-ipa`
   をダウンロードする(**2026-10-20まで保存。期限切れ後は、同じワークフローを手動実行
   (workflow_dispatch)するか、もう一度このファイルに変更を加えてpushすれば再生成できる**。
   ただしworkflow_dispatchでの手動実行は、このワークフローファイルがmainブランチにある
   ことが必要 — 現時点では`claude/fx-settings-screens`ブランチのみにあるため、mainへの
   取り込みが要る。取り込みの判断はHQが行う)。
2. Windows PCにSideloadlyをインストールする(`sideloadly.io`、無料)。Microsoft Store版ではない
   iTunes/iCloudをApple公式サイトから入れておく(Sideloadly公式サイトの案内どおり)。
3. iPhoneをUSBで接続し、iOS 16以降なら「設定→プライバシーとセキュリティ→デベロッパモード」を
   有効化する。
4. Sideloadlyに①の`.ipa`をドラッグし、無料のApple IDでサインインして「Start」する。
5. 7日ごとに自動再署名されるかどうか(Sideloadlyの自動更新デーモン)を確認し、結果をHQへ報告する。

この手順はWindows PC・iPhoneが必要で、このセッションでは実行できない(環境制約として明記)。

## 3. Twelve Data問い合わせ

`vendor-inquiries.md`§5の既存文面を維持。再調査・再作成はしていない。**未送信のまま、本人の最終承認を待つ。**

## 4. 開発DB確認SQL

`dev-environment.md`§8.0の既存手順を維持(SQL本文も変更なし)。この手順は**元々Mac不要**(Supabaseのウェブ画面(ブラウザ)で開いて実行するだけ)。実行状況は引き続き**未実施**。権限者(大野さん、または開発用Supabaseの鍵を持つ担当者)が実行する。本番DBには接続しない。

## 5. 制約の遵守状況

* 新規契約・支払い・APIキー発行・課金プラン変更: **無し**。
* 外部APIへの追加呼び出し: **無し**(Twelve Data/BLS等への新規呼び出しは行っていない。行った外部通信はGitHub公式ドキュメントの閲覧とWebSearchのみ)。
* 本番DB接続: **無し**。
* 既存UI・データ取得処理の大幅変更: **無し**(新設した調査用CIは既存ワークフローを変更していない、手動・特定パスのみで起動)。

## 7. iPhone・iPadのみ(PCなし)での実機テスト(HQ方針2026-10-17「iPhone・iPadのみで実機テストする方法を調査」への回答)

前提どおり、新しいCI実行は行っていない(既存の未署名`.ipa`、run #39034362431のアーティファクト
`FXEventAnalyzer-unsigned-ipa`を再利用する前提で調査。有効期限2026-10-20)。本節は調査結果のみで、
登録・契約・支払いは一切行っていない。

### 7.1 調査結果の要約

| # | 調査事項 | 結論 |
|---|---|---|
| 1 | iPhone/iPad**単体**(PCなし)で未署名IPAを署名・インストールする方法 | **追加費用0円かつ安全に確認できる方法は見つからなかった**(§7.2) |
| 2 | GitHub Actions等のクラウドで署名してiPhoneへ配布する方法 | **Apple Developer Programが無ければ、信頼できる方法は見つからなかった**(§7.3) |
| 3 | 無料Apple ID vs Apple Developer Programの切り分け | §7.2・7.3の各手法ごとに下表で明記 |
| 4 | 無料とされる方法の必要PC・証明書・期限・制約 | §7.2・7.3の各手法ごとに下表で明記 |

### 7.2 iPhone/iPad単体(PCなし)での署名: 調査した手法と判定

| 手法 | PCが本当に不要か | 無料Apple ID / Developer Program | 費用 | 期限・制約 | 採否 |
|---|---|---|---|---|---|
| **AltStore PAL**(EUの代替アプリマーケットプレイス。Safari経由でiPhone単体からインストール可能) | **はい**(WebFetch/WebSearchで確認、2026-10-17。install straight from the website on the iPhone) | 無料Apple ID相当(マーケットプレイス側の署名。7日期限・インストール数上限はPAL版には無いとFAQにある) | **有料。€1.50/年(+VAT)** | EU圏内に物理的にいること・EUのApple IDアカウント・VPN不可・iOS 17.4以降が必須。開発者がEU圏内かどうかは本調査では確認できていない | **提案のみ、未契約**。€1.50/年は「有料サービスへの登録・契約・支払い禁止」に該当するため実行していない |
| **KSign / Feather / eSign**(iPhone/iPad上で動く、オープンソースのオンデバイス署名アプリ) | **実質的に不要というのは誤り**。これらのアプリ自体を初回インストールするには、従来型のAltStore/Sideloadly(PC必須)か、第三者の共有証明書サイトのいずれかが必要(鶏と卵の関係) | 第三者の共有証明書(無料)に依存するものが多い | 無料(ただし証明書配布サイトへの登録を求めるものもある) | 共有証明書はAppleに頻繁に失効させられ不安定。配布元の信頼性を確認できない(出典が低品質なブログ・フォーラム中心) | **不採用**。安全性・継続性を確認できず、「動作確認済み」とは報告できない。セキュリティ上のリスク(出典不明の証明書・アプリ)がある |
| **TrollStore系(iOS の署名バグを利用する、オンデバイスのみの手法)** | 対象iOSバージョンのみ | Apple IDすら不要(バグ利用) | 無料 | 特定のiOS/iPadOSバージョンの未修正の脆弱性に依存し、対象端末・バージョンが限られる。Appleが修正すれば使えなくなる。また、脆弱性を利用する手法でありApple非公式 | **不採用**。対象端末・バージョンを確認しておらず、公式に推奨できる手法ではない |

**結論(7.1の#1・#4)**: iPhone/iPad単体・PCなし・追加費用0円という3条件を**同時に満たす、安全に推奨できる方法は見つからなかった**。最も近いAltStore PALも有料(€1.50/年)かつEU限定。

### 7.3 クラウド(GitHub Actions等)での署名: 調査した手法と判定

| 手法 | 必要なもの | 無料Apple ID / Developer Program | 判定 |
|---|---|---|---|
| fastlane match / App Store Connect API Key でのCI署名 | Apple Developer Programのアカウント(APIキー発行にはProgram登録が必須) | **Developer Programが必須**($99/年) | **不採用**(Developer Program登録は保留中のため) |
| 無料Apple ID(Personal Team)でのCI内署名 | Appleは、無料Apple IDでの署名を「Xcodeでの対話的なサインイン」としてのみ提供しており、CIでの非対話型の自動ログインを公式には支えていない。実現しようとすると、Apple IDのパスワード・2段階認証をCIのSecretsに保存する必要が生じる | 無料Apple IDのみで可能に見えるが、安定した非対話型の方法が確認できない | **不採用**。「Apple IDの認証情報をリポジトリ・ログに保存しない」という禁止事項に反する可能性が高く、試みていない |

**結論(7.1の#2)**: GitHub ActionsなどのクラウドでApple Developer Programを使わずに署名する、信頼できる方法は見つからなかった。

### 7.4 完了報告(本節のまとめ)

1. **iPhone・iPadだけで実行可能か**: **不可**。安全かつ追加費用0円の方法は見つからなかった。
2. **PCなしで実現できる無料手段があるか**: **無い**。唯一の「PCなし」手段(AltStore PAL)は有料(€1.50/年)かつEU限定で、無料ではない。
3. **実証済みの事項と未検証の事項**:
   - 実証済み: 既存の未署名`.ipa`(run #39034362431)がGitHub Actions上で作成できること(前回報告、再確認のための再実行はしていない)。
   - 未検証: AltStore PAL・KSign・Feather・eSign・TrollStore系のいずれも、実際にインストール・動作させて確認してはいない(登録・契約・危険性の高い手法のため試みていない)。「動作確認済み」とは報告しない。
4. **実現不可能な場合の最小コストの代替案**(提示のみ、実行・契約はしていない):
   - **AltStore PAL(€1.50/年)**: 開発者がEU圏内にいる場合、最も安価。PC不要、iPhone単体で完結。
   - **Apple Developer Program($99/年)**: 既報の通り、TestFlight/Ad Hocが使えるようになる。EUに限定されない。
   - **Windows/MacのPCを(購入・レンタルせず)一時的に借りる**: 知り合い等から1台でも借りられれば、§2(前回報告)のSideloadly/AltStore経由の0円の方法がそのまま使える。契約・支払いを伴わないため、今回の禁止事項には該当しない(借用の可否自体は本人の判断)。
