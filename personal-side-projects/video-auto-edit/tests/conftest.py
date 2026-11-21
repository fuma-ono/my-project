import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vae import testing  # noqa: E402

SPEECHY = [(0.6, False), (1.5, True), (1.2, False), (2.0, True), (0.9, False), (1.4, True), (0.8, False)]


@pytest.fixture(scope="session")
def media_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("media")


@pytest.fixture(scope="session")
def speechy_video(media_dir):
    """声の区間と無音が交互に並ぶ、約8秒の縦動画"""
    return testing.make_video(str(media_dir / "speechy.mp4"), SPEECHY, size=(360, 640))


@pytest.fixture(scope="session")
def bgm_cache(tmp_path_factory):
    return str(tmp_path_factory.mktemp("bgm"))
