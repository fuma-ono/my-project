"""音声のカット・声基準のミックス・計測(P11 / AC-A5〜A7)

ミックス方式:
  duck_vad(既定): 声を目標ラウドネスに静的にそろえ(ゲイン → 軽い圧縮 → 測り直して補正)、
                  BGM も声基準で静的にそろえ、発話区間から作った滑らかな音量カーブで下げる。
                  下げ幅は声の大小に左右されないので、ポンピングが起きにくい。
  duck_sc / legacy: 比較用(第2フェーズの評価で使った方式)
"""
import os
import re
from fractions import Fraction

import numpy as np

from . import proc

SR = 48000


def read_audio(path, sr=SR, ch=2):
    raw = proc.run_bytes(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-"])
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).copy()


def write_wav(path, a, sr=SR):
    import soundfile as sf
    sf.write(path, a, sr, subtype="FLOAT")


def cut_audio(a, sr, frames, fps, fade=0.01):
    """フレーム境界と同じ位置でサンプル単位に切り、各区間の端に短いフェードを付けてつなぐ(AC-A5)"""
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


def boundary_steps(a, sr, frames, fps):
    """カット境界の前後1サンプルの振幅差(クリックの目安)。境界ごとの最大値のリスト"""
    steps, pos = [], 0
    for k0, k1 in frames[:-1]:
        pos += round(Fraction(k1) / fps * sr) - round(Fraction(k0) / fps * sr)
        if 0 < pos < len(a):
            steps.append(float(np.max(np.abs(a[pos] - a[pos - 1]))))
    return steps


def _seconds(path):
    """wav の長さ(秒)。タイムアウトの計算用"""
    try:
        import soundfile as sf
        return sf.info(path).duration
    except Exception:  # noqa: BLE001
        return 600.0


def _ebur_text(path):
    return proc.run_stderr(["ffmpeg", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                           timeout=proc.timeout_for(_seconds(path), factor=2.0))


def integrated_lufs(path):
    err = _ebur_text(path)
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", err)
    p = re.findall(r"Peak:\s+(-?(?:inf|nan|[\d.]+)) dBFS", err)
    return (float(i[-1]) if i else None, float(p[-1]) if p else None)


def momentary(path):
    """100ms ごとの momentary ラウドネス(400ms 窓)。(時刻, LUFS)"""
    err = proc.run_stderr(["ffmpeg", "-nostats", "-i", path, "-af", "ebur128=metadata=1,ametadata=print:key=lavfi.r128.M",
                           "-f", "null", "-"], timeout=proc.timeout_for(_seconds(path), factor=2.0))
    t = [float(x) for x in re.findall(r"pts_time:([\d.]+)", err)]
    m = [float(x) for x in re.findall(r"lavfi\.r128\.M=(-?(?:inf|nan|[\d.]+))", err)]
    n = min(len(t), len(m))
    arr = np.nan_to_num(np.array(m[:n], dtype=float), nan=-70.0, neginf=-70.0, posinf=0.0)
    return np.array(t[:n]), np.maximum(arr, -70.0)


def speech_gain_curve(n, sr, speech, depth_db, down=0.25, up=0.6):
    """発話区間で depth_db 下げ、区間外で 0dB に戻す滑らかな音量カーブ(コサインのランプ)"""
    g = np.zeros(n, np.float32)
    nd, nu = max(1, int(down * sr)), max(1, int(up * sr))
    for a, b in speech:
        s, e = max(0, int(a * sr)), min(n, int(b * sr))
        if e <= s:
            continue
        rs = max(0, s - nd)
        if s > rs:
            ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, s - rs, dtype=np.float32))
            g[rs:s] = np.maximum(g[rs:s], ramp)
        g[s:e] = 1.0
        re_ = min(n, e + nu)
        if re_ > e:
            ramp = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, re_ - e, dtype=np.float32))
            g[e:re_] = np.maximum(g[e:re_], ramp)
    return (10 ** (depth_db * g / 20)).astype(np.float32)


