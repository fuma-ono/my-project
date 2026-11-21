"""解析 → 編集計画(EditPlan) → 書き出し。

- analyze(): 文字起こし・発話検出・言い淀み判定・カット・字幕を計算し、plan.json を作る(重い処理)
- render_plan(): plan.json から書き出す(字幕の修正後は、これだけをやり直す)
- 元動画は読むだけで変更しない(AC-V5)。一時ファイルは work/ に置き、終わったら大きなファイルを消す(AC-E3)
"""
import json
import os
import re
import shutil
import time
from dataclasses import asdict, dataclass, field
from fractions import Fraction

from . import audio, bgm, errors, fillers, media, proc, render, subtitles, vad
from .transcribe import WhisperTranscriber

PLAN_VERSION = 1


@dataclass
class Settings:
    model: str = "medium"
    cut_mode: str = "vad"              # vad(既定) / volume(比較用)
    vad_threshold: float = 0.5
    min_silence: float = 0.5
    pad: float = 0.12
    noise_db: float = -35.0
    fillers: bool = True
    subtitles: bool = True
    bgm: bool = True
    mix_mode: str = "duck_vad"
    voice_lufs: float = -16.0
    bgm_offset: float = 12.0
    duck_db: float = -6.0
    render_method: str = "select"
    min_keep: float = 0.25

    @classmethod
    def from_dict(cls, d):
        d = d or {}
        known = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**known)


def _progress(cb, stage, frac, msg):
    if cb:
        cb(stage, round(float(frac), 3), msg)


def subtitle_style(width, height):
    fs = round(min(width, height) * 0.075)
    return dict(font_size=fs, outline=max(2, round(fs / 13)), margin_lr=round(width * 0.03), margin_v=round(height * 0.07))


def _remapper(keep):
    def remap(x):
        off = 0.0
        for a, b in keep:
            if x < a:
                return off
            if x <= b:
                return off + (x - a)
            off += b - a
        return off
    return remap


