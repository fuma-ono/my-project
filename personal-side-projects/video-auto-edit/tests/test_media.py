"""AC-V1(対応形式)、AC-V2(回転)、AC-V6(異常入力)、AC-B1(無料枠の上限)"""
import os
import subprocess

import pytest

from vae import errors, media, testing

FORMATS = [
    ("mp4", "libx264", "aac", ()),
    ("mov", "libx264", "aac", ()),
    ("m4v", "libx264", "aac", ()),
    ("mkv", "libx265", "libopus", ("-x265-params", "log-level=error")),
    ("webm", "libvpx-vp9", "libopus", ("-deadline", "realtime", "-cpu-used", "8")),
]


@pytest.mark.parametrize("ext,vcodec,acodec,extra", FORMATS)
def test_ac_v1_formats_accepted(tmp_path, ext, vcodec, acodec, extra):
    p = testing.make_video(str(tmp_path / f"a.{ext}"), [(0.5, False), (1.0, True)], size=(320, 180),
                           codec=vcodec, acodec=acodec, ext_args=extra)
    info = media.validate(p)
    assert (info.width, info.height) == (320, 180)
    assert info.acodec is not None
    assert abs(info.duration - 1.5) < 0.2


def test_ac_v2_rotation_metadata_swaps_display_size(tmp_path):
    src = testing.make_video(str(tmp_path / "land.mp4"), [(1.5, True)], size=(320, 180))
    rot = str(tmp_path / "rot.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-display_rotation", "90", "-i", src, "-c", "copy", rot], check=True)
    info = media.probe(rot)
    assert abs(info.rotation) == 90
    assert (info.width, info.height) == (180, 320)


def test_ac_v6_unsupported_extension(tmp_path):
    p = tmp_path / "a.avi"
    p.write_bytes(b"x" * 100)
    with pytest.raises(errors.VAEError) as e:
        media.validate(str(p))
    assert e.value.code == "unsupported_format" and e.value.hint


def test_ac_v6_broken_file(tmp_path):
    p = tmp_path / "broken.mp4"
    p.write_bytes(os.urandom(4096))
    with pytest.raises(errors.VAEError) as e:
        media.validate(str(p))
    assert e.value.code == "broken_file"


def test_ac_v6_empty_file(tmp_path):
    p = tmp_path / "empty.mp4"
    p.write_bytes(b"")
    with pytest.raises(errors.VAEError) as e:
        media.validate(str(p))
    assert e.value.code == "broken_file"


def test_ac_v6_no_audio(tmp_path):
    p = testing.make_video(str(tmp_path / "silent.mp4"), [(2.0, False)], size=(320, 180), acodec=None)
    with pytest.raises(errors.VAEError) as e:
        media.validate(p)
    assert e.value.code == "no_audio"


def test_ac_v6_too_short(tmp_path):
    p = testing.make_video(str(tmp_path / "short.mp4"), [(0.4, True)], size=(320, 180))
    with pytest.raises(errors.VAEError) as e:
        media.validate(p)
    assert e.value.code == "too_short"


def test_ac_b1_plan_limit(tmp_path):
    p = testing.make_video(str(tmp_path / "long.mp4"), [(31.0, True)], size=(160, 90))
    with pytest.raises(errors.VAEError) as e:
        media.validate(p, max_seconds=30)
    assert e.value.code == "over_plan_limit"
    assert media.validate(p, max_seconds=None).duration > 30
