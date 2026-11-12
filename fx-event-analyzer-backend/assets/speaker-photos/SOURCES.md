# 要人の公式写真の出典

Backend が `GET /api/v1/speaker-photos/{file}` で配信する写真(api-design.md 14.7節)。

出典: 米国連邦準備制度理事会(FRB)(Board of Governors of the Federal Reserve System, https://www.federalreserve.gov/)

## 利用条件

federalreserve.gov の利用条件(https://www.federalreserve.gov/disclaimer.htm)より:

> Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission. Please cite to the Board as the source.

- パブリックドメインで、許可なく複製・配布できる。出典として FRB を示す(「出典: 米国連邦準備制度理事会(FRB)」)
- リンクは許可されているが、フレーム内表示は不可。このため直リンクせず、複製をここに置いて自前で配信する
- ここに置くのは FRB の写真だけ。ほかの機関の要人の写真は利用条件を確かめていないので置かない(アプリは頭文字と機関の色で表示する)

## ファイル一覧(取得日: 2026-10-13)

| ファイル | 人物 | 役職(2026-10-13 時点) | 取得元 |
|---|---|---|---|
| warsh.png | Kevin Warsh(ケビン・ウォーシュ) | Chairman(FRB議長) | https://www.federalreserve.gov/aboutthefed/images/chairman-warsh-130x168.png |
| jefferson.jpg | Philip N. Jefferson(フィリップ・ジェファーソン) | Vice Chair(FRB副議長) | https://www.federalreserve.gov/aboutthefed/images/jefferson_phillip_rdax_130x162s.jpg |
| bowman.jpg | Michelle W. Bowman(ミシェル・ボウマン) | Vice Chair for Supervision(FRB副議長（金融監督担当）) | https://www.federalreserve.gov/aboutthefed/images/bowman_michelle_rdax_130x163s.jpg |
| barr.jpg | Michael S. Barr(マイケル・バー) | Governor(FRB理事) | https://www.federalreserve.gov/aboutthefed/images/Barr_michael_8x10_July_25_22-444_rdax_130x162s.jpg |
| cook.jpg | Lisa D. Cook(リサ・クック) | Governor(FRB理事) | https://www.federalreserve.gov/aboutthefed/images/Cook_Lisa_8x10_June_29_22-316_pp_rdax_130x162s.jpg |
| powell.jpg | Jerome H. Powell(ジェローム・パウエル) | Governor(FRB理事) | https://www.federalreserve.gov/aboutthefed/images/Powell_Jerome_Aug_16_22-674_8x10_rdax_130x162s.jpg |
| waller.jpg | Christopher J. Waller(クリストファー・ウォラー) | Governor(FRB理事) | https://www.federalreserve.gov/aboutthefed/images/waller_christopher_September_01_2025-1022_highres_rdax_130x163s.jpg |

ファイル名は `^[a-z0-9-]+\.(jpg|png)$` に合わせる(これ以外の名前は配信しない)。DB の `speakers.photo_url` には `speaker-photos/<ファイル名>` を入れる。
