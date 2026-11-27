"""描画済みフレーム + 字幕 + 音声 → 1080x1920 / 24fps の MP4(H.264+AAC)。
--hold N で N コマ打ちの連番(f0001, f0003, ...)を 24fps に複製する。
使い方: python3 -I src/assemble.py <config.json> <workdir> <frames_dir> <out.mp4> [hold]
"""
import json, sys, os, glob, subprocess


def main(cfg_path, workdir, frames, out, hold=1):
    c = json.load(open(cfg_path, encoding="utf-8"))
    fps, dur = c["fps"], c["duration_sec"]
    cues = json.load(open(os.path.join(workdir, "subtitle_cues.json")))
    files = sorted(glob.glob(os.path.join(frames, "f*.png")))
    need = int(round(fps * dur / hold))
    if len(files) != need:
        raise SystemExit(f"フレーム数が合わない: {len(files)} != {need}")
    cmd = ["ffmpeg", "-y", "-v", "error", "-framerate", str(fps / hold), "-pattern_type", "glob",
           "-i", os.path.join(frames, "f*.png")]
    for q in cues:
        cmd += ["-loop", "1", "-i", q["png"]]
    cmd += ["-i", os.path.join(workdir, "mix.wav")]
    fc = f"[0:v]fps={fps},format=yuv420p[v0]"
    last = "v0"
    for i, q in enumerate(cues, 1):
        fc += f";[{last}][{i}:v]overlay=0:{q['y_top']}:enable='between(t,{q['start']:.3f},{q['end']:.3f})':format=auto[v{i}]"
        last = f"v{i}"
    fc += f";[{last}]format=yuv420p[vout]"
    cmd += ["-filter_complex", fc, "-map", "[vout]", "-map", f"{len(cues)+1}:a",
            "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", str(dur), "-r", str(fps),
            "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True)
    print("wrote", out)


if __name__ == "__main__":
    a = sys.argv
    main(a[1], a[2], a[3], a[4], int(a[5]) if len(a) > 5 else 1)
