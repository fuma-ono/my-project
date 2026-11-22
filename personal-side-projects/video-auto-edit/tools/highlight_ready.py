"""ハイライト PoC の準備状況の確認

  python tools/highlight_ready.py                 合成素材での通し確認(機能の確認だけ。実動画の品質の証明ではない)
  python tools/highlight_ready.py <動画フォルダ>   実動画の事前点検(読めるか・真っ黒でないか・音声があるか・撮影日時・見積もり)

どちらも API には送らない(費用0円)。API キーの値は表示しない(あるかないかだけ)。
"""
import glob
import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402

from vae import media, proc, render  # noqa: E402

VIDEO_EXT = (".mp4", ".mov", ".m4v", ".mkv", ".webm")
SYNTH = ["testsrc2=s=720x1280:r=30", "mandelbrot=s=720x1280:r=30", "smptehdbars=s=1280x720:r=30",
         "life=s=720x1280:r=30:mold=10:ratio=0.5", "gradients=s=1280x720:r=30", "rgbtestsrc=s=720x1280:r=30"]


def brightness(path, dur):
    """3か所のフレームの平均の明るさ(0〜255)。真っ黒の動画を見つける"""
    vals = []
    for f in (0.15, 0.5, 0.85):
        try:
            raw = proc.run_bytes(["ffmpeg", "-v", "error", "-ss", f"{dur * f:.2f}", "-i", path, "-frames:v", "1",
                                  "-vf", "scale=64:64", "-f", "rawvideo", "-pix_fmt", "gray", "-"], timeout=60)
            vals.append(float(np.frombuffer(raw, np.uint8).mean()) if raw else 0.0)
        except Exception:
            vals.append(0.0)
    return max(vals)


def key_state():
    return "設定あり(値は表示しません)" if os.environ.get("ANTHROPIC_API_KEY") else "未設定"


def preflight(folder):
    from vae.highlight import analyze, planner_llm
    files = sorted(p for p in glob.glob(os.path.join(folder, "*")) if p.lower().endswith(VIDEO_EXT))
    rows, bad = [], 0
    total = 0.0
    for p in files:
        try:
            info = media.probe(p)
        except Exception as e:
            rows.append((os.path.basename(p), "読めない", "", "", "", "", f"NG: {type(e).__name__}"))
            bad += 1
            continue
        b = brightness(p, info.duration)
        when, src = analyze.creation_time(p)
        note = []
        if b < 8:
            note.append("映像がほぼ真っ黒")
        if info.acodec is None:
            note.append("音声なし")
        if info.duration < 1.0:
            note.append("短すぎる")
        if src != "metadata":
            note.append("撮影日時なし(更新日時で代用)")
        bad += bool(b < 8 or info.duration < 1.0)
        total += info.duration
        rows.append((os.path.basename(p), f"{info.duration:.1f}秒", f"{info.width}x{info.height}", f"{os.path.getsize(p) / 1e6:.1f}MB",
                     time.strftime("%m/%d %H:%M", time.gmtime(when)), f"明るさ {b:.0f}", "; ".join(note) or "OK"))
    print(f"動画 {len(files)} 本、合計 {total:.0f} 秒({total / 60:.1f}分)")
    for r in rows:
        print("  " + " | ".join(r))
    ledger = planner_llm.load_ledger()
    est_proc = total * 1.4
    print(f"\n- 処理時間の見込み(この環境、無料版の解析と書き出し。文字起こしなし): 約 {est_proc / 60:.0f} 分(実測では素材1秒あたり約 1.3〜2 秒)")
    print(f"- API キー: {key_state()}")
    print(f"- API 予算: 使用済み {planner_llm.spent_jpy(ledger):.0f} 円 / 上限 {ledger.get('cap_jpy', planner_llm.BUDGET_JPY):.0f} 円(台帳 {planner_llm.LEDGER})")
    print(f"- 問題のある動画: {bad} 本" + ("(上の NG・真っ黒を確認してください)" if bad else ""))
    return bad


def selftest():
    """合成素材で、無料版 → 擬似の Sonnet 版(送信しない)→ 書き出し → 検証 を通す。機能の確認であり、品質の証明ではない"""
    from vae import vad
    from vae.highlight import analyze, music, planner, planner_llm
    from vae.highlight import render as hr
    work = tempfile.mkdtemp(prefix="vae_ready_")
    t0 = time.time()
    paths = []
    for i, src in enumerate(SYNTH):
        p = os.path.join(work, f"c{i}.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", src, "-f", "lavfi", "-i", f"sine=f={220 + i * 40}:sample_rate=48000",
                        "-t", str(5 + i), "-metadata", f"creation_time=2026-05-0{i + 1}T10:00:00Z", "-c:v", "libx264", "-preset", "ultrafast",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", p], check=True)
        paths.append(p)
    an = analyze.Analyzer(transcriber=None, vad_fn=lambda x: vad.speech_vad(x, 0.5, 0.4))
    clips = [an.clip_file(p, i) for i, p in enumerate(paths)]
    free = planner.plan(clips)
    track, _, _, bpm = music.generate(free["target_sec"] * 1.5 + 10, free["mood"])
    free = planner.plan(clips, target=free["target_sec"], mood=free["mood"], beat=60.0 / bpm)
    out1 = os.path.join(work, "free.mp4")
    hr.render(clips, free, out1, os.path.join(work, "r1"), music_track=track)
    # 擬似の Sonnet: 実際には送らない。送る内容の組み立て・予算の確認・結果の検査・書き出しまでを通す
    planner.frame_scores(clips)
    cands = planner.candidates(clips)
    content, n_img, img_tok = planner_llm.build_request(clips, cands)
    est = planner_llm.estimate(content, n_images=n_img, image_tokens=img_tok)
    planner_llm.check_budget(est, {"cap_jpy": planner_llm.BUDGET_JPY, "runs": []})
    choice = {"story": "(自己確認用の擬似の応答)", "mood": free["mood"], "target_sec": free["target_sec"],
              "segments": [{"id": c["id"], "reason": "自己確認"} for c in cands[::2]], "excluded": []}
    chosen, problems = planner_llm.validate(choice, cands, clips)
    planner.snap_to_beats(chosen, clips, 60.0 / bpm)
    llm = {"mood": free["mood"], "segments": [{k: v for k, v in c.items() if k != "emb"} for c in chosen]}
    out2 = os.path.join(work, "llm.mp4")
    hr.render(clips, llm, out2, os.path.join(work, "r2"), music_track=track)
    bad = 0
    for name, out in (("無料版", out1), ("擬似 Sonnet 版", out2)):
        v = render.verify(out)
        print(f"- {name}: {v['width']}x{v['height']} {v['video_sec']}秒 映像と音声のずれ {v['av_diff_sec']}秒 True Peak {v.get('true_peak_dbtp')} → {'OK' if v['ok'] else 'NG'}")
        bad += not v["ok"]
    print(f"- 送る内容の見積もり: 画像 {n_img} 枚、最悪 {est['jpy_worst']} 円(送信していません)")
    print(f"- 所要 {time.time() - t0:.0f} 秒。API キー: {key_state()}")
    print("※ 合成素材での機能の確認です。実動画の品質の証明ではありません。")
    return bad


if __name__ == "__main__":
    sys.exit(1 if (preflight(sys.argv[1]) if len(sys.argv) > 1 else selftest()) else 0)
