"""AC-V2〜V5、AC-E1: フレーム境界・欠落/重複なし・解像度/fps 維持・同期・メモリ・失敗時の保護"""
from fractions import Fraction

import numpy as np
import pytest

from vae import audio, media, render, testing


def _render(tmp_path, src, keep, method="select"):
    info = media.probe(src)
    frames = render.snap_keep(keep, info.fps)
    a = audio.read_audio(src)
    wav = str(tmp_path / f"a_{method}.wav")
    audio.write_wav(wav, audio.cut_audio(a, audio.SR, frames, info.fps))
    out = str(tmp_path / f"out_{method}.mp4")
    r = render.render_video(src, frames, info.fps, wav, out, str(tmp_path / f"w_{method}"), method=method)
    return info, frames, out, r


def test_snap_keep_merges_overlaps_and_rounds():
    fps = Fraction(30)
    assert render.snap_keep([(0.0, 1.0), (1.01, 2.0)], fps) == [(0, 60)]
    assert render.snap_keep([(0.49, 1.0)], fps) == [(15, 30)]
    assert render.snap_keep([(1.0, 1.01)], fps) == []


@pytest.mark.parametrize("method", ["select", "legacy", "segments"])
def test_ac_v3_frames_exact_no_drop_no_dup(tmp_path, speechy_video, method):
    keep = [(0.31, 2.17), (3.33, 5.41), (6.02, 7.7)]
    info, frames, out, r = _render(tmp_path, speechy_video, keep, method)
    got = testing.decode_frame_indices(out)
    exp = np.concatenate([np.arange(k0, k1) for k0, k1 in frames])
    assert len(got) == len(exp)
    assert (got == exp).all(), "フレームの欠落・重複・入れ替わり"
    ver = render.verify(out, expect_frames=len(exp), expect_size=(info.width, info.height), expect_fps=info.fps)
    assert ver["checks"]["frames_match"] and ver["checks"]["size_match"] and ver["checks"]["fps_match"]  # AC-V2
    assert ver["checks"]["av_within_1_frame"]                                                          # AC-E1


def test_ac_v4_select_memory_is_bounded(tmp_path, speechy_video):
    _, _, _, r = _render(tmp_path, speechy_video, [(0.0, 7.5)], "select")
    assert r["ffmpeg_peak_mb"] < 1000


def test_ac_v5_failed_render_keeps_existing_output(tmp_path, speechy_video):
    out = tmp_path / "keep.mp4"
    out.write_bytes(b"previous output")
    info = media.probe(speechy_video)
    with pytest.raises(Exception):
        render.render_video(speechy_video, [(0, 30)], info.fps, str(tmp_path / "missing.wav"), str(out), str(tmp_path / "w"))
    assert out.read_bytes() == b"previous output"
