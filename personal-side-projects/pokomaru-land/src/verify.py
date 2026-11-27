"""完成 MP4 の客観チェックと証拠の書き出し(実測のみ。音の良し悪しは判断しない)。
  - 解像度・fps・総フレーム数・長さ・コーデック(ffprobe)
  - 音量(ffmpeg ebur128)と無音でないこと
  - 静止フレームを evidence/ に JPEG で保存+コンタクトシート
  - レンダリング時間のログ集計
  - 色の正確さ(ブランド画像と描画 PNG、および MP4 から取り出した静止画)
使い方: python3 -I src/verify.py <mp4> <config.json> <render_log.json> <ブランド画像> <frames_dir> <evidence_dir>
"""
import json, re, subprocess, sys, os, statistics
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import color_check


def sh(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def main(mp4, cfg, rlog, brand, frames, ev):
    os.makedirs(ev, exist_ok=True)
    c = json.load(open(cfg, encoding="utf-8"))
    pr = json.loads(sh(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", mp4]).stdout)
    v = next(s for s in pr["streams"] if s["codec_type"] == "video")
    a = next((s for s in pr["streams"] if s["codec_type"] == "audio"), None)
    spec = {
        "width": v["width"], "height": v["height"], "r_frame_rate": v["r_frame_rate"],
        "frames_counted": int(v["nb_read_frames"]), "duration_sec": round(float(pr["format"]["duration"]), 3),
        "video_codec": v["codec_name"], "pix_fmt": v["pix_fmt"], "audio_codec": a and a["codec_name"],
        "audio_rate": a and a["sample_rate"], "size_bytes": int(pr["format"]["size"]),
    }
    spec["ok_1080x1920"] = (spec["width"], spec["height"]) == (1080, 1920)
    spec["ok_24fps"] = spec["r_frame_rate"] == "24/1"
    spec["ok_192_frames"] = spec["frames_counted"] == 192
    r = sh(["ffmpeg", "-nostats", "-i", mp4, "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
    m = r[r.rfind("Summary:"):]
    loud = {"integrated_LUFS": float(re.search(r"I:\s+(-?[\d.]+) LUFS", m).group(1)),
            "true_peak_dBFS": float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", m).group(1))}
    # 静止フレーム
    stills = []
    for t in (0.4, 2.0, 4.0, 5.0, 6.5, 7.5):
        p = os.path.join(ev, f"still_t{int(t*10):02d}.jpg")
        sh(["ffmpeg", "-y", "-v", "error", "-ss", str(t), "-i", mp4, "-frames:v", "1", "-q:v", "3", p])
        stills.append(p)
    ims = [Image.open(p).resize((360, 640)) for p in stills]
    sheet = Image.new("RGB", (360 * len(ims) + 8 * (len(ims) - 1), 640), "white")
    for i, im in enumerate(ims):
        sheet.paste(im, (i * 368, 0))
    sheet.save(os.path.join(ev, "contact_sheet.jpg"), quality=88)
    # レンダリング時間
    L = json.load(open(rlog))
    secs = [f["sec"] for f in L["frames"]]
    first = secs[0]
    rest = secs[1:]
    render = {"engine": L["engine"], "samples": L["samples"], "resolution": L["res"],
              "frames_rendered": len(secs), "total_sec": L["total_sec"], "mean_sec": round(statistics.mean(secs), 1),
              "median_sec": round(statistics.median(secs), 1), "min_sec": min(secs), "max_sec": max(secs),
              "first_frame_sec": first, "mean_excl_first_sec": round(statistics.mean(rest), 1) if rest else None}
    render["est_all_192_frames_min"] = round(render["mean_sec"] * 192 / 60, 1)
    # 色
    png = os.path.join(frames, "f0121.png")
    cc_png = []
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        color_check.main(brand, png, os.path.join(ev, "color_check_png.json"))
    cc_png = json.load(open(os.path.join(ev, "color_check_png.json"), encoding="utf-8"))
    mp4_still = os.path.join(ev, "still_t50.jpg")
    with contextlib.redirect_stdout(buf):
        color_check.main(brand, mp4_still, os.path.join(ev, "color_check_mp4.json"))
    cc_mp4 = json.load(open(os.path.join(ev, "color_check_mp4.json"), encoding="utf-8"))
    out = {"spec": spec, "loudness": loud, "render_time": render, "color_png_f0121": cc_png, "color_mp4_t5.0": cc_mp4}
    json.dump(out, open(os.path.join(ev, "proto8s_metrics.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:7])