def analyze(src, work, settings=None, transcriber=None, vad_fn=None, progress=None):
    """EditPlan(dict)を作って work/plan.json に保存し、返す"""
    s = settings or Settings()
    os.makedirs(work, exist_ok=True)
    t = {}
    t0 = time.time()
    _progress(progress, "analyze", 0.02, "動画を確認しています")
    info = media.probe(src)
    if info.acodec is None:
        raise errors.no_audio()
    fps = info.fps
    wav16 = os.path.join(work, "a16k.wav")
    proc.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", wav16],
             timeout=proc.timeout_for(info.duration, factor=2.0))
    import soundfile as sf
    a16, _ = sf.read(wav16, dtype="float32")
    t["extract_audio"] = time.time() - t0

    _progress(progress, "transcribe", 0.08, "音声を文字に起こしています")
    t1 = time.time()
    tr = (transcriber or WhisperTranscriber(s.model))(a16)
    t["transcribe"] = time.time() - t1
    words = tr.words

    _progress(progress, "cut", 0.6, "無音と言い淀みを探しています")
    t1 = time.time()
    vad_fn = vad_fn or vad.speech_vad
    speech_cut = vad_fn(a16, s.vad_threshold, s.min_silence)
    duck_speech = vad_fn(a16, s.vad_threshold, 0.3)
    if not words and not speech_cut:
        raise errors.no_speech()
    if s.cut_mode == "vad":
        silences = vad.silences_from_speech(speech_cut, info.duration, s.min_silence)
    else:
        silences = vad.silences_volume(wav16, info.duration, s.noise_db, s.min_silence)
    silence_cuts = [(a + s.pad, b - s.pad) for a, b in silences if b - a > 2 * s.pad]
    drop, cands = fillers.detect(words) if s.fillers else (set(), [])
    filler_cuts = [(c["cut_s"], c["cut_e"]) for c in cands if c["decision"] == "削除" and c["cut_e"] > c["cut_s"]]
    cuts = sorted(silence_cuts + filler_cuts)
    keep, cur = [], 0.0
    for a, b in cuts:
        if a > cur:
            keep.append((cur, a))
        cur = max(cur, b)
    if cur < info.duration:
        keep.append((cur, info.duration))
    dropped_short = [(a, b) for a, b in keep if b - a <= s.min_keep]
    keep = [(a, b) for a, b in keep if b - a > s.min_keep]
    # 映像のフレーム境界にそろえる。動画の最後のフレームを超えない
    last_frame = max(1, int(Fraction(info.duration).limit_denominator(100000) * fps))
    frames = [(k0, min(k1, last_frame)) for k0, k1 in render.snap_keep(keep, fps) if min(k1, last_frame) > k0]
    if not frames:
        raise errors.no_speech()
    keep = render.frames_to_sec(frames, fps)
    remap = _remapper(keep)
    t["cut"] = time.time() - t1

    _progress(progress, "subtitles", 0.7, "字幕を作っています")
    st = subtitle_style(info.width, info.height)
    events = subtitles.build_events([dict(w, drop=i in drop) for i, w in enumerate(words)], remap,
                                    info.width, st["font_size"], st["outline"], st["margin_lr"]) if s.subtitles else []
    speech_out = []
    for a, b in duck_speech:
        for ka, kb in keep:
            x, y = max(a, ka), min(b, kb)
            if y > x:
                x2, y2 = remap(x), remap(y)
                if speech_out and x2 - speech_out[-1][1] < 0.4:
                    speech_out[-1] = (speech_out[-1][0], y2)
                else:
                    speech_out.append((x2, y2))
    out_dur = sum(b - a for a, b in keep)
    plan = {
        "version": PLAN_VERSION,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": info.to_dict(),
        "settings": asdict(s),
        "frames": frames,
        "keep": [(round(a, 4), round(b, 4)) for a, b in keep],
        "removed": {"silence": silence_cuts, "filler": filler_cuts, "dropped_short": dropped_short},
        "words": [dict(w, filler=i in drop) for i, w in enumerate(words)],
        "filler_candidates": cands,
        "transcript": tr.segments,
        "subtitle_style": st,
        "subtitles": [dict(id=k, s=round(e["s"], 3), e=round(e["e"], 3), lines=e["lines"], src_s=e["src_s"],
                           src_e=e["src_e"], short=bool(e.get("short")), overflow=bool(e.get("overflow")), edited=False)
                      for k, e in enumerate(events)],
        "speech_out": speech_out,
        "out_duration": round(out_dur, 4),
        "timings_sec": {k: round(v, 2) for k, v in t.items()},
    }
    save_plan(plan, os.path.join(work, "plan.json"))
    _progress(progress, "analyze_done", 0.75, "編集内容ができました")
    return plan


def save_plan(plan, path):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    os.replace(tmp, path)


