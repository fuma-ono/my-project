"""発話区間の検出(Silero VAD、faster-whisper 同梱)と、音量方式(比較用)"""
import re

from . import proc


def speech_vad(audio16k, threshold=0.5, min_silence_sec=0.5):
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    ts = get_speech_timestamps(audio16k, VadOptions(threshold=threshold, min_silence_duration_ms=int(min_silence_sec * 1000),
                                                    speech_pad_ms=0))
    return [(x["start"] / 16000, x["end"] / 16000) for x in ts]


def silences_from_speech(speech, duration, min_silence_sec):
    out, cur = [], 0.0
    for a, b in speech:
        if a - cur >= min_silence_sec:
            out.append((cur, a))
        cur = b
    if duration - cur >= min_silence_sec:
        out.append((cur, duration))
    return out


def silences_volume(wav16k_path, duration, noise_db=-35, min_silence_sec=0.5):
    err = proc.run_stderr(["ffmpeg", "-i", wav16k_path, "-af", f"silencedetect=noise={noise_db}dB:d={min_silence_sec}",
                           "-f", "null", "-"], timeout=proc.timeout_for(duration, factor=2.0))
    ss = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err)]
    se = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    return list(zip(ss, se + [duration] * (len(ss) - len(se))))
