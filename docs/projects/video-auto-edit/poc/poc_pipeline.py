"""使い捨て技術検証スクリプト(第2フェーズ)。
入力動画 -> 文字起こし -> 無音/言い淀み検出 -> カット -> テロップ(ASS) -> BGM(声基準のミックス) -> 書き出し

使い方: python poc_pipeline.py <入力動画> <出力mp4> [small|medium]
環境変数(既定値):
  VEDIT_WORK=/tmp/vedit-poc/work      作業フォルダ
  VEDIT_CUT_MODE=volume               volume(従来) / vad(Silero VAD。HQ暫定推奨)
  VEDIT_VAD_THRESHOLD=0.5  VEDIT_MIN_SIL=0.5  VEDIT_PAD=0.12  VEDIT_NOISE_DB=-35
  VEDIT_RENDER=select                 select(P12改善) / segments / legacy(第1〜3回の方式)
  VEDIT_MIX=duck_vad                  duck_vad(P11改善) / duck_sc / legacy(第1〜3回の方式)
  VEDIT_VOICE_LUFS=-16  VEDIT_BGM_OFFSET=12  VEDIT_DUCK_DB=-6
テロップ(P8〜P10)と言い淀み(P13)は v2 のみ。第1〜3回の結果は git の履歴と保存済みの出力で比較する。
"""
import json, math, os, re, resource, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fillers, render, subtitles  # noqa: E402

IN, OUT = sys.argv[1], sys.argv[2]
MODEL = sys.argv[3] if len(sys.argv) > 3 else "small"
W = os.path.abspath(os.environ.get("VEDIT_WORK", "/tmp/vedit-poc/work"))
os.makedirs(W, exist_ok=True)
E = os.environ.get
CUT_MODE, RENDER, MIX = E("VEDIT_CUT_MODE", "volume"), E("VEDIT_RENDER", "select"), E("VEDIT_MIX", "duck_vad")
NOISE_DB, MIN_SIL, PAD = float(E("VEDIT_NOISE_DB", "-35")), float(E("VEDIT_MIN_SIL", "0.5")), float(E("VEDIT_PAD", "0.12"))
VAD_THR = float(E("VEDIT_VAD_THRESHOLD", "0.5"))
T = {}


def _jd(o):
    """numpy の値を JSON に書けるようにする"""
    return o.item() if hasattr(o, "item") else str(o)


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def dur(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).stdout)


def display_size(path):
    """回転メタデータ(スマホの縦撮り)を考慮した表示上の幅・高さ"""
    info = json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                           "stream=width,height:stream_side_data=rotation", "-of", "json", path]).stdout)["streams"][0]
    w, h = info["width"], info["height"]
    rot = next((abs(int(d.get("rotation", 0))) for d in info.get("side_data_list", []) if "rotation" in d), 0)
    return (h, w) if rot % 180 == 90 else (w, h)


t = time.time()
run(["ffmpeg", "-y", "-i", IN, "-ac", "1", "-ar", "16000", f"{W}/a16k.wav"])
T["extract_audio"] = time.time() - t
src = render.probe(IN)
src_dur, FPS = src["duration"], src["fps"]
VW, VH = display_size(IN)
FS = round(min(VW, VH) * 0.075)          # 横720pで54px相当
MARGIN_LR = round(VW * 0.03)
OUTLINE = max(2, round(FS / 13))

# 1. 文字起こし(ローカル, CPU, int8)
from faster_whisper import WhisperModel  # noqa: E402
import soundfile as sf  # noqa: E402
t = time.time()
model = WhisperModel(MODEL, device="cpu", compute_type="int8")
T["model_load"] = time.time() - t
t = time.time()
audio16k, _ = sf.read(f"{W}/a16k.wav", dtype="float32")
segs, info = model.transcribe(audio16k, language="ja", word_timestamps=True, beam_size=5)
segs = list(segs)
T["transcribe"] = time.time() - t
words = [dict(s=w.start, e=w.end, w=w.word) for s in segs for w in s.words]
json.dump([dict(s=s.start, e=s.end, text=s.text) for s in segs], open(f"{W}/segments.json", "w"), ensure_ascii=False, indent=1, default=_jd)

# 2. 発話区間(VAD)は常に求める(カット方式が vad のときのカットと、BGM の下げ区間に使う)
t = time.time()
from faster_whisper.vad import get_speech_timestamps, VadOptions  # noqa: E402
vad_speech = [(x["start"] / 16000, x["end"] / 16000) for x in get_speech_timestamps(
    audio16k, VadOptions(threshold=VAD_THR, min_silence_duration_ms=int(MIN_SIL * 1000), speech_pad_ms=0))]
# BGM を下げる区間用の発話検出は、カットの設定(最短無音)と切り離して 0.3秒の間で区切る
duck_speech = [(x["start"] / 16000, x["end"] / 16000) for x in get_speech_timestamps(
    audio16k, VadOptions(threshold=VAD_THR, min_silence_duration_ms=300, speech_pad_ms=0))]
if CUT_MODE == "vad":
    silences, cur = [], 0.0
    for a, b in vad_speech:
        if a - cur >= MIN_SIL:
            silences.append((cur, a))
        cur = b
    if src_dur - cur >= MIN_SIL:
        silences.append((cur, src_dur))
else:
    r = subprocess.run(["ffmpeg", "-i", f"{W}/a16k.wav", "-af", f"silencedetect=noise={NOISE_DB}dB:d={MIN_SIL}", "-f", "null", "-"],
                       capture_output=True, text=True)
    ss = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    se = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    silences = list(zip(ss, se + [src_dur] * (len(ss) - len(se))))
T["silencedetect"] = time.time() - t

