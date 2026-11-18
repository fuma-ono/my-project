# 経済指標の導入調査(第 2 弾、2026-11-18)

担当 D。調査のみ。ベース: settings `7fa2df26`。

| 文書 | 要点 |
|---|---|
| [01-uk-gdp-quarterly-ons.md](01-uk-gdp-quarterly-ons.md) | 英国 GDP 四半期(IHYQ): 公式の前期比 % あり。実装可。四半期の取り込みの拡張と、指標別の改定期間(60〜270 日)が前提。改定は頻繁(±0.1)で長引く |
| [02-us-capacity-utilization-fed-g17.md](02-us-capacity-utilization-fed-g17.md) | 米国設備稼働率(CAPUTL.B50001.S): 公式の % あり。1.4KB の CSV で取得可。11/24 の年次改定の後に導入。改定前の値を基準として保存 |