def load_plan(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def edit_subtitle(plan, sub_id, text):
    """字幕の文言を修正する(AC-S6)。時刻はそのままで、改行だけ実寸で計算し直す"""
    st = plan["subtitle_style"]
    meas = subtitles.Measurer(st["font_size"], st["outline"])
    maxw = plan["source"]["width"] - 2 * st["margin_lr"]
    fits = lambda x: meas.width(x) <= maxw
    text = re.sub(r"[\r\n]+", "", text).strip()
    for ev in plan["subtitles"]:
        if ev["id"] == sub_id:
            if not text:
                ev["lines"], ev["edited"] = [], True          # 空にしたら表示しない
                return ev
            lines = subtitles.split_lines(text, fits)
            ev["lines"] = lines or [text]
            ev["overflow"] = lines is None
            ev["edited"] = True
            return ev
    raise KeyError(sub_id)


def render_plan(plan, src, out, work, settings=None, progress=None, bgm_cache=None):
    """plan から書き出す。戻り値: 結果(検証・計測を含む)"""
    s = settings or Settings.from_dict(plan.get("settings"))
    os.makedirs(work, exist_ok=True)
    fps = Fraction(plan["source"]["fps"])
    frames = [tuple(f) for f in plan["frames"]]
    t = {}
    _progress(progress, "audio", 0.78, "音声を整えています")
    t0 = time.time()
    a = audio.read_audio(src)
    voice = audio.cut_audio(a, audio.SR, frames, fps)
    steps = audio.boundary_steps(voice, audio.SR, frames, fps)
    del a
    audio.write_wav(os.path.join(work, "voice_cut.wav"), voice, audio.SR)
    del voice
    bgm_path, bgm_src = (None, "none")
    if s.bgm:
        bgm_path, bgm_src = bgm.prepare(plan["out_duration"], bgm_cache or os.path.join(work, "bgm_cache"))
    mix_info = audio.mix(os.path.join(work, "voice_cut.wav"), bgm_path, work, plan["speech_out"], mode=s.mix_mode,
                         voice_target=s.voice_lufs, bgm_offset=s.bgm_offset, duck_db=s.duck_db)
    metrics = audio.mix_metrics(work, plan["speech_out"]) if bgm_path else {}
    t["audio"] = time.time() - t0

    ass = None
    if s.subtitles and plan["subtitles"]:
        st = plan["subtitle_style"]
        ass = os.path.join(work, "subs.ass")
        evs = [dict(s=e["s"], e=e["e"], lines=e["lines"]) for e in plan["subtitles"] if e["lines"]]
        with open(ass, "w", encoding="utf-8") as f:
            f.write(subtitles.to_ass(evs, plan["source"]["width"], plan["source"]["height"], st["font_size"],
                                     st["outline"], st["margin_lr"], st["margin_v"]))
    _progress(progress, "render", 0.85, "動画を書き出しています")
    w, h = plan["source"]["width"], plan["source"]["height"]
    candidate = os.path.join(work, "candidate.mp4")     # 検証に合格するまで正式な出力を置き換えない(N2)
    rinfo = render.render_video(src, frames, fps, os.path.join(work, "mix.wav"), candidate, work, method=s.render_method, ass=ass,
                                timeout=proc.timeout_for(plan["source"]["duration"], factor=15.0), size=(w, h))
    t["render"] = rinfo["seconds"]
    _progress(progress, "verify", 0.97, "書き出した動画を確認しています")
    expect = sum(k1 - k0 for k0, k1 in frames)
    ver = render.verify(candidate, expect_frames=expect, expect_size=(w - w % 2, h - h % 2), expect_fps=plan["source"]["fps"])
    if not ver["ok"]:                                       # AC-E1 を満たさない出力は完成扱いにしない
        os.remove(candidate)                                # 前回の正常な出力はそのまま残る
        failed = [k for k, v in ver["checks"].items() if not v]
        raise errors.VAEError("verify_failed", "書き出した動画の確認で問題が見つかりました(" + ", ".join(failed) + ")。",
                              "もう一度書き出してください。続く場合は、元の動画を撮影アプリで保存し直してから試してください。")
    os.replace(candidate, out)
    import resource
    result = {"output": out, "out_duration": plan["out_duration"], "render": rinfo, "verify": ver, "mix": mix_info,
              "mix_metrics": metrics, "bgm_source": bgm_src,
              "peak_memory_mb": {"python": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024,
                                 "render_ffmpeg": rinfo["ffmpeg_peak_mb"]},
              "boundary_step_max": round(max(steps), 4) if steps else 0.0, "timings_sec": {k: round(v, 2) for k, v in t.items()},
              "external_cost_jpy": 0}
    cleanup_work(work)
    return result


def cleanup_work(work, keep=("plan.json", "subs.ass", "result.json")):
    """大きな一時ファイル(wav・中間動画)を消す。計画と結果は残す"""
    if not os.path.isdir(work):
        return
    for name in os.listdir(work):
        p = os.path.join(work, name)
        if name in keep:
            continue
        if os.path.isdir(p):
            if name != "bgm_cache":
                shutil.rmtree(p, ignore_errors=True)
        elif name.endswith((".wav", ".part.mp4", ".txt", ".mkv", ".tmp")) or name == "candidate.mp4":
            os.remove(p)


def run(src, out, work, settings=None, transcriber=None, vad_fn=None, progress=None, bgm_cache=None):
    """解析から書き出しまで。戻り値: (plan, result)"""
    s = settings or Settings()
    t0 = time.time()
    try:
        plan = analyze(src, work, s, transcriber=transcriber, vad_fn=vad_fn, progress=progress)
        result = render_plan(plan, src, out, work, s, progress=progress, bgm_cache=bgm_cache)
    except Exception:
        cleanup_work(work)                                  # 失敗しても大きな一時ファイルを残さない
        raise
    result["total_seconds"] = round(time.time() - t0, 2)
    result["timings_sec"] = {**plan["timings_sec"], **result["timings_sec"]}
    with open(os.path.join(work, "result.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1, default=str)
    _progress(progress, "done", 1.0, "完了しました")
    return plan, result
