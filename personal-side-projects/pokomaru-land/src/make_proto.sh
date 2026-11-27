#!/usr/bin/env bash
# 8秒試作を最初から作る(すべて無料ツール)。 使い方: bash src/make_proto.sh [BLENDER_BIN]
# 前提: python3(numpy, Pillow), ffmpeg, open_jtalk(+辞書+音声), M+ FONTS, Blender 4.2 LTS(デノイズ付き公式ビルド)
set -euo pipefail
cd "$(dirname "$0")/.."
CFG=config/ep01_proto8s.json
BLENDER=${1:-/opt/blender42/blender-4.2.3-linux-x64/blender}
BRAND=${BRAND_IMAGE:-docs/brand_reference/banner.png}   # ブランド画像(Git 管理外。色検証にのみ使用)
W=out/work; F=out/frames; mkdir -p "$W" "$F" evidence

python3 -I src/tts.py $CFG $W                                   # 1. ナレーション+タイミング
$BLENDER -b --python src/build_scene.py -- --config $CFG --timing $W/timing.json \
  --out $F --hold 2 --samples 16 | tee out/render.log            # 2. 3D 描画(CPU, 2コマ打ち)
python3 -I src/sfx.py $W/timing.json $W                          # 3. 効果音+ミックス
python3 -I src/subtitles.py $CFG $W/timing.json $W               # 4. 字幕
python3 -I src/assemble.py $CFG $W $F out/ep01_proto8s.mp4 2     # 5. MP4
python3 -I src/verify.py out/ep01_proto8s.mp4 $CFG out/render_log_1_192_1.json "$BRAND" $F evidence   # 6. 検証
