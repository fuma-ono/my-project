# 導入したツールとライセンス(8秒試作時点)

すべて無料。有料 API・有料サービス・課金の発生する操作は使っていない。
導入先はこの検証用クラウドコンテナ(使い捨て)で、リポジトリには**ツール本体を入れていない**。

| ツール | 版 | 入手元 | ライセンス | 用途 | 商用の動画制作で使えるか |
|---|---|---|---|---|---|
| Blender(**実際の描画に使用**) | 4.2.3 LTS(公式 tarball) | download.blender.org | GPL-3.0+(同梱ライブラリは各ライセンス) | 3D・アニメ・描画(Cycles, CPU) | ○ Blender で作った画像・動画の権利は作者にある(Blender 財団の説明) |
| Blender(apt 版) | 4.0.2 | Ubuntu apt | GPL-2+ ほか | **未使用**(OpenImageDenoise 非搭載のため描画には使わず、4.2 に切り替えた) | — |
| Open JTalk | 1.11-5 | Ubuntu apt(universe) | BSD-3-Clause | 日本語音声合成(技術検証用) | ○ |
| mecab-naist-jdic(辞書) | 1.11-5 | apt | BSD-3-Clause(NAIST ほか) | Open JTalk の辞書 | ○ |
| HTS voice `nitech_jp_atr503_m001` | 1.05-8 | apt(contrib) | **CC-BY 3.0**(名古屋工業大学ほか) | ナレーション音声データ | △ **クレジット表記が必要**。Debian の注記に「作成に使われた HTK は非フリーの EULA」とあり、生成音声の商用利用への影響は**未確認**。本番で使う前に要確認(今回は技術検証用) |
| M+ FONTS(Mplus1-ExtraBold) | 063 | apt `fonts-mplus` | SIL OFL 1.1 | 字幕 | ○(フォント自体の単体販売は不可) |
| FFmpeg | 6.1.1 | 導入済み(apt) | LGPL/GPL(ビルド構成による) | エンコード・合成 | ○(H.264 の特許ライセンスは配信形態による。無料配信なら一般に問題になりにくいが法的保証ではない) |
| Python / numpy / Pillow | 3.13 / — / — | 導入済み | PSF / BSD / HPND | 自動化・効果音合成・字幕画像 | ○ |
| xvfb(apt) | 21.1.12 | apt | MIT 系 | **未使用**(EEVEE の検証用に入れたが、Cycles を使ったため不要) | — |

## 素材
- 3D モデル・背景・花・虹・雲: すべて本プロジェクトのコードで生成(外部素材なし)。
- 効果音: `src/sfx.py` が numpy で合成(外部素材なし)。BGM は今回なし。
- ブランド画像: ユーザー提供。色の基準値の抽出と見た目の参照にだけ使用し、**リポジトリには入れていない**。

## 必須クレジット(公開時)
ナレーションに Open JTalk の HTS voice を使う場合、概要欄などに次を表記する:

> HTS Voice "NIT ATR503 M001" Copyright (c) 2003-2012 Nagoya Institute of Technology, Department of Computer Science / 2003-2008 Tokyo Institute of Technology. Licensed under CC BY 3.0.
> Open JTalk Copyright (c) 2008-2016 Nagoya Institute of Technology (BSD-3-Clause)

(音声を VOICEVOX などに差し替えた場合は、その利用規約のクレジット表記に従う。)
