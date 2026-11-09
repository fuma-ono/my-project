# チャンネル名・ハンドル名の決定(モヤスカ)

オーナー指示(2026-08-06)「モヤスカの新しいチャンネル名とハンドル名とか決めて」を受けて、社長として決定。

## 決定事項

| 項目 | 内容 |
|---|---|
| **チャンネル名** | **モヤスカ** |
| **ハンドル** | **@moyasuka**(第一候補) |
| ハンドル代替案 | `@moyasuka)`が既に使われていた場合は `@moyasuka_tv` → `@moyasuka_ch` → `@moyasuka_jp` の順で試す |
| チャンネル概要欄の書き出し | 「モヤスカ|LINEで見るスカッと系ショートドラマ」(検索キーワードを名称の直後に明記) |

これで団体名候補は確定。`team.md`にあった「すかっと部屋」「モヤスカ劇場」は不採用。

## 決定の根拠

**同ジャンルの競合名を調査した結果**、この分野(LINE風スカッと系ショートドラマ)の既存チャンネルは「スカッとLINE」「LINEドラマ」「LINE劇場」「スカッとドラマ」「痛快スカッとLINE!」のように、**ほぼ全てが「スカッと」または「LINE」をそのまま名前に含む**([出典1](https://www.youtube.com/channel/UCBSG65p0ojOJ8EodxnUNd3A/join), [出典2](https://www.youtube.com/@line4091), [出典3](https://www.youtube.com/channel/UCidhhtOkAnqajxYUdsDVmDA))。

この状況で候補だった「すかっと部屋」「モヤスカ劇場」を採用すると、パッと見て競合と区別がつかない・検索結果に埋もれる、という問題がある。

「モヤスカ」を検索した限り同名チャンネルは見当たらず([出典4](https://www.youtube.com/user/moyamoyasamaazu2/) — 表記が近い「モヤさまチャンネル」がヒットするのみで別ジャンル)、**固有名詞として空いている**。「もやもや→すかっと」という感情の起伏を一語に凝縮した独自の造語であり、覚えやすく発音もしやすい。

一方で「スカッと」というジャンル検索キーワード自体は視聴者の検索導線として重要なため、**チャンネル名そのものは独自ブランドの「モヤスカ」を採用しつつ、概要欄の書き出しに「スカッと系」を明記してSEOを両立させる**、という設計にした。これは`bgm_pipeline`のBGM動画で採用した「タイトルは独自性、概要欄でキーワードを補う」設計と同じ考え方。

## 出典

- [スカッとLINE](https://www.youtube.com/channel/UCBSG65p0ojOJ8EodxnUNd3A/join)
- [LINE劇場](https://www.youtube.com/@line4091)
- [スカッとドラマ](https://www.youtube.com/channel/UCidhhtOkAnqajxYUdsDVmDA)
- [痛快スカッとLINE!](https://www.youtube.com/channel/UCvGyg6bHYCZbzQRLTP46DBA)

## 残るオーナー対応

- 新規YouTubeチャンネルを「モヤスカ」名義・`@moyasuka`ハンドルで作成(ハンドルが取得できない場合は上記代替案の順で)
- VOICEVOXエンジンのセットアップ(手元PC)
