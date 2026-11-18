# 米国の鉱工業生産(Fed G.17)の導入調査(2026-11-18)

担当 D。調査・設計のみ(コード・migration・DB・DEV の変更なし)。確認した事実と、確認できなかったことを分けて書く。

## 1. 結論(先に)
> **2026-11-18 追記**: DDP の Build Your Package 廃止・プリセット CSV の 2027-03-31 廃止・DDP ページの 2027-07-01 削除を確認した。取得経路への影響は §8。
- 公式ソース(連邦準備制度 G.17 の Data Download Program)は無料・鍵なしで取れる。
- **ただし、鉱工業生産(IP)の前月比 % の系列は公式データに無い。** 取れるのは**指数の水準**(2017=100)だけで、「-0.4%」のような変化率は公表文・表の HTML にしか無い。
- 変化率を指数から自前で計算すると、既存の方針(「独自計算は禁止」。CA_CPI・英国 PPI で採用)に反する。また、年次改定(下記)で指数の基準年が変わるので、計算は特に危険。
- **公式の % がそのまま取れるのは設備稼働率(Capacity Utilization、`CAPUTL.B50001.S`、単位 Percentage)**。
- 推奨: IP の前月比は**見送り**(または HQ が「指数からの計算」を例外として認める場合のみ)。**設備稼働率だけを先に導入する**案を提示する。FX への影響は IP の方が大きいため、HQ の判断が要る。

## 2. 確認した公式ソース
| 確認 | 内容 | 出典 |
|---|---|---|
| 公表ページ | 「Release Date: November 17, 2026」「Industrial production decreased 0.4 percent in October after increasing 0.7 percent in September」。製造業 +0.3%、稼働率(製造業)76.0% | `https://www.federalreserve.gov/releases/g17/current/default.htm` |
| データ配布 | Data Download Program(DDP)の G17 パッケージ。zip の中身は SDMX-ML の `G17_data.xml`(8.6MB 圧縮)・`G17_struct.xml`・各表の xsd | `https://www.federalreserve.gov/datadownload/Output.aspx?rel=G17&filetype=zip` |
| 表ごとの CSV | DDP の Choose ページに「The Major IP and Capacity Utilization Aggregates [csv, Last 7 Obs]」「G.17 Summary Table Data [csv]」など。**CSV の URL は series ごとのハッシュで、Choose ページの JS が作る**(今回は URL を確定できず) | `https://www.federalreserve.gov/datadownload/Choose.aspx?rel=g17` |
| 公表日程 | 2026: 12/16、2027: 1/15・2/17・3/15・4/15・5/17・6/16・7/16・8/17・9/16・10/18 ほか(release_dates ページ) | `https://www.federalreserve.gov/releases/g17/release_dates.htm` |

## 3. 取得可能な数値(zip の実データ、2026-11-18)
- 系列名は `IP.B50001.S`(総合指数、季節調整済み、`Index:_2017_100`)、`IP.B50001.N`(原数値)、`CAPUTL.B50001.S`(総合の稼働率、`Percentage`)、`CAP.B50001.S`(設備能力)、`RIW.*`(ウェイト)、`DIFF.*`(拡散指数)。
- IP 総合(季節調整済み): 2026-08 = 103.0954、2026-09 = 103.8458、2026-10 = 103.3954。公表文の「-0.4%(10 月)・+0.7%(9 月)」は、この指数の変化から導かれる値と整合する(確認のためだけに計算した。登録はしない)。
- 単位が `Percentage` の系列は `RIW`(319)・`CAPUTL`(171)・`DIFF`(3)だけで、**IP の変化率の系列は無い**。
- 取得は系列・期間の指定(`series=<ハッシュ>&lastobs=…`)でも、zip 全体でも可能。zip は大きい(8.6MB、展開後は XML で約 10 倍)ので、毎回の全件取得は避けたい。

## 4. 更新頻度・改定
- 月次。通常は毎月中旬(9:15 ET。**時刻は先の調査(indicator-coverage-survey-2026-11-12.md)の記載で、今回ページでは再確認できていない**)。
- **改定**: G.17 は毎回、直前の数か月分を改定する(今回の公表文も「9 月は +0.7%」と、改定後の値を示す)。DDP は**最新版だけ**で、過去の版(vintage)は無い。FRED/ALFRED は規約上、保存できない(先の調査)。
- **年次改定**: 公表ページに「**2026-11-24 に年次改定を行う。基準年は 2022 に変わる**」とある。**指数の水準が全期間で変わる**(2017=100 → 2022=100)ので、水準から計算する方式は、改定をまたぐと値が壊れる。
- 初回値の確定は、既存の official-values の考え方(公表日に更新された観測)を使うことになるが、DDP には「更新日」の情報が無い(次の節)。

