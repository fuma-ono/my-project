"""Publish a Reel to Instagram via the Graph API's Content Publishing flow.

Two-step process: create a media container from a public video URL, wait
for Instagram to finish fetching/processing it, then publish the container.
"""
from __future__ import annotations

import argparse
import sys
import time

import requests

from . import instagram_auth

GRAPH_API = "https://graph.facebook.com/v21.0"
POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 300


def create_reel_container(video_url: str, caption: str) -> str:
    access_token = instagram_auth.get_access_token()
    ig_user_id = instagram_auth.get_ig_user_id()

    resp = requests.post(
        f"{GRAPH_API}/{ig_user_id}/media",
        data={
            "media_type": "REELS",
            "video_url": video_url,
            "caption": caption,
            "access_token": access_token,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def wait_until_ready(container_id: str) -> None:
    access_token = instagram_auth.get_access_token()
    deadline = time.time() + POLL_TIMEOUT_SECONDS

    while time.time() < deadline:
        resp = requests.get(
            f"{GRAPH_API}/{container_id}",
            params={"fields": "status_code", "access_token": access_token},
            timeout=30,
        )
        resp.raise_for_status()
        status = resp.json().get("status_code")
        if status == "FINISHED":
            return
        if status in ("ERROR", "EXPIRED"):
            raise RuntimeError(f"Instagram container {container_id} failed: {status}")
        time.sleep(POLL_INTERVAL_SECONDS)

    raise TimeoutError(f"Instagram container {container_id} did not finish processing in time")


def publish_container(container_id: str) -> str:
    access_token = instagram_auth.get_access_token()
    ig_user_id = instagram_auth.get_ig_user_id()

    resp = requests.post(
        f"{GRAPH_API}/{ig_user_id}/media_publish",
        data={"creation_id": container_id, "access_token": access_token},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def publish_reel(video_url: str, caption: str) -> str:
    """Returns the published media ID."""
    container_id = create_reel_container(video_url, caption)
    wait_until_ready(container_id)
    return publish_container(container_id)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish a Reel from a public video URL.")
    parser.add_argument("--video-url", required=True)
    parser.add_argument("--caption", default="")
    args = parser.parse_args(argv)

    media_id = publish_reel(args.video_url, args.caption)
    print(f"Published: media id {media_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
