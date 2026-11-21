"""書き出し(P12 / AC-V2〜V4, AC-E1, AC-E2)

- 残す区間を映像のフレーム境界にそろえ(snap_keep)、音声も同じ境界でサンプル単位に切る
- 既定は select 方式: 1本の映像ストリームで残すフレーム番号を指定するので、メモリが動画長に依存しない
- legacy / segments は比較・ベンチマーク用(tools/bench_render.py)
"""
import json
import os
import re
from fractions import Fraction

from . import proc

DEFAULT_MEM_LIMIT_MB = 3000          # 書き出しの FFmpeg の上限(超えたら止める。通常は約0.4GB)
ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]


def snap_keep(keep, fps):
    """残す区間(秒)を (開始フレーム, 終了フレーム[含まない]) にそろえる。丸めで重なったら結合する"""
    out = []
    for a, b in keep:
        k0, k1 = round(Fraction(a) * fps), round(Fraction(b) * fps)
        if out and k0 <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], k1))
        elif k1 > k0:
            out.append((k0, k1))
    return out


def frames_to_sec(frames, fps):
    return [(float(Fraction(k0) / fps), float(Fraction(k1) / fps)) for k0, k1 in frames]


def _fr(fps):
    return f"{fps.numerator}/{fps.denominator}"


def _ass_filter(ass):
    # ass フィルタのパスは : と \ と ' をエスケープする
    p = ass.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    return f",ass='{p}'"


def render_video(src, frames, fps, audio_wav, out, work, method="select", ass=None,
                 mem_limit_mb=DEFAULT_MEM_LIMIT_MB, timeout=None, encode=ENCODE):
    """残すフレーム区間 frames の映像に、用意済みの音声 audio_wav を付けて out に書き出す。
    戻り値: dict(method, seconds, ffmpeg_peak_mb)"""
    os.makedirs(work, exist_ok=True)
    if not frames:
        raise ValueError("残す区間がありません")
    sub = _ass_filter(ass) if ass else ""
    fr = _fr(fps)
    tmp_out = out + ".part.mp4"
    peak, secs = 0, 0.0
    if method == "select":
        expr = "+".join(f"between(n\\,{k0}\\,{k1 - 1})" for k0, k1 in frames)
        g = _write(os.path.join(work, "fg_select.txt"),
                   f"[0:v]fps={fr},select='{expr}',setpts=N/FRAME_RATE/TB{sub}[vout]")
        r = proc.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-i", audio_wav, "-filter_complex_script", g,
                      "-map", "[vout]", "-map", "1:a", *encode, "-r", fr, tmp_out], timeout=timeout, mem_limit_mb=mem_limit_mb)
        peak, secs = r["peak_mb"], r["seconds"]
    elif method == "legacy":
        secs_l = frames_to_sec(frames, fps)
        parts = [f"[0:v]trim={a:.6f}:{b:.6f},setpts=PTS-STARTPTS[v{i}]" for i, (a, b) in enumerate(secs_l)]
        tail = f"[vc];[vc]{sub[1:]}[vout]" if sub else "[vout]"
        parts.append("".join(f"[v{i}]" for i in range(len(secs_l))) + f"concat=n={len(secs_l)}:v=1:a=0{tail}")
        g = _write(os.path.join(work, "fg_legacy.txt"), ";".join(parts))
        r = proc.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-i", audio_wav, "-filter_complex_script", g,
                      "-map", "[vout]", "-map", "1:a", *encode, tmp_out], timeout=timeout, mem_limit_mb=mem_limit_mb)
        peak, secs = r["peak_mb"], r["seconds"]
    elif method == "segments":
        seg_dir = os.path.abspath(os.path.join(work, "segs"))
        os.makedirs(seg_dir, exist_ok=True)
        lst = []
        for i, (k0, k1) in enumerate(frames):
            sp = os.path.join(seg_dir, f"s{i:04d}.mkv")
            ss = max(0.0, float((Fraction(k0) - Fraction(1, 2)) / fps))
            r = proc.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{ss:.6f}", "-i", src, "-an", "-frames:v", str(k1 - k0),
                          "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", sp], timeout=timeout, mem_limit_mb=mem_limit_mb)
            peak, secs = max(peak, r["peak_mb"]), secs + r["seconds"]
            lst.append(f"file '{sp}'")
        listf = _write(os.path.join(work, "segs.txt"), "\n".join(lst) + "\n")
        r = proc.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listf, "-i", audio_wav,
                      "-vf", f"setpts=N/({fr})/TB{sub}", "-map", "0:v", "-map", "1:a", *encode, "-r", fr, tmp_out],
                     timeout=timeout, mem_limit_mb=mem_limit_mb)
        peak, secs = max(peak, r["peak_mb"]), secs + r["seconds"]
        for f in os.listdir(seg_dir):
            os.remove(os.path.join(seg_dir, f))
    else:
        raise ValueError(f"unknown method: {method}")
    os.replace(tmp_out, out)          # 書き出しが完了してから置き換える(途中の失敗で既存の出力を壊さない)
    return {"method": method, "seconds": round(secs, 2), "ffmpeg_peak_mb": peak}


def _write(path, text):
    with open(path, "w") as f:
        f.write(text)
    return path


def verify(path, expect_frames=None, expect_size=None, expect_fps=None):
    """出力の客観検証(AC-E1, AC-A6)。dict を返し、ok は全条件を満たすか"""
    j = json.loads(proc.run_text(["ffprobe", "-v", "error", "-count_packets", "-show_entries",
                                  "stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_packets,duration:format=duration",
                                  "-of", "json", path]))
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    a = next((s for s in j["streams"] if s["codec_type"] == "audio"), None)
    fps = Fraction(v["avg_frame_rate"])
    nframes = int(v.get("nb_read_packets") or 0)
    vdur = nframes / float(fps) if fps else 0.0
    adur = float(a.get("duration") or 0) if a else 0.0
    err = _ebur(path)
    res = {"vcodec": v["codec_name"], "acodec": a["codec_name"] if a else None, "width": int(v["width"]),
           "height": int(v["height"]), "fps": f"{fps.numerator}/{fps.denominator}", "frames": nframes,
           "video_sec": round(vdur, 4), "audio_sec": round(adur, 4),
           "av_diff_sec": round(abs(vdur - adur), 4), **err}
    checks = {"has_audio": a is not None, "av_within_1_frame": a is not None and abs(vdur - adur) <= 1.0 / float(fps) + 1e-3}
    if expect_frames is not None:
        checks["frames_match"] = nframes == expect_frames
    if expect_size is not None:
        checks["size_match"] = (res["width"], res["height"]) == tuple(expect_size)
    if expect_fps is not None:
        checks["fps_match"] = fps == Fraction(expect_fps)
    if res.get("true_peak_dbtp") is not None:
        checks["true_peak_ok"] = res["true_peak_dbtp"] <= -1.0
    res["checks"] = checks
    res["ok"] = all(checks.values())
    return res


def _ebur(path):
    import subprocess
    e = subprocess.run(["ffmpeg", "-nostats", "-i", path, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", e)
    p = re.findall(r"Peak:\s+(-?(?:inf|nan|[\d.]+)) dBFS", e)
    return {"integrated_lufs": float(i[-1]) if i else None, "true_peak_dbtp": float(p[-1]) if p else None}