## 5. 既存基盤との適合性
| 項目 | 評価 |
|---|---|
| 取得方式 | 既存の取得(ONS・StatCan・ABS)は JSON の API。G.17 は XML(SDMX-ML)の zip か、ハッシュ付き CSV。**新しいアダプターと XML/zip の処理が必要**(ライブラリの追加の可能性) |
| 公表日の照合 | ONS(releaseDate)・ABS(updatedAfter)・StatCan(releaseTime)のような「公表日が API に出る」仕組みが無い。公表予定の表(G.17 の日程は確認済み)と、データの最後の月の一致で代用することになる。**「前の回の値を今回の値として使わない」を保証する根拠が弱い** |
| 値の種類 | 公式の % は稼働率だけ。IP の変化率は計算になる(方針に反する) |
| 利用条件 | Fed のサイトの利用条件の文面は**今回読めなかった**(先の調査では「パブリックドメイン・出典の表示」)。実装前に原文を確認する |
| migration | 指標 1〜2 行 + 通貨ペア(USDJPY・EURUSD)。スキーマの変更なし |

## 6. リスク
1. **変化率が公式データに無い**(上記)。
2. **年次改定(11/24)で基準年・全履歴が変わる**。実装の時期が改定の前後にまたがると、初回値と履歴が混ざる。
3. **公表日の照合が弱い**(API に更新日が無い)。
4. **XML/zip のサイズと処理**(毎回 8.6MB の取得は重い。系列指定の CSV のハッシュは Choose ページの JS 由来で、固定にできるかは未確認)。
5. 先の調査の「CSV を直接取る」は、ハッシュ付き URL を前提にしており、**固定 URL では取れなかった**(今回)。

## 7. 推奨と次の実装候補
1. **IP の前月比**: 公式の % 系列が無いため**実装しない**。HQ が「公式の指数から、公式の丸めで計算する」例外を認めるなら、別途設計する(指数の同一版から計算・年次改定の前後は保存しない、などの条件つき)。
2. **設備稼働率(`CAPUTL.B50001.S`)**: 公式の % がそのまま取れる。公表ページに「Capacity utilization for manufacturing…」があり、市場でも見られる。ただし、**IP の添え物であり、単独で FX への影響が大きいかは別の判断**。
3. 実装するなら 11/24 の年次改定の後。手順: 利用条件の原文確認 → CSV のハッシュの固定可否の確認 → アダプター(XML か CSV)→ 公表予定の表(G.17 の日程は確認済み)→ migration(未適用)→ テスト。

## 8. 追記(2026-11-18、C のレビューを受けて): DDP の縮小と、固定 URL での取得の可否
Fed の Data Download Program(DDP)は縮小中で、**取得経路の選び方に直接影響する**。第 1 版の「CSV のハッシュの固定可否は未確認」を、次のとおり確定する。

### 8.1 確認した事実(Fed の公式ページ、2026-11-18)
| 事実 | 出典 |
|---|---|
| **Build Your Package(自分で系列を選んで URL を作る機能)は廃止済み**(7/16 の告知。ページには「removed the week of November 9, 2026」の記載もある) | https://www.federalreserve.gov/datadownload/default.htm ・ https://www.federalreserve.gov/data/data-download-fred-information.htm |
| **preformatted data package(あらかじめ用意された CSV のセット)は 2027-03-31 に廃止**。ブックマークした URL は動かなくなる | 同上 |
| **DDP のページそのものは 2027-07-01 に削除** | 同上 |
| 移行先として、セントルイス連銀の **FRED**(FRED の API で全系列・全期間を JSON/XML で取得できる)を案内 | 同上 |
| **XML 形式は、Board の各統計公表ページから引き続き手動でダウンロードできる**。G.17 は `https://www.federalreserve.gov/releases/g17/data/FRB_g17_xml.zip`(8.6MB、2026-11-18 に取得して `CAPUTL.B50001.S` の値を確認。DDP の zip と同じサイズ・同じ値) | G.17 の公表ページのリンク |

