"""ナレーション生成。プロバイダを差し替え可能にしてある。

  provider = openjtalk : Open JTalk(無料・BSD)。技術検証用。
  provider = voicevox  : ローカルの VOICEVOX ENGINE(HTTP)。未検証。
  provider = wav       : assets/narration/<id>.wav を置くだけで使える(収録・他TTS)。

どのプロバイダでも出力は 48kHz モノラル WAV に揃え、timing.json に
  start / duration / 口パク用のフレーム別エンベロープ
を書き出す。Blender と字幕は timing.json だけを見るので、音声を差し替えても
後段は変更不要。
"""
import json, os, subprocess, sys, wave, urllib.request, urllib.parse
import numpy as np

SR = 48000


def _norm_wav(src, dst):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-ac", "1", "-ar", str(SR),
                    "-c:a", "pcm_s16le", dst], check=True)


def synth_openjtalk(text, out_wav, c):
    o = c["tts"]["openjtalk"]
    txt = out_wav + ".txt"
    with open(txt, "w", encoding="utf-8") as f:
        f.write(text)
    raw = out_wav + ".raw.wav"
    subprocess.run(["open_jtalk", "-x", o["dic"], "-m", o["voice"], "-ow", raw,
                    "-r", str(o["speed"]), "-fm", str(o["half_tone"]), "-g", str(o["volume_db"]), txt],
                   check=True)
    _norm_wav(raw, out_wav)


def synth_voicevox(text, out_wav, c):
    v = c["tts"]["voicevox"]
    base, sp = v["engine_url"], v["speaker"]
    q = urllib.request.urlopen(urllib.request.Request(
        f"{base}/audio_query?text={urllib.parse.quote(text)}&speaker={sp}", method="POST")).read()
    wav = urllib.request.urlopen(urllib.request.Request(
        f"{base}/synthesis?speaker={sp}", data=q, headers={"Content-Type": "application/json"},
        method="POST")).read()
    raw = out_wav + ".raw.wav"
    open(raw, "wb").write(wav)
    _norm_wav(raw, out_wav)


def synth_wav(nid, out_wav, c, root):
    _norm_wav(os.path.join(root, c["tts"]["wav"]["dir"], nid + ".wav"), out_wav)


def read_wav(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def main(cfg_path, outdir):
    root = os.path.dirname(os.path.dirname(os.path.abspath(cfg_path)))
    root = os.path.dirname(root) if os.path.basename(root) == "config" else root
    c = json.load(open(cfg_path, encoding="utf-8"))
    os.makedirs(outdir, exist_ok=True)
    fps, dur = c["fps"], c["duration_sec"]
    nframes = int(round(fps * dur))
    prov = c["tts"]["provider"]
    items, t_prev_end = [], None
    audio = np.zeros(int(SR * dur), np.float32)
    env = np.zeros(nframes, np.float32)
    for n in c["narration"]:
        wavp = os.path.join(outdir, n["id"] + ".wav")
        if prov == "openjtalk": synth_openjtalk(n["text"], wavp, c)
        elif prov == "voicevox": synth_voicevox(n["text"], wavp, c)
        elif prov == "wav": synth_wav(n["id"], wavp, c, root)
        else: raise SystemExit("unknown provider " + prov)
        x = read_wav(wavp)
        # 前後の無音を切り詰める(長さが読めるように、書き戻す)
        nz = np.where(np.abs(x) > 0.01)[0]
        if len(nz):
            x = x[max(0, nz[0] - int(0.05 * SR)): nz[-1] + int(0.10 * SR)]
            with wave.open(wavp, "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
                w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
        d = len(x) / SR
        start = n["start"] if "start" in n else t_prev_end + n["gap_after_prev"]
        t_prev_end = start + d
        if t_prev_end > dur - 0.3:
            raise SystemExit(f"ナレーションが長すぎる: {n['id']} end={t_prev_end:.2f}s > {dur-0.3:.2f}s")
        i0 = int(start * SR)
        audio[i0:i0 + len(x)] += x
        # 口パク用エンベロープ(フレーム毎の RMS を 0..1 に)
        for f in range(nframes):
            a, b = int(f / fps * SR), int((f + 1) / fps * SR)
            seg = audio[a:b]
            if len(seg): env[f] = max(env[f], float(np.sqrt(np.mean(seg ** 2))))
        items.append({"id": n["id"], "text": n["text"], "subtitle": n.get("subtitle", n["text"]),
                      "start": round(start, 3), "duration": round(d, 3), "end": round(start + d, 3)})
    if env.max() > 0: env = np.clip(env / np.percentile(env[env > 0], 90), 0, 1)
    # 口は急に開閉しないよう 3 点で平滑化
    env = np.convolve(env, [0.25, 0.5, 0.25], mode="same")
    pk = float(np.abs(audio).max())
    wp = os.path.join(outdir, "narration.wav")
    with wave.open(wp, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
    ev = c["events"]
    n2 = items[-1]
    timing = {"fps": fps, "frames": nframes, "provider": prov, "narration": items,
              "events": {**ev, "flower_pop": round(n2["start"] + ev["flower_pop_after_n2_start"], 3)},
              "mouth_env": [round(float(v), 3) for v in env], "narration_peak": round(pk, 4)}
    json.dump(timing, open(os.path.join(outdir, "timing.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(json.dumps({k: timing[k] for k in ("provider", "narration", "events", "narration_peak")},
                     ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
