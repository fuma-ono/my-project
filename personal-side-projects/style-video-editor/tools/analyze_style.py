#!/usr/bin/env python3
"""
スタイル分析ツール(第一段階: ルールベース)

参考動画(自作・許諾済みのものに限る。docs/legal-policy.md参照)を読み込み、
カット割りのリズムを数値化して「スタイルプロファイル」としてJSON出力する。

これは「ディープラーニングでスタイルを学習するAI」ではなく、
「動画を解析してカット割りパターンを数値ルールとして抽出するツール」。
将来ここにテロップ検出・BGM検出を追加していく土台。

依存: opencv-python-headless, scenedetect (system ffmpegは不要)
    pip install opencv-python-headless scenedetect

使い方:
    python3 analyze_style.py <動画ファイル> [--style-name 解説系]
"""
import argparse
import json
import statistics
import sys
from pathlib import Path

from scenedetect import open_video, SceneManager
from scenedetect.detectors import ContentDetector


def detect_cuts(video_path: str, threshold: float = 27.0):
    """シーン(カット)の境界を検出し、各カットの開始・終了秒を返す。"""
    video = open_video(video_path)
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=threshold))
    scene_manager.detect_scenes(video)
    scene_list = scene_manager.get_scene_list()
    return [
        (start.seconds, end.seconds)
        for start, end in scene_list
    ]


def build_style_profile(cuts, style_name: str, source_file: str):
    """カット情報から、後で自動編集エンジンが使うスタイルプロファイルを作る。"""
    if not cuts:
        return {
            "style_name": style_name,
            "source_file": source_file,
            "cut_count": 0,
            "note": "カットが検出されませんでした(動画が短すぎる/変化が乏しい可能性)。",
        }

    shot_lengths = [end - start for start, end in cuts]
    total_duration = cuts[-1][1]

    profile = {
        "style_name": style_name,
        "source_file": source_file,
        "total_duration_sec": round(total_duration, 2),
        "cut_count": len(cuts),
        "shot_length": {
            "mean_sec": round(statistics.mean(shot_lengths), 2),
            "median_sec": round(statistics.median(shot_lengths), 2),
            "min_sec": round(min(shot_lengths), 2),
            "max_sec": round(max(shot_lengths), 2),
            "stdev_sec": round(statistics.pstdev(shot_lengths), 2) if len(shot_lengths) > 1 else 0.0,
        },
        "cuts_per_minute": round(len(cuts) / (total_duration / 60), 2) if total_duration > 0 else None,
        "shots": [
            {"start_sec": round(s, 2), "end_sec": round(e, 2), "length_sec": round(e - s, 2)}
            for s, e in cuts
        ],
    }
    return profile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", help="参考動画のパス(自作・許諾済みのもののみ)")
    parser.add_argument("--style-name", default="unnamed_style", help="このスタイルの名前(例: 解説系)")
    parser.add_argument("--threshold", type=float, default=27.0, help="カット検出の感度(低いほど敏感)")
    parser.add_argument("--out", default=None, help="出力JSONパス(省略時は標準出力)")
    args = parser.parse_args()

    if not Path(args.video).exists():
        print(f"エラー: 動画が見つかりません: {args.video}", file=sys.stderr)
        sys.exit(1)

    cuts = detect_cuts(args.video, threshold=args.threshold)
    profile = build_style_profile(cuts, args.style_name, args.video)

    output = json.dumps(profile, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"スタイルプロファイルを書き出しました: {args.out}")
    else:
        print(output)


if __name__ == "__main__":
    main()
