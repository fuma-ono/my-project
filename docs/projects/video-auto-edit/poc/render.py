"""書き出し・音声ミックス(検証用。本実装ではない)

P12: 映像のカット方式を3つ用意し、メモリ・時間・正確性を比較できるようにする。
  - legacy   : 区間ごとに入力映像を trim で分岐し concat する(第1〜3回の方式)。
               後の区間で使う未圧縮フレームがメモリに溜まる。
  - select   : 1本の映像ストリームに select で残すフレーム番号を指定する(単一ストリーム)。
  - segments : 区間ごとに別プロセスで中間ファイルへ書き出し、連結してから仕上げる(2回エンコード)。
  どの方式でも、残す区間の境界は映像のフレーム境界にそろえ(snap_keep)、
  音声は同じ境界でサンプル単位に切る。これで映像と音声の長さが区間ごとに一致し、ずれが積み重ならない。

P11: 声を主役にしたミックス。
  - legacy   : 第1〜3回の方式(BGM 0.35倍固定 + サイドチェイン + 全体を loudnorm)
  - duck_sc  : 声を目標ラウドネスに静的にそろえ、BGM も声基準で静的にそろえてからサイドチェインで下げる
  - duck_vad : 同上。ただし BGM の下げ幅は「発話区間」から作った滑らかな音量カーブで決める(声の大小に依存しない)
"""
from fractions import Fraction
import json, os, re, resource, subprocess, time

import numpy as np


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def probe(path):
    j = json.loads(sh(["ffprobe", "-v", "error", "-show_entries",
                       "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels:stream_side_data=rotation",
                       "-of", "json", path]).stdout)
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    a = next((s for s in j["streams"] if s["codec_type"] == "audio"), None)
    fps = Fraction(v.get("avg_frame_rate") or v["r_frame_rate"])
    if fps <= 0:
        fps = Fraction(v["r_frame_rate"])
    return dict(duration=float(j["format"]["duration"]), fps=fps, width=v["width"], height=v["height"],
                vfr=v.get("avg_frame_rate") != v.get("r_frame_rate"),
                sample_rate=int(a["sample_rate"]) if a else None, channels=int(a["channels"]) if a else 0)


def snap_keep(keep, fps):
    """残す区間を映像フレームの境界にそろえる。戻り値は (開始フレーム, 終了フレーム[含まない]) のリスト"""
    out = []
    for a, b in keep:
        k0, k1 = round(a * fps), round(b * fps)
        if out and k0 <= out[-1][1]:            # 丸めで隣と重なったら結合
            out[-1] = (out[-1][0], max(out[-1][1], k1))
        elif k1 > k0:
            out.append((k0, k1))
    return out


def frames_to_sec(frames, fps):
    return [(float(Fraction(k0) / fps), float(Fraction(k1) / fps)) for k0, k1 in frames]


# ---------------------------------------------------------------- 音声
def read_audio(path, sr=48000, ch=2):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).copy()


def write_wav(path, a, sr):
    import soundfile as sf
    sf.write(path, a, sr, subtype="FLOAT")


