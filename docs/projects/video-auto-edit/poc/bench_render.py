"""P12 書き出し方式のベンチマーク(再現可能なテスト素材を生成して検証する)

使い方:
    python bench_render.py <作業フォルダ> [--durations 30,60,180,300] [--methods legacy,select,segments]
                           [--size 1080x1920] [--fps 30] [--mem-limit-mb 12000]

テスト素材:
  - 映像: 横4列のブロック。列0〜2の明るさでフレーム番号を22進数3桁として表し、列3は毎秒先頭のフレームだけ白(フラッシュ)
  - 音声: 毎秒の先頭に 50ms の 1kHz ビープ
残す区間は乱数(固定シード)で、1.0〜4.0秒を残し 0.3〜1.2秒を捨てる、を繰り返す(実動画の区間密度に近い)。

検証:
  - フレーム: 出力の各フレームから元のフレーム番号を読み取り、期待どおりの番号列か(欠落・重複・入れ替わり)
  - 同期: 出力内のフラッシュ(映像)とビープ(音声)の時刻差
  - 解像度・フレームレート・映像と音声の長さ
"""
import argparse, json, os, random, sys, time
from fractions import Fraction

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render  # noqa: E402

BASE, STEP, OFF = 22, 10, 15     # 明るさ = 桁 * 10 + 15(15〜225)


def make_source(path, dur, w, h, fps):
    if os.path.exists(path):
        return
    lum = (f"if(eq(X,0),mod(N,{BASE})*{STEP}+{OFF},if(eq(X,1),mod(floor(N/{BASE}),{BASE})*{STEP}+{OFF},"
           f"if(eq(X,2),floor(N/{BASE * BASE})*{STEP}+{OFF},if(eq(mod(N,{fps}),0),235,16))))")
    render.sh(["ffmpeg", "-y", "-v", "error",
               "-f", "lavfi", "-i", f"color=c=black:s=4x2:r={fps}:d={dur}",
               "-f", "lavfi", "-i", f"aevalsrc='if(lt(mod(t,1),0.05),0.5*sin(2*PI*1000*t),0)':s=48000:d={dur}",
               "-vf", f"format=gray,geq=lum='{lum}',scale={w}:{h}:flags=neighbor,format=yuv420p",
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-g", "60", "-c:a", "aac", "-b:a", "192k",
               "-ac", "2", path])


def make_keep(dur, seed=7):
    rnd, t, keep = random.Random(seed), 0.2, []
    while t < dur - 0.5:
        k = rnd.uniform(1.0, 4.0)
        keep.append((round(t, 3), round(min(t + k, dur), 3)))
        t += k + rnd.uniform(0.3, 1.2)
    return keep


def decode_indices(path):
    """出力の各フレームを 4x1 に縮小して明るさを読み、元のフレーム番号とフラッシュの有無を返す"""
    # gray へ変換すると明るさの範囲が引き伸ばされるので、yuv420p のまま Y 成分の1行目(4画素)を読む
    # 列の境目は圧縮でにじむため、横12分割して各列の中央1/3(1,4,7,10番目)だけを読む
    raw = subprocess_out(["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=12:2:flags=area,format=yuv420p",
                          "-f", "rawvideo", "-"])
    a = np.frombuffer(raw, np.uint8).reshape(-1, 36)[:, [1, 4, 7, 10]].astype(float)
    lum = (a - 16) * 255 / 219            # 素材生成時の gray(全範囲) → yuv(放送範囲) 変換を戻す
    d = np.clip(np.round((lum[:, :3] - OFF) / STEP), 0, BASE - 1).astype(int)
    idx = d[:, 0] + d[:, 1] * BASE + d[:, 2] * BASE * BASE
    return idx, a[:, 3] > 128


def subprocess_out(cmd):
    import subprocess
    return subprocess.run(cmd, check=True, capture_output=True).stdout


