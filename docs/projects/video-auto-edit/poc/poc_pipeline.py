"""使い捨て技術検証スクリプト(リポジトリ外)。
入力動画 -> 文字起こし -> 無音/言い淀み検出 -> カット -> テロップ(ASS) -> BGM(ダッキング) -> 書き出し
"""
import json, math, os, re, subprocess, sys, time

from faster_whisper import WhisperModel
import budoux
BUDOUX = budoux.load_default_japanese_parser()

IN = sys.argv[1]
OUT = sys.argv[2]
MODEL = sys.argv[3] if len(sys.argv) > 3 else "small"
W = os.environ.get("VEDIT_WORK", "/tmp/vedit-poc/work")
os.makedirs(W, exist_ok=True)
T = {}

def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)

def dur(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).stdout)

t = time.time()
run(["ffmpeg", "-y", "-i", IN, "-ac", "1", "-ar", "16000", f"{W}/a16k.wav"])
T["extract_audio"] = time.time() - t
src_dur = dur(IN)

# 1. 文字起こし(ローカル, CPU, int8)
t = time.time()
model = WhisperModel(MODEL, device="cpu", compute_type="int8")
T["model_load"] = time.time() - t
t = time.time()
import soundfile as sf
audio16k, _ = sf.read(f"{W}/a16k.wav", dtype="float32")
segs, info = model.transcribe(audio16k, language="ja", word_timestamps=True, beam_size=5)
segs = list(segs)
T["transcribe"] = time.time() - t
words = [dict(s=w.start, e=w.end, w=w.word) for s in segs for w in s.words]
json.dump([dict(s=s.start, e=s.end, text=s.text) for s in segs], open(f"{W}/segments.json", "w"), ensure_ascii=False, indent=1)

# 2. 無音検出(ffmpeg silencedetect)
t = time.time()
r = subprocess.run(["ffmpeg", "-i", f"{W}/a16k.wav", "-af", "silencedetect=noise=-35dB:d=0.5", "-f", "null", "-"],
                   capture_output=True, text=True)
ss = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
se = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
silences = list(zip(ss, se + [src_dur] * (len(ss) - len(se))))
T["silencedetect"] = time.time() - t

# 3. 残す区間 = 無音以外 から 言い淀み語を除外。前後に少し余白を付ける
PAD, MIN_GAP = 0.12, 0.25
FILLERS = {"えーと", "えっと", "えー", "あのー", "あの", "ええと", "うーん", "まあ"}
cuts = [(a + PAD, b - PAD) for a, b in silences if b - a > 2 * PAD]
norm = lambda x: re.sub(r"[、。,.!?！？ー\s]", "", x)
FN = {norm(f) for f in FILLERS}
filler_idx = set()
for i in range(len(words)):
    for j in range(i, min(i + 3, len(words))):
        joined = norm("".join(w["w"] for w in words[i:j + 1]))
        # 次の語が句読点で終わる/区切りになっている場合のみ言い淀みとみなす(「あの人」等の誤検出を抑制)
        if joined in FN and words[j]["w"].strip().endswith(("。", "、", "ー")):
            filler_idx.update(range(i, j + 1))
            cuts.append((words[i]["s"], words[j]["e"]))
cuts.sort()
keep, cur = [], 0.0
for a, b in cuts:
    if a > cur:
        keep.append((cur, a))
    cur = max(cur, b)
if cur < src_dur:
    keep.append((cur, src_dur))
keep = [(a, b) for a, b in keep if b - a > MIN_GAP]

def remap_snap(x):
    off = 0.0
    for a, b in keep:
        if x < a:
            return off
        if x <= b:
            return off + (x - a)
        off += b - a
    return off

def remap(x):
    """元動画の時刻 -> カット後の時刻。削除区間内なら None"""
    off = 0.0
    for a, b in keep:
        if a <= x <= b:
            return off + (x - a)
        off += b - a
    return None

# 4. テロップ: 単語タイムスタンプを句読点/最大文字数で行にまとめる
MAXC = 18
lines, buf = [], []
for w in words:
    clean = re.sub(r"\s", "", w["w"])
    if words.index(w) in filler_idx:
        continue
    buf.append(dict(w, w=clean))
    text = "".join(x["w"] for x in buf)
    if clean.endswith(("。", "？", "！")) or (clean.endswith("、") and len(text) >= 8) or len(text) >= MAXC * 2:
        lines.append(buf); buf = []
