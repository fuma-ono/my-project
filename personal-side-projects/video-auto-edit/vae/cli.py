"""コマンドライン

  python -m vae run 入力.mp4 -o 出力.mp4 [--model medium] [--work 作業フォルダ] [--plan free|standard|none]
  python -m vae verify 出力.mp4
  python -m vae web [--host 127.0.0.1] [--port 8765] [--data data]
"""
import argparse
import json
import os
import sys
import tempfile

from . import errors, media, pipeline, plans, render


def main(argv=None):
    ap = argparse.ArgumentParser(prog="vae", description="動画自動編集AI(ローカル実行)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="動画を自動編集して書き出す")
    r.add_argument("input")
    r.add_argument("-o", "--output", required=True)
    r.add_argument("--work", help="作業フォルダ(指定しない場合は一時フォルダを使い、終了時に削除する)")
    r.add_argument("--keep-work", action="store_true", help="一時の作業フォルダを残す(文字起こし全文を含むので注意)")
    r.add_argument("--model", default="medium")
    r.add_argument("--cut-mode", default="vad", choices=["vad", "volume"])
    r.add_argument("--mix", default="duck_vad", choices=["duck_vad", "duck_sc", "legacy"])
    r.add_argument("--no-bgm", action="store_true")
    r.add_argument("--no-subtitles", action="store_true")
    r.add_argument("--plan", default="none", help="料金プランの上限を適用する(free=30秒)。none は制限なし(開発用)")
    v = sub.add_parser("verify", help="書き出した動画を検証する")
    v.add_argument("path")
    w = sub.add_parser("web", help="ローカル Web UI を起動する")
    w.add_argument("--host", default="127.0.0.1")
    w.add_argument("--port", type=int, default=8765)
    w.add_argument("--data", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"))
    a = ap.parse_args(argv)

    if a.cmd == "verify":
        print(json.dumps(render.verify(a.path), ensure_ascii=False, indent=1))
        return 0
    if a.cmd == "web":
        from .web.server import serve
        serve(a.host, a.port, a.data)
        return 0
    try:
        if a.plan != "none":
            p = plans.get(a.plan)
            media.validate(a.input, max_seconds=p.max_project_seconds, plan_name=p.label)
        else:
            media.validate(a.input)
        s = pipeline.Settings(model=a.model, cut_mode=a.cut_mode, mix_mode=a.mix, bgm=not a.no_bgm,
                              subtitles=not a.no_subtitles)
        work = a.work or tempfile.mkdtemp(prefix="vae_")
        cb = lambda st, fr, msg: print(f"[{fr * 100:5.1f}%] {msg}", file=sys.stderr, flush=True)
        try:
            plan, res = pipeline.run(a.input, a.output, work, s, progress=cb)
        finally:
            if not a.work and not a.keep_work:
                import shutil
                shutil.rmtree(work, ignore_errors=True)   # 一時の作業フォルダ(文字起こし全文を含む)を残さない
        print(json.dumps({"output": a.output, "work": work, "out_duration": plan["out_duration"], "verify": res["verify"],
                          "mix_metrics": res["mix_metrics"], "timings_sec": res["timings_sec"],
                          "render_peak_mb": res["render"]["ffmpeg_peak_mb"]}, ensure_ascii=False, indent=1))
        return 0 if res["verify"]["ok"] else 2
    except errors.VAEError as e:
        print(f"エラー: {e.message}\n対処: {e.hint}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
