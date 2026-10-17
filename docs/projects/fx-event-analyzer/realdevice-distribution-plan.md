# 実機テスト配布方法の調査と提案(HQ指示 2026-10-17「実機テスト準備を最優先する」への回答)

作成: 2026-10-17
ステータス: 調査・提案のみ。費用・契約が発生する操作は未実施(HQ承認待ち)。

このドキュメントは、HQ指示「まず既存のiOSビルド・署名・配布環境を調査し、最短の方法を提案する」
に対する回答。**配布が実際に可能と確認できた事実はまだない**ため、完了とは報告しない。

## 1. 現状確認(コード・CI調査の結果)

* `.github/workflows/fx-event-analyzer-ios-build.yml`(8-9行目、コメント原文):
  「No Apple Developer Team / certificate / provisioning profile exists yet,
  so code signing is disabled (CODE_SIGNING_ALLOWED=NO)」。
  CIは `CODE_SIGNING_ALLOWED=NO`(96行目・112行目)でシミュレータ向けにビルド・テストのみ行っている。
* `fx-event-analyzer/README.md`(154-161行目)も同じ理由で「TestFlight submission is out
  of scope for Phase 1」と明記。
* `fx-event-analyzer/project.yml` を全文確認。`DEVELOPMENT_TEAM`・`CODE_SIGN_STYLE`・
  `CODE_SIGN_IDENTITY`・`PROVISIONING_PROFILE` など署名関連の設定は一切ない。
  `schemes.FXEventAnalyzer.archive` は `config: Release` のみで、エクスポート設定
  (ExportOptions.plist)は存在しない。
* リポジトリ全体を検索し、fastlane設定・`ExportOptions.plist`・`.mobileprovision`・`.p12`
  のいずれも見つからない。
* 証明書・秘密鍵・プロビジョニングプロファイルは、このリポジトリ・CIのどこにも存在しない
  (Apple Developer Programへの登録自体が未実施であることと一致)。

結論: **Apple Developer Programへの登録が行われていないため、署名付きビルドを作る手段が
現状どこにも存在しない。** これは新規調査ではなく、既存ファイルのコメント・READMEが
以前から明記していた事実の再確認。

## 2. 配布方法の比較

| 方式 | 追加費用 | Apple Developer Program登録 | 知り合いへの配布のしやすさ | 有効期間 | 今すぐ可能か |
|---|---|---|---|---|---|
| ① Xcodeから直接USBインストール(Personal Team / 無料Apple ID) | **0円** | 不要 | 悪い。知り合いの端末を物理的にMacへUSB接続し、Xcodeからビルド・インストールする必要がある。遠隔の知り合いには事実上配布できない | 署名後7日間で失効。再インストールが必要 | 技術的には今すぐ可能(Apple Developer Program登録なしで動く)。ただし「知り合いへの配布」という目的には実用性が低い |
| ② TestFlight | **$99/年**(Apple Developer Program) | 必要 | 良い。招待リンク/メールで複数人に配布可能。OTAで更新も配布できる | 登録が有効な間、90日毎に再アップロードで継続 | **未確認・未可能**。登録・証明書作成・ビルド設定変更が必要 |
| ③ Ad Hoc配布 | **$99/年**(Apple Developer Program) | 必要 | 普通。事前に対象端末のUDIDを登録する必要がある(端末数上限あり)。.ipaファイルを配布し、各自がインストール | 証明書の有効期限(通常1年) | **未確認・未可能**。登録・証明書・プロビジョニングプロファイル作成・UDID収集が必要 |

### 推奨

**知り合い複数人への配布が目的である以上、本質的な解決には TestFlight が最も適している。**
ただし、TestFlightもAd HocもApple Developer Program(個人/組織とも年額 **$99 USD**)への
登録が前提条件であり、これは明確な追加費用を伴う契約行為。

* ①(Xcode直接インストール)は追加費用こそ0円だが、7日ごとの再インストールが必要になる
  うえ、知り合いの端末をUSBでMacに接続する必要があり、「知り合いへの実機テスト」という
  目的には実用上ほぼ機能しない。1-2名が同じ場所にいて即日試す、という限定条件でのみ現実的。
* ②③はいずれも $99/年 の支出と、Apple IDでの組織情報登録(個人の場合は本人確認)を伴う。

**この $99/年 の支出についてHQの承認を得られれば、TestFlightの設定作業(登録→証明書・
プロビジョニングプロファイル作成→project.yml/CIへの署名設定追加→TestFlightへの
初回アップロード)に着手する。** 承認なしに登録・支払いは行っていない。

## 3. 配布までに必要な残作業(費用承認後、TestFlightを選択した場合)

1. Apple Developer Programへの登録($99/年、HQ承認後に実施)。登録には1-2日(本人確認)
   かかる場合がある。
2. 配布用証明書(Distribution Certificate)・App ID・プロビジョニングプロファイルの作成。
3. `project.yml` に `DEVELOPMENT_TEAM` ・ 署名方式の設定を追加し、CIワークフロー
   (`fx-event-analyzer-ios-build.yml` とは別に、リリース用ワークフローを新設するか、
   既存ワークフローに署名ビルドジョブを追加)を整備。証明書・秘密鍵はGitHub Actions
   Secretsに安全に格納し、ログ・リポジトリに平文で出さない。
4. App Store Connectでアプリ登録(Bundle ID: `com.fumaono.fxeventanalyzer` は既存のまま
   使用可能)。
5. TestFlightへの初回ビルドアップロード・内部テスター(知り合い)をメールで招待。
6. 知り合い側はTestFlightアプリをインストールし、招待を受理してアプリをインストール。

いずれも今回の調査・提案の範囲を超える実行作業であり、**費用承認を得てから着手する。**

## 4. 並行して残っている、配布可否とは別のブロッカー

Apple側の署名問題が解決しても、以下は別途未解決:

* **Twelve Data の利用規約**:自由プラン/個人向けキーの利用許諾は "Internal Use" 限定で、
  再配布(第三者へのデータ提供)には別途ライセンスが必要と規約上読める。知り合いへの
  テスト配布であっても、現状確認できている規約文言では許諾範囲が明確でない
  (`docs/projects/fx-event-analyzer/vendor-inquiries.md` §3.2参照)。問い合わせ文面は
  作成済みだが、**まだ送信していない**(大野さんの送信・承認待ち)。
* したがって、Apple側の配布手段が整っても、**為替価格データを知り合いの端末に表示してよいかは
  Twelve Dataからの回答が来るまで未確定**。この点は配布の実行可否とは独立した問題として、
  HQに重ねて明記する。

## 5. 費用のまとめ(今回新たに発生した費用: 0円)

* 本ドキュメント作成までに発生した費用: **0円**。
* 今後、TestFlightまたはAd Hocへ進む場合に発生する費用: **Apple Developer Program
  $99 USD/年**(個人・組織とも同額)。この支出は実行前にHQの承認を得る。
* 上記以外に、本提案の範囲で費用が発生する作業はない。