if buf:
    lines.append(buf)

def ts(x):
    h, m = int(x // 3600), int(x % 3600 // 60)
    return f"{h}:{m:02d}:{x % 60:05.2f}"

ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1280", "PlayResY: 720", "",
       "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       "Style: Default,IPAGothic,54,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,4,1,2,40,40,50,1",
       "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
sub_count = 0
events = []
for ln in lines:
    s, e = remap_snap(ln[0]["s"]), remap_snap(ln[-1]["e"])
    if e - s < 0.3:
        e = s + 0.6  # 表示時間が短すぎる行は最低限読める長さにする
    text = "".join(w["w"] for w in ln).rstrip("、。")
    if len(text) > MAXC:  # 2段表示: BudouX の文節境界のうち、中央に最も近い位置で改行(読点直後を優先)
        phrases, bounds, pos = BUDOUX.parse(text), [], 0
        for ph in phrases[:-1]:
            pos += len(ph)
            bounds.append((pos, ph.endswith("、")))
        best = min(bounds, key=lambda b: (not b[1] or abs(b[0] - len(text) / 2) > len(text) / 4, abs(b[0] - len(text) / 2)))[0]
        text = text[:best] + "\\N" + text[best:]
    events.append([s, e + 0.15, text])
for k in range(len(events) - 1):
    events[k][1] = min(events[k][1], events[k + 1][0] - 0.02)
for s, e, text in events:
    ass.append(f"Dialogue: 0,{ts(s)},{ts(e)},Default,,0,0,0,,{text}")
    sub_count += 1
open(f"{W}/subs.ass", "w").write("\n".join(ass) + "\n")
out_dur = sum(b - a for a, b in keep)

# 5. BGM: 既存 bgm-pipeline を読み取り専用で呼ぶ(自前生成 = ライセンス問題なし)
t = time.time()
env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
subprocess.run(
    [sys.executable, "-m", "bgm_pipeline.generate", "--preset", "study_lofi_chill", "--minutes", str(math.ceil((out_dur + 1) / 30) / 2),
     "--out", f"{W}/bgm.wav", "--seed", "1"], check=True, capture_output=True, cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../../bgm-pipeline"), env=env)
T["bgm_generate"] = time.time() - t

# 6. カット + テロップ焼き込み + BGMダッキング + ラウドネス正規化 を1回のエンコードで
t = time.time()
fc = []
for i, (a, b) in enumerate(keep):
    fc.append(f"[0:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS[v{i}]")
    fc.append(f"[0:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st={max(b - a - 0.02, 0):.3f}:d=0.02[a{i}]")
fc.append("".join(f"[v{i}][a{i}]" for i in range(len(keep))) + f"concat=n={len(keep)}:v=1:a=1[vc][ac]")
fc.append(f"[vc]ass={W}/subs.ass[vout]")
fc.append("[ac]asplit=2[voice][key]")
fc.append(f"[1:a]volume=0.35,atrim=0:{out_dur:.3f},afade=t=in:d=1,afade=t=out:st={max(out_dur - 1.5, 0):.3f}:d=1.5[bgm]")
fc.append("[bgm][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck]")
fc.append("[voice][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]")
run(["ffmpeg", "-y", "-i", IN, "-i", f"{W}/bgm.wav", "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]",
     "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", OUT])
T["render"] = time.time() - t

report = dict(model=MODEL, src_duration=round(src_dur, 2), out_duration=round(dur(OUT), 2), planned_out=round(out_dur, 2),
              silences=[(round(a, 2), round(b, 2)) for a, b in silences], keep=[(round(a, 2), round(b, 2)) for a, b in keep],
              subtitle_lines=sub_count, transcript=[s.text for s in segs],
              words_detected=[w["w"] for w in words], timings_sec={k: round(v, 2) for k, v in T.items()})
json.dump(report, open(f"{W}/report_{MODEL}.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(report, ensure_ascii=False, indent=1))
