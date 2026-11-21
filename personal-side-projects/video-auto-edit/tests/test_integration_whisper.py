"""実モデルの統合テスト(slow): 合成した日本語音声 → Whisper + Silero VAD → 書き出し
AC-A1, AC-A2, AC-A3, AC-S1〜S5, AC-E1 を、実際の認識結果で確かめる。
モデルは環境変数 VAE_TEST_MODEL(既定 small)。初回はモデルのダウンロードが必要(無料)。
"""
import os
import re
import subprocess

import numpy as np
import pytest

from vae import pipeline

pytestmark = pytest.mark.slow
SENTENCES = [("こんにちは。今日は2026年11月21日、14時30分です。", 1.5), ("えーと、", 1.2),
             ("これから、動画の自動編集を試します。", 2.0), ("ご視聴ありがとうございました。", 0.8)]


@pytest.fixture(scope="module")
def tts_video(tmp_path_factory):
    pyopenjtalk = pytest.importorskip("pyopenjtalk")
    import soundfile as sf
    d = tmp_path_factory.mktemp("tts")
    chunks, sr = [np.zeros(int(48000 * 0.8))], 48000
    for text, gap in SENTENCES:
        x, r = pyopenjtalk.tts(text)
        assert r == sr
        chunks += [x / 32768 * 0.5, np.zeros(int(sr * gap))]
    a = np.concatenate(chunks).astype(np.float32)
    sf.write(str(d / "speech.wav"), a, sr)
    dur = len(a) / sr
    out = str(d / "in.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=720x1280:rate=30:duration={dur}",
                    "-i", str(d / "speech.wav"), "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-shortest", out],
                   check=True)
    return out, d


def test_real_models_end_to_end(tts_video, bgm_cache):
    src, d = tts_video
    s = pipeline.Settings(model=os.environ.get("VAE_TEST_MODEL", "small"))
    plan, res = pipeline.run(src, str(d / "out.mp4"), str(d / "work"), s, bgm_cache=bgm_cache)
    assert res["verify"]["ok"], res["verify"]                                    # AC-E1
    assert plan["out_duration"] < plan["source"]["duration"] - 2.0                # AC-A2: 間が切られる
    removed = [c for c in plan["filler_candidates"] if c["decision"] == "削除"]
    assert any(c["key"] == "えと" for c in removed), plan["filler_candidates"]     # AC-A3
    text = "".join("".join(e["lines"]) for e in plan["subtitles"])
    assert "えーと" not in text and "えっと" not in text
    assert re.search(r"20[0-9]{2}年", text), text                                  # AC-A1(年号が数字で出る)
    for e in plan["subtitles"]:
        assert len(e["lines"]) <= 2
    m = res["mix_metrics"]
    assert abs(m["stem_voice_lufs"] + 16) <= 1.0 and m["diff_p5"] >= 9.0, m        # AC-A6, AC-A7