def _fit_bgm(bgm, n, sr):
    if len(bgm) == 0:
        return np.zeros((n, 2), np.float32)
    if len(bgm) < n:                              # 足りなければループ
        bgm = np.tile(bgm, (n // len(bgm) + 1, 1))
    bgm = bgm[:n].copy()
    fi, fo = int(1.0 * sr), int(1.5 * sr)
    if n > fi + fo:
        bgm[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)[:, None]
        bgm[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)[:, None]
    return bgm


def mix(voice_path, bgm_path, work, speech, mode="duck_vad", sr=SR, voice_target=-16.0, bgm_offset=12.0, duck_db=-6.0):
    """声(カット済み)と BGM をミックスし、work に mix.wav と計測用の stem を書き出す。
    bgm_path が None なら BGM なし。戻り値: 設定と計測前の値"""
    p = lambda name: os.path.join(work, name)
    v = read_audio(voice_path, sr)
    n = len(v)
    tmo = proc.timeout_for(n / sr, factor=4.0)
    write_wav(p("voice_in.wav"), v, sr)
    has_bgm = bool(bgm_path)
    bgm = _fit_bgm(read_audio(bgm_path, sr), n, sr) if has_bgm else np.zeros((n, 2), np.float32)
    write_wav(p("bgm_in.wav"), bgm, sr)
    info = {"mode": mode, "bgm": has_bgm}
    out = ["-map", "[out]", "-c:a", "pcm_f32le", p("mix.wav"),
           "-map", "[vst]", "-c:a", "pcm_f32le", p("stem_voice.wav"),
           "-map", "[bst]", "-c:a", "pcm_f32le", p("stem_bgm.wav"),
           "-map", "[braw]", "-c:a", "pcm_f32le", p("stem_bgm_raw.wav")]
    if mode == "legacy":
        g = ("[0:a]asplit=3[v1][key][vst];[1:a]volume=0.35,asplit=2[b0][braw];"
             "[b0][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400,asplit=2[duck][bst];"
             "[v1][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[out]")
        proc.run(["ffmpeg", "-y", "-v", "error", "-i", p("voice_in.wav"), "-i", p("bgm_in.wav"), "-filter_complex", g, *out], timeout=tmo)
        return info
    # 声を基準にそろえる(静的な音量変更なのでポンピングは起きない)
    vi, _ = integrated_lufs(p("voice_in.wav"))
    vgain = float(np.clip(voice_target - (vi if vi is not None else voice_target), -20, 30))
    vchain = f"volume={vgain:.2f}dB,acompressor=threshold=-18dB:ratio=3:attack=10:release=200:makeup=1"
    proc.run(["ffmpeg", "-y", "-v", "error", "-i", p("voice_in.wav"), "-af", vchain, "-c:a", "pcm_f32le", p("voice_pass1.wav")], timeout=tmo)
    v1, _ = integrated_lufs(p("voice_pass1.wav"))
    corr = float(np.clip(voice_target - v1, -6, 12)) if v1 is not None else 0.0
    vchain += f",volume={corr:.2f}dB"
    if has_bgm:
        bi, _ = integrated_lufs(p("bgm_in.wav"))
        bgain = float(np.clip((voice_target - bgm_offset) - (bi if bi is not None else -30), -40, 20))
    else:
        bi, bgain = None, -60.0
    info.update(voice_lufs_before=vi, voice_gain_db=round(vgain, 1), voice_comp_correction_db=round(corr, 1),
                bgm_lufs_before=bi, bgm_gain_db=round(bgain, 1), voice_target=voice_target, bgm_offset=bgm_offset, duck_db=duck_db)
    limiter = "alimiter=limit=0.84:attack=5:release=50:level=0"        # 約 -1.5 dBFS
    if mode == "duck_sc":
        g = (f"[0:a]{vchain},asplit=3[v1][key][vst];[1:a]volume={bgain:.2f}dB,asplit=2[b0][braw];"
             f"[b0][key]sidechaincompress=threshold=0.02:ratio=4:knee=6:attack=80:release=700,asplit=2[duck][bst];"
             f"[v1][duck]amix=inputs=2:duration=first:normalize=0,{limiter}[out]")
        proc.run(["ffmpeg", "-y", "-v", "error", "-i", p("voice_in.wav"), "-i", p("bgm_in.wav"), "-filter_complex", g, *out], timeout=tmo)
    elif mode == "duck_vad":
        curve = speech_gain_curve(n, sr, speech, duck_db)
        write_wav(p("bgm_ducked_pre.wav"), bgm * curve[:, None], sr)
        g = (f"[0:a]{vchain},asplit=2[v1][vst];[1:a]volume={bgain:.2f}dB,asplit=2[b0][bst];"
             f"[2:a]volume={bgain:.2f}dB[braw];"
             f"[v1][b0]amix=inputs=2:duration=first:normalize=0,{limiter}[out]")
        proc.run(["ffmpeg", "-y", "-v", "error", "-i", p("voice_in.wav"), "-i", p("bgm_ducked_pre.wav"),
                  "-i", p("bgm_in.wav"), "-filter_complex", g, *out], timeout=tmo)
    else:
        raise ValueError(mode)
    return info


def mix_metrics(work, speech):
    """声と BGM を個別に測る(AC-A6, AC-A7)。発話中の音量差と、BGM の下げ幅の揺れ"""
    p = lambda name: os.path.join(work, name)
    res = {}
    for k in ("stem_voice", "stem_bgm", "mix"):
        i, pk = integrated_lufs(p(k + ".wav"))
        res[k + "_lufs"], res[k + "_peak"] = i, pk
    tv, mv = momentary(p("stem_voice.wav"))
    _, mb = momentary(p("stem_bgm.wav"))
    _, mr = momentary(p("stem_bgm_raw.wav"))
    n = min(len(mv), len(mb), len(mr))
    if n == 0:
        return res
    t, mv, mb, mr = tv[:n], mv[:n], mb[:n], mr[:n]

    def cover(x):
        return sum(max(0.0, min(x, b) - max(x - 0.4, a)) for a, b in speech)

    cov = np.array([cover(x) for x in t])
    ins = cov >= 0.32
    outs = (cov <= 0.02) & (t > 1.5) & (t < t[-1] - 1.5)
    duck = mb - mr
    voiced = ins & (mv > -60) & (mr > -69)
    if voiced.any():
        d = mv[voiced] - mb[voiced]
        res.update(speech_windows=int(voiced.sum()), diff_median=round(float(np.median(d)), 1),
                   diff_p5=round(float(np.percentile(d, 5)), 1), diff_min=round(float(d.min()), 1),
                   bgm_louder_ratio=round(float((d < 0).mean()), 4), windows_bgm_louder=int((d < 0).sum()),
                   duck_median=round(float(np.median(duck[voiced])), 1),
                   duck_std=round(float(np.std(duck[voiced])), 2),
                   duck_jumps_3db=int((np.abs(np.diff(duck))[voiced[1:] & voiced[:-1]] > 3).sum()))
    if outs.any():
        res.update(nonspeech_windows=int(outs.sum()), duck_nonspeech_median=round(float(np.median(duck[outs])), 1))
    return res