def cut_audio(a, sr, frames, fps, fade=0.01):
    """フレーム境界と同じ位置でサンプル単位に切り、各区間の端に短いフェードを付けてつなぐ"""
    parts, nf = [], int(sr * fade)
    for k0, k1 in frames:
        s0, s1 = round(Fraction(k0) / fps * sr), round(Fraction(k1) / fps * sr)
        seg = a[s0:s1].copy()
        if len(seg) < s1 - s0:                   # 音声が映像より短い素材の保険
            seg = np.vstack([seg, np.zeros((s1 - s0 - len(seg), a.shape[1]), np.float32)])
        n = min(nf, len(seg) // 2)
        if n:
            ramp = np.linspace(0, 1, n, dtype=np.float32)[:, None]
            seg[:n] *= ramp
            seg[-n:] *= ramp[::-1]
        parts.append(seg)
    return np.vstack(parts) if parts else np.zeros((0, a.shape[1]), np.float32)


def integrated_lufs(path):
    err = subprocess.run(["ffmpeg", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", err)
    p = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", err)
    return (float(i[-1]) if i else None, float(p[-1]) if p else None)


def momentary(path):
    """100ms ごとの momentary ラウドネス(400ms 窓)。(時刻, LUFS) の配列"""
    err = subprocess.run(["ffmpeg", "-nostats", "-i", path, "-af", "ebur128=metadata=1,ametadata=print:key=lavfi.r128.M",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    t = [float(x) for x in re.findall(r"pts_time:([\d.]+)", err)]
    m = [float(x) for x in re.findall(r"lavfi\.r128\.M=(-?[\d.inf]+)", err)]
    n = min(len(t), len(m))
    return np.array(t[:n]), np.maximum(np.array(m[:n]), -70.0)


def speech_gain_curve(n, sr, speech, depth_db, down=0.25, up=0.6):
    """発話区間(出力の時刻)で depth_db 下げ、区間外で 0dB に戻す滑らかな音量カーブ(コサインの立ち上がり)"""
    target = np.zeros(n, np.float32)
    for a, b in speech:
        target[int(a * sr):int(b * sr)] = 1.0
    # 下げは速く(down秒)、戻しは遅く(up秒)。非対称のワンポール平滑化を区間単位で行う代わりに、
    # 端点ごとにコサイン形のランプを置く(1本の配列演算で済み、ポンピングが起きない)
    g = np.zeros(n, np.float32)
    nd, nu = max(1, int(down * sr)), max(1, int(up * sr))
    for a, b in speech:
        s, e = int(a * sr), int(b * sr)
        rs = max(0, s - nd)
        ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, s - rs, dtype=np.float32)) if s > rs else np.zeros(0, np.float32)
        g[rs:s] = np.maximum(g[rs:s], ramp)
        g[s:e] = 1.0
        re_ = min(n, e + nu)
        ramp = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, re_ - e, dtype=np.float32))
        g[e:re_] = np.maximum(g[e:re_], ramp)
    return (10 ** (depth_db * g / 20)).astype(np.float32)


def mix_audio(voice_path, bgm_path, work, mode, speech, sr=48000, voice_target=-16.0, bgm_offset=14.0, duck_db=-10.0):
    """声(カット済み)と BGM をミックスし、最終音声と評価用の素材(stem)を書き出す。
    戻り値: 設定と計測に必要なパス・値"""
    v = read_audio(voice_path, sr)
    n = len(v)
    bgm = read_audio(bgm_path, sr)
    if len(bgm) < n:                              # 足りなければループ
        bgm = np.tile(bgm, (n // max(len(bgm), 1) + 1, 1))
    bgm = bgm[:n].copy()
    fade_in, fade_out = int(1.0 * sr), int(1.5 * sr)
    if n > fade_in + fade_out:
        bgm[:fade_in] *= np.linspace(0, 1, fade_in, dtype=np.float32)[:, None]
        bgm[-fade_out:] *= np.linspace(1, 0, fade_out, dtype=np.float32)[:, None]
    info = dict(mode=mode)
    p = lambda name: os.path.join(work, name)
    if mode == "legacy":
        write_wav(p("voice_in.wav"), v, sr); write_wav(p("bgm_in.wav"), bgm, sr)
        g = ("[0:a]asplit=3[v1][key][vst];[1:a]volume=0.35,asplit=2[b0][braw];"
             "[b0][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400,asplit=2[duck][bst];"
             "[v1][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[out]")
        sh(["ffmpeg", "-y", "-i", p("voice_in.wav"), "-i", p("bgm_in.wav"), "-filter_complex", g,
            "-map", "[out]", "-ar", str(sr), "-c:a", "pcm_f32le", p("mix.wav"),
            "-map", "[vst]", "-c:a", "pcm_f32le", p("stem_voice.wav"),
            "-map", "[bst]", "-c:a", "pcm_f32le", p("stem_bgm.wav"),
            "-map", "[braw]", "-c:a", "pcm_f32le", p("stem_bgm_raw.wav")])
        return info
    # 声を基準にそろえる(静的な音量変更なのでポンピングは起きない)
    write_wav(p("voice_in.wav"), v, sr)
    vi, _ = integrated_lufs(p("voice_in.wav"))
    vgain = float(np.clip(voice_target - (vi if vi is not None else voice_target), -20, 30))
    write_wav(p("bgm_in.wav"), bgm, sr)
    bi, _ = integrated_lufs(p("bgm_in.wav"))
    bgain = float(np.clip((voice_target - bgm_offset) - (bi if bi is not None else -30), -40, 20))
    info.update(voice_lufs_before=vi, voice_gain_db=round(vgain, 1), bgm_lufs_before=bi, bgm_gain_db=round(bgain, 1),
                voice_target=voice_target, bgm_offset=bgm_offset, duck_db=duck_db)
    # 声: 静的ゲイン → 軽いコンプ(ピークだけ抑える)。BGM: 静的ゲイン
    vchain = f"volume={vgain:.2f}dB,acompressor=threshold=-18dB:ratio=3:attack=10:release=200:makeup=1"
    if mode == "duck_sc":
        g = (f"[0:a]{vchain},asplit=3[v1][key][vst];[1:a]volume={bgain:.2f}dB,asplit=2[b0][braw];"
             f"[b0][key]sidechaincompress=threshold=0.02:ratio=4:knee=6:attack=80:release=700,asplit=2[duck][bst];"
             f"[v1][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.84:attack=5:release=50:level=0[out]")
        bgm_input = p("bgm_in.wav")
    elif mode == "duck_vad":
        curve = speech_gain_curve(n, sr, speech, duck_db)
        write_wav(p("bgm_ducked_pre.wav"), bgm * curve[:, None], sr)
        g = (f"[0:a]{vchain},asplit=2[v1][vst];[1:a]volume={bgain:.2f}dB,asplit=2[b0][bst];"
             f"[2:a]volume={bgain:.2f}dB[braw];"
             f"[v1][b0]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.84:attack=5:release=50:level=0[out]")
        bgm_input = p("bgm_ducked_pre.wav")
    else:
        raise ValueError(mode)
    sh(["ffmpeg", "-y", "-i", p("voice_in.wav"), "-i", bgm_input, "-i", p("bgm_in.wav"), "-filter_complex", g,
        "-map", "[out]", "-c:a", "pcm_f32le", p("mix.wav"),
        "-map", "[vst]", "-c:a", "pcm_f32le", p("stem_voice.wav"),
        "-map", "[bst]", "-c:a", "pcm_f32le", p("stem_bgm.wav"),
        "-map", "[braw]", "-c:a", "pcm_f32le", p("stem_bgm_raw.wav")])
    return info


def mix_metrics(work, speech):
    """声と BGM を個別に測る。発話中の音量差、BGM の下げ幅の揺れ(ポンピングの目安)"""
    p = lambda name: os.path.join(work, name)
    res = {}
    for k in ("stem_voice", "stem_bgm", "mix"):
        i, pk = integrated_lufs(p(k + ".wav"))
        res[k + "_I"], res[k + "_peak"] = i, pk
    tv, mv = momentary(p("stem_voice.wav"))
    tb, mb = momentary(p("stem_bgm.wav"))
    tr, mr = momentary(p("stem_bgm_raw.wav"))
    n = min(len(mv), len(mb), len(mr))
    t, mv, mb, mr = tv[:n], mv[:n], mb[:n], mr[:n]
    # 400ms 窓のうち 8 割以上が発話の時刻を「発話中」とする
    ins = np.zeros(n, bool)
    for i, x in enumerate(t):
        cov = sum(max(0.0, min(x, b) - max(x - 0.4, a)) for a, b in speech)
        ins[i] = cov >= 0.32
    outs = np.zeros(n, bool)
    for i, x in enumerate(t):
        cov = sum(max(0.0, min(x, b) - max(x - 0.4, a)) for a, b in speech)
        outs[i] = cov <= 0.02 and x > 1.5 and x < t[-1] - 1.5   # フェード部分は除外
    duck = mb - mr                                   # BGM に実際にかかった下げ幅(dB)
    voiced = ins & (mv > -60)
    if voiced.any():
        d = mv[voiced] - mb[voiced]
        res.update(speech_windows=int(voiced.sum()), diff_median=round(float(np.median(d)), 1),
                   diff_p5=round(float(np.percentile(d, 5)), 1), diff_min=round(float(d.min()), 1),
                   bgm_louder_than_voice_ratio=round(float((d < 0).mean()), 3),
                   duck_during_speech_median=round(float(np.median(duck[voiced])), 1),
                   duck_during_speech_std=round(float(np.std(duck[voiced])), 2),
                   duck_jumps_over_3db_per_100ms=int((np.abs(np.diff(duck))[voiced[1:] & voiced[:-1]] > 3).sum()))
    if outs.any():
        res.update(nonspeech_windows=int(outs.sum()), duck_nonspeech_median=round(float(np.median(duck[outs])), 1))
    return {k: (round(v, 1) if isinstance(v, float) else v) for k, v in res.items()}


# ---------------------------------------------------------------- 映像
def _write(path, text):
    with open(path, "w") as f:
        f.write(text)
    return path


class MemoryLimitExceeded(RuntimeError):
    pass


def run_with_memory_watch(cmd, limit_mb=None):
    """ffmpeg を起動し、/proc の VmHWM(最大常駐メモリ)を見張る。limit_mb を超えたら止める。戻り値: 最大メモリ(MB)"""
    import tempfile
    errf = tempfile.TemporaryFile()
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=errf)
    hwm = 0
    while True:
        try:
            with open(f"/proc/{proc.pid}/status") as f:
                for line in f:
                    if line.startswith("VmHWM:"):
                        hwm = max(hwm, int(line.split()[1]) // 1024)
                    elif line.startswith("VmRSS:") and limit_mb and int(line.split()[1]) // 1024 > limit_mb:
                        proc.kill(); proc.wait()
                        raise MemoryLimitExceeded(f"memory exceeded {limit_mb}MB (stopped)")
        except FileNotFoundError:
            pass
        if proc.poll() is not None:
            break
        time.sleep(0.1)
    if proc.returncode != 0:
        errf.seek(0)
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {errf.read()[-2000:].decode(errors='replace')}")
    return hwm


def render_video(src, frames, fps, audio_wav, out, work, method="select", ass=None, crf=20, preset="veryfast",
                 vcodec_extra=(), mem_limit_mb=None):
    """残すフレーム区間 frames の映像に、用意済みの音声 audio_wav を付けて書き出す。
    戻り値: 処理時間と ffmpeg の最大メモリ(MB)。"""
    os.makedirs(work, exist_ok=True)
    sub = f",ass={ass}" if ass else ""
    enc = ["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p", *vcodec_extra,
           "-c:a", "aac", "-b:a", "192k"]
    fr = f"{fps.numerator}/{fps.denominator}"
    t0 = time.time()
    peak = 0

    def run_measured(cmd):
        nonlocal peak
        p_mb = run_with_memory_watch(cmd, mem_limit_mb)
        peak = max(peak, p_mb)

    if method == "select":
        expr = "+".join(f"between(n\\,{k0}\\,{k1 - 1})" for k0, k1 in frames)
        g = _write(os.path.join(work, "fg_select.txt"),
                   f"[0:v]fps={fr},select='{expr}',setpts=N/FRAME_RATE/TB{sub}[vout]")
        run_measured(["ffmpeg", "-y", "-v", "error", "-i", src, "-i", audio_wav, "-filter_complex_script", g,
                      "-map", "[vout]", "-map", "1:a", *enc, "-r", fr, out])
    elif method == "legacy":
        secs = frames_to_sec(frames, fps)
        parts = [f"[0:v]trim={a:.6f}:{b:.6f},setpts=PTS-STARTPTS[v{i}]" for i, (a, b) in enumerate(secs)]
        parts.append("".join(f"[v{i}]" for i in range(len(secs))) + f"concat=n={len(secs)}:v=1:a=0{sub and '[vc];[vc]' + sub[1:]}[vout]")
        g = _write(os.path.join(work, "fg_legacy.txt"), ";".join(parts))
        run_measured(["ffmpeg", "-y", "-v", "error", "-i", src, "-i", audio_wav, "-filter_complex_script", g,
                      "-map", "[vout]", "-map", "1:a", *enc, out])
    elif method == "segments":
        seg_dir = os.path.abspath(os.path.join(work, "segs"))
        os.makedirs(seg_dir, exist_ok=True)
        lst = []
        for i, (k0, k1) in enumerate(frames):
            sp = os.path.join(seg_dir, f"s{i:04d}.mkv")
            # 区間ごとに独立したプロセス。区間の先頭フレームの半フレーム手前へシークし(正確なシーク)、
            # そこからフレーム数で切るので、先頭から読み直す必要がなく、丸めでフレームがずれない
            ss = max(0.0, float((Fraction(k0) - Fraction(1, 2)) / fps))
            run_measured(["ffmpeg", "-y", "-v", "error", "-ss", f"{ss:.6f}", "-i", src, "-an",
                          "-frames:v", str(k1 - k0), "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", sp])
            lst.append(f"file '{sp}'")
        listf = _write(os.path.join(work, "segs.txt"), "\n".join(lst) + "\n")
        vf = f"setpts=N/({fr})/TB{sub}"
        run_measured(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listf, "-i", audio_wav,
                      "-vf", vf, "-map", "0:v", "-map", "1:a", *enc, "-r", fr, out])
    else:
        raise ValueError(method)
    return dict(method=method, seconds=round(time.time() - t0, 2), ffmpeg_peak_mb=peak)