def beep_onsets(path, sr=48000):
    raw = subprocess_out(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"])
    x = np.abs(np.frombuffer(raw, np.float32))
    env = np.convolve(x, np.ones(48) / 48, mode="same") > 0.1
    on = np.flatnonzero(env[1:] & ~env[:-1]) + 1
    res, last = [], -1e9
    for i in on:
        if i - last > sr * 0.08:   # ビープは50ms。カット後は別のビープが0.5秒以内に並ぶことがある
            res.append(i / sr); last = i
    return np.array(res)


def verify(out, frames, fps):
    info = render.probe(out)
    exp = np.concatenate([np.arange(k0, k1) for k0, k1 in frames])
    got, flash = decode_indices(out)
    n = min(len(exp), len(got))
    mism = int((exp[:n] != got[:n]).sum()) + abs(len(exp) - len(got))
    dups = int((np.diff(got) == 0).sum())
    missing = int(len(set(exp.tolist()) - set(got.tolist())))
    # 同期: 期待どおりの位置にあるフラッシュ(=毎秒の先頭フレーム)と、最寄りのビープの時刻差
    beeps = beep_onsets(out)
    offs = []
    for i in np.flatnonzero(flash):
        if i >= len(exp) or got[i] % int(round(float(fps))) != 0:
            continue
        # ビープ(50ms)が区間内に収まっているものだけ使う
        seg = next(((k0, k1) for k0, k1 in frames if k0 <= got[i] < k1), None)
        # 区間の終わり際(ビープが切れる)と、区間の先頭3フレーム以内(直前の区間の末尾に切れたビープが
        # 残っていると、出力上で2つのビープが隣り合い区別できない)は除外する
        if not seg or (seg[1] - got[i]) / float(fps) < 0.1 or got[i] - seg[0] < 3:
            continue
        t_v = i / float(fps)
        if len(beeps):
            offs.append(float(beeps[np.argmin(np.abs(beeps - t_v))] - t_v))
    vd = len(got) / float(fps)
    return dict(width=info["width"], height=info["height"], fps=str(info["fps"]), frames_expected=int(len(exp)),
                frames_out=int(len(got)), frame_mismatch=mism, duplicated=dups, missing=missing,
                sync_checks=len(offs), sync_max_abs_ms=round(max(map(abs, offs)) * 1000, 1) if offs else None,
                sync_mean_ms=round(float(np.mean(offs)) * 1000, 1) if offs else None,
                video_sec=round(vd, 3), container_sec=round(info["duration"], 3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("--durations", default="30,60,180,300")
    ap.add_argument("--methods", default="legacy,select,segments")
    ap.add_argument("--size", default="1080x1920")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--mem-limit-mb", type=int, default=12000)
    a = ap.parse_args()
    w, h = map(int, a.size.split("x"))
    os.makedirs(a.work, exist_ok=True)
    rows = []
    for d in map(int, a.durations.split(",")):
        src = os.path.join(a.work, f"src_{d}s_{w}x{h}.mp4")
        make_source(src, d, w, h, a.fps)
        fps = render.probe(src)["fps"]
        frames = render.snap_keep(make_keep(d), fps)
        audio = os.path.join(a.work, f"audio_{d}.wav")
        render.write_wav(audio, render.cut_audio(render.read_audio(src), 48000, frames, fps), 48000)
        for m in a.methods.split(","):
            out = os.path.join(a.work, f"out_{d}s_{m}.mp4")
            row = dict(duration=d, size=a.size, method=m, segments=len(frames))
            try:
                row.update(render.render_video(src, frames, fps, audio, out, os.path.join(a.work, f"w_{d}_{m}"),
                                               method=m, mem_limit_mb=a.mem_limit_mb))
                row.update(verify(out, frames, fps))
                row["status"] = "ok"
            except render.MemoryLimitExceeded as e:
                row.update(status="stopped", error=str(e))
            except Exception as e:  # noqa: BLE001
                row.update(status="failed", error=str(e)[-300:])
            print(json.dumps(row, ensure_ascii=False), flush=True)
            rows.append(row)
    json.dump(rows, open(os.path.join(a.work, "bench_results.json"), "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