# 3. 残す区間 = 無音以外 から 言い淀み(v2: 表記ゆれ・文脈で判定)を除く。前後に余白
MIN_GAP = 0.25
silence_cuts = [(a + PAD, b - PAD) for a, b in silences if b - a > 2 * PAD]
filler_drop, filler_cands = fillers.detect(words)
filler_cuts = [(c["s"], c["e"]) for c in filler_cands if c["decision"] == "削除"]
cuts = sorted(silence_cuts + filler_cuts)
keep, cur = [], 0.0
for a, b in cuts:
    if a > cur:
        keep.append((cur, a))
    cur = max(cur, b)
if cur < src_dur:
    keep.append((cur, src_dur))
dropped_short = [(a, b) for a, b in keep if b - a <= MIN_GAP]
keep = [(a, b) for a, b in keep if b - a > MIN_GAP]
# 映像のフレーム境界にそろえる(映像と音声を同じ位置で切り、ずれが積み重ならないように)
frames = render.snap_keep(keep, FPS)
keep = render.frames_to_sec(frames, FPS)
json.dump(dict(silence=silence_cuts, filler=filler_cuts, dropped_short=dropped_short),
          open(f"{W}/cuts.json", "w"), indent=1, default=_jd)
json.dump([dict(w, filler=i in filler_drop) for i, w in enumerate(words)], open(f"{W}/words.json", "w"), ensure_ascii=False, indent=1, default=_jd)


def remap_snap(x):
    off = 0.0
    for a, b in keep:
        if x < a:
            return off
        if x <= b:
            return off + (x - a)
        off += b - a
    return off


# 4. テロップ v2
events = subtitles.build_events([dict(w, drop=i in filler_drop) for i, w in enumerate(words)], remap_snap,
                                VW, FS, OUTLINE, MARGIN_LR)
open(f"{W}/subs.ass", "w").write(subtitles.to_ass(events, VW, VH, FS, OUTLINE, MARGIN_LR, round(VH * 0.07)))
json.dump([dict(e, lines=e["lines"]) for e in events], open(f"{W}/subs.json", "w"), ensure_ascii=False, indent=1, default=_jd)
out_dur = sum(b - a for a, b in keep)

# 5. BGM: 既存 bgm-pipeline を読み取り専用で呼ぶ(自前生成 = ライセンス問題なし。長さによる既知の不具合は30秒単位で回避)
t = time.time()
env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
subprocess.run(
    [sys.executable, "-m", "bgm_pipeline.generate", "--preset", "study_lofi_chill", "--minutes", str(math.ceil((out_dur + 1) / 30) / 2),
     "--out", f"{W}/bgm.wav", "--seed", "1"], check=True, capture_output=True,
    cwd=os.path.join(HERE, "../../../../bgm-pipeline"), env=env)
T["bgm_generate"] = time.time() - t

# 6. 音声: フレーム境界で声をカット → 声基準でミックス → 声と BGM を個別に計測
t = time.time()
voice = render.cut_audio(render.read_audio(IN), 48000, frames, FPS)
render.write_wav(f"{W}/voice_cut.wav", voice, 48000)
speech_out = []                                      # 出力の時刻での発話区間(VAD)。0.4秒未満の切れ目はつなぐ
for a, b in duck_speech:
    for ka, kb in keep:
        s, e = max(a, ka), min(b, kb)
        if e > s:
            s2, e2 = remap_snap(s), remap_snap(e)
            if speech_out and s2 - speech_out[-1][1] < 0.4:
                speech_out[-1] = (speech_out[-1][0], e2)
            else:
                speech_out.append((s2, e2))
mix_info = render.mix_audio(f"{W}/voice_cut.wav", f"{W}/bgm.wav", W, MIX, speech_out,
                            voice_target=float(E("VEDIT_VOICE_LUFS", "-16")), bgm_offset=float(E("VEDIT_BGM_OFFSET", "12")),
                            duck_db=float(E("VEDIT_DUCK_DB", "-6")))
T["audio_mix"] = time.time() - t
mix_m = render.mix_metrics(W, speech_out)

# 7. 書き出し(映像のカット + テロップ焼き込み + 用意した音声)
render_info = render.render_video(IN, frames, FPS, f"{W}/mix.wav", OUT, W, method=RENDER, ass=f"{W}/subs.ass")
T["render"] = render_info["seconds"]

peak_mb = dict(python_whisper=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024),
               render_ffmpeg=render_info["ffmpeg_peak_mb"],
               largest_child=round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024))
out_probe = render.probe(OUT)
report = dict(model=MODEL, peak_memory_mb=peak_mb, video_size=[VW, VH], src_fps=str(FPS), out_fps=str(out_probe["fps"]),
              out_size=[out_probe["width"], out_probe["height"]], src_duration=round(src_dur, 2),
              out_duration=round(out_probe["duration"], 3), planned_out=round(out_dur, 3),
              silences=[(round(a, 2), round(b, 2)) for a, b in silences], keep=[(round(a, 4), round(b, 4)) for a, b in keep],
              cut_mode=CUT_MODE, render_method=RENDER, mix_mode=MIX, silence_threshold_db=NOISE_DB, silence_min_sec=MIN_SIL,
              pad_sec=PAD, vad_threshold=VAD_THR, mix=mix_info, mix_metrics=mix_m, speech_out=speech_out,
              filler_candidates=filler_cands, subtitle_lines=len(events), transcript=[s.text for s in segs],
              timings_sec={k: round(v, 2) for k, v in T.items()})
json.dump(report, open(f"{W}/report_{MODEL}.json", "w"), ensure_ascii=False, indent=1, default=_jd)
print(json.dumps({k: report[k] for k in ("model", "out_duration", "peak_memory_mb", "mix_metrics", "timings_sec")}, ensure_ascii=False, indent=1))
