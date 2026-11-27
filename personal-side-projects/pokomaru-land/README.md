# ぽこまるランド 無料動画制作システム

月額費用・動画生成 API 料金ゼロで、オリジナルの 3D 知育アニメ(9:16・1080×1920)を作る。
Blender(Cycles, CPU)+ Python + FFmpeg + Open JTalk。**有料 API は使わない。**

状態: 第1話「いろをみつけよう!」の **8秒試作**まで。結果は [docs/PROTO8S_REPORT.md](docs/PROTO8S_REPORT.md)。
ツールとライセンスは [docs/LICENSES.md](docs/LICENSES.md)。

## 構成
```
config/ep01_proto8s.json   色パレット(ブランド画像から実測)・台本・タイミング・TTS・字幕・描画設定
src/tts.py                 ナレーション生成(openjtalk / voicevox / wav を切り替え)→ timing.json
src/build_scene.py         Blender: キャラ3匹・花畑・虹・アニメ・描画(PNG 連番)
src/sfx.py                 効果音の合成+ナレーションとのミックス(素材ダウンロードなし)
src/subtitles.py           字幕 PNG(M+ FONTS)
src/assemble.py            FFmpeg で 1080x1920 / 24fps の MP4 に
src/verify.py              仕様・音量・描画時間・色の検証と、静止フレームの書き出し
src/color_check.py         ブランド画像と描画フレームの色差(ΔE)
src/make_proto.sh          上を順に実行
evidence/                  静止フレーム(JPEG)と計測 JSON(Git 管理)
out/                       生成物(MP4・WAV・PNG 連番)。**Git 管理外**
```

## 実行
```
BRAND_IMAGE=/path/to/brand_banner.png bash src/make_proto.sh /path/to/blender
```
`BRAND_IMAGE` は色検証にだけ使う。リポジトリには入れていない。

## ナレーション音声の差し替え(VOICEVOX など)
後段(Blender の口パク・字幕・ミックス)は `out/work/timing.json` だけを見る。
音声を変えるときは `config/*.json` の `tts.provider` を変えるだけ。
- `openjtalk` … 既定。技術検証用(声は機械的)。
- `voicevox` … ローカルで VOICEVOX ENGINE を起動して `engine_url` / `speaker` を設定(**未検証**。利用規約・クレジットを確認すること)。
- `wav` … `assets/narration/n1.wav`, `n2.wav` を置く(収録音声・任意の TTS の出力)。
口パクは音声のフレーム別音量から自動で作る。

## 方針
- 作業場所はこのディレクトリだけ。他事業のファイルには触れない。
- MP4・WAV・.blend は Git に入れない(`.gitignore`)。スクリプトと設定のみ管理。