### 8.2 固定 URL での系列指定の可否
- **系列名での指定は不可**: `Output.aspx?rel=G17&series=CAPUTL.B50001.S&filetype=csv` は **HTTP 400**。`series=` は、Choose ページが出す **32 桁のハッシュ**(系列のセットの識別子)でしか受け付けない。
- **既存のプリセットのハッシュは、現時点で有効**: 第 1 版で使った `series=403cc340ea3a19566b30770b9e4793ab`(The Major IP and Capacity Utilization Aggregates)は、2026-11-18 に 200・1.4KB で取得できた(`Last-Modified` は配信の時刻)。
- **しかし、新しいハッシュは作れない**(Build Your Package が廃止)。プリセットのハッシュも **2027-03-31 に使えなくなる**。**長期の取得経路としては使えない**。
- 結論: **プリセット CSV は、2027-03-31 までの暫定の経路**。それ以降に残るのは、次の 2 つだけ。

| 経路 | 内容 | 制約 |
|---|---|---|
| **A. 公表ページの XML zip**(`FRB_g17_xml.zip`) | 鍵なし・固定 URL。Fed は「XML は引き続き提供」と明記 | 8.6MB(展開後は約 10 倍)。毎回の取得は重い。**Fed の「手動でダウンロードするユーザー向け」という位置づけで、自動取得が想定されているかは不明**(利用条件の原文の確認が先) |
| **B. FRED の API**(St. Louis 連銀) | 系列 ID で指定でき、全期間を JSON で取れる | **API キーが要る(無料)**。**FRED のデータの保存・再配布は FRED の規約で制限される**(先の調査 indicator-coverage-survey-2026-11-12.md で「保存が規約に反する」と判断済み)。**採用不可**の可能性が高い |

### 8.3 副次的な発見(取得経路 A の利点)
- zip の `Last-Modified` は **2026-11-17 14:15:07 GMT**(ニューヨークの標準時で 09:15)。先の調査の「09:15 ET」と**符合する**が、配信ファイルの更新時刻で、**公表時刻を保証する Fed の文書ではない**ので、**公表時刻 09:15 ET は未確認として扱う**(C の指摘)。
- この `Last-Modified` は、**公表日の照合に使える更新日の代わり**になりうる(DDP の CSV には無かった)。ただし、**ヘッダーの値を保証する Fed の文書は確認していない**ので、補助の根拠にとどめる。

### 8.4 残る制約と、設計への影響
1. **鍵なし・固定 URL・長期に残る**のは XML zip(A)だけ。ただし**サイズが大きく、自動取得の可否が不明**。
2. **CSV の経路は 2027-03-31 まで**。導入しても、約 4 か月で作り直しになる。設備稼働率の導入(2026-12 の予定)は、**最初から経路 A(XML zip)を前提に設計する**のが妥当。CSV は使わない。
3. **XML の処理**(zip の展開と SDMX-ML の解析)に、ライブラリの追加が要る可能性が高い(現在の依存には zip・XML の読み込みが無い)。
4. 取得の頻度を、**公表日(月 1 回)と、公表の翌日の再確認**だけに限定し、サイズの負荷を抑える。
5. **利用条件(自動取得の可否・出典の表示)の原文を、実装の前に確認する**(未確認のまま)。
6. IP の前月比(公式の % 系列なし)の結論は変わらない。

## 8.5 追記: Fed の利用条件(原文、2026-11-18)
- https://www.federalreserve.gov/disclaimer.htm の「Copyright/trademark」: 「Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission. Please cite to the Board as the source of the information.」(パブリックドメイン・出典として Board を明記)。Board の印章・ロゴは使えない(連邦法)。
- 設備稼働率の取得経路・フォールバック・年次改定の記録の設計は、`claude/fx-indicator-research-d2` の `02-us-capacity-utilization-fed-g17.md`(第 2 版)に集約した。

## 9. 第 1 版の記述の訂正
- 第 3 節「取得は系列・期間の指定(`series=<ハッシュ>&lastobs=…`)でも、zip 全体でも可能」: **系列の指定は、ハッシュを使う既存のプリセットだけ**。かつ 2027-03-31 まで。
- 第 7 節の「CSV のハッシュの固定可否の確認」は、本節で確認済み(固定だが、新規に作れず、期限つき)。
