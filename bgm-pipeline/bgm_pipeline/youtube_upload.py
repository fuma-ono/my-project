"""Upload a video to YouTube via the Data API's resumable upload endpoint.

No browser, no stored password — just the OAuth token from youtube_auth.py.

2026-08-10: every function here now takes an optional `auth: YouTubeAuth`
(default: this package's own channel, unchanged behavior for every
existing call site) — moyasuka's channel is a separate YouTube channel
under its own OAuth grant, so it passes its own YouTubeAuth instance
(see moyasuka/youtube_auth.py) through the same upload/status/thumbnail
code instead of duplicating this file.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import requests

from . import youtube_auth
from .youtube_auth import YouTubeAuth

UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
THUMBNAILS_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set"


def upload_video(
    file_path: str,
    title: str,
    description: str,
    tags: list[str],
    category_id: str = "10",  # Music
    privacy_status: str = "public",
    auth: YouTubeAuth | None = None,
) -> str:
    """Uploads a video and returns its YouTube video ID."""
    access_token = (auth or youtube_auth._default).get_access_token()
    file_size = os.path.getsize(file_path)

    metadata = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags,
            "categoryId": category_id,
        },
        "status": {"privacyStatus": privacy_status, "selfDeclaredMadeForKids": False},
    }

    init_resp = requests.post(
        f"{UPLOAD_URL}?uploadType=resumable&part=snippet,status",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": str(file_size),
            "X-Upload-Content-Type": "video/mp4",
        },
        data=json.dumps(metadata),
        timeout=30,
    )
    init_resp.raise_for_status()
    upload_session_url = init_resp.headers["Location"]

    with open(file_path, "rb") as f:
        put_resp = requests.put(
            upload_session_url,
            headers={"Content-Type": "video/mp4", "Content-Length": str(file_size)},
            data=f,
            timeout=None,
        )
    put_resp.raise_for_status()
    video = put_resp.json()
    return video["id"]


def set_thumbnail(video_id: str, image_path: str, auth: YouTubeAuth | None = None) -> None:
    """Uploads a custom thumbnail — covered by the youtube.upload scope,
    same as the video upload itself. Thumbnails matter far more for
    click-through than tags/hashtags, so this isn't optional polish.
    """
    access_token = (auth or youtube_auth._default).get_access_token()
    content_type = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"
    with open(image_path, "rb") as f:
        resp = requests.post(
            THUMBNAILS_URL,
            params={"videoId": video_id},
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": content_type},
            data=f,
            timeout=60,
        )
    resp.raise_for_status()


def get_video_status(video_id: str, auth: YouTubeAuth | None = None) -> dict:
    """Raw status+processingDetails for a video, for verification after upload."""
    access_token = (auth or youtube_auth._default).get_access_token()
    resp = requests.get(
        VIDEOS_URL,
        params={"part": "status,processingDetails", "id": video_id},
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    resp.raise_for_status()
    items = resp.json().get("items", [])
    if not items:
        raise RuntimeError(f"Video {video_id} not found when checking status — upload may not have registered.")
    return items[0]


class VideoProcessingFailed(RuntimeError):
    pass


def wait_for_processing(
    video_id: str, timeout_seconds: int = 1800, poll_seconds: int = 20, auth: YouTubeAuth | None = None
) -> dict:
    """Poll until YouTube finishes processing the upload, so we only report
    success once the video is actually watchable — not just once the bytes
    were accepted. Raises VideoProcessingFailed on a failed/rejected upload,
    or TimeoutError if it's still processing after timeout_seconds (long
    videos can take a while; this doesn't necessarily mean it failed).
    """
    deadline = time.monotonic() + timeout_seconds
    while True:
        item = get_video_status(video_id, auth=auth)
        upload_status = item["status"].get("uploadStatus")
        failure_reason = item["status"].get("failureReason")
        rejection_reason = item["status"].get("rejectionReason")
        processing_status = item.get("processingDetails", {}).get("processingStatus")

        if upload_status in ("failed", "rejected"):
            raise VideoProcessingFailed(
                f"Upload {upload_status} for {video_id}: "
                f"failureReason={failure_reason} rejectionReason={rejection_reason}"
            )
        if upload_status == "processed" and processing_status in (None, "succeeded"):
            return item

        if time.monotonic() >= deadline:
            raise TimeoutError(
                f"Video {video_id} still not processed after {timeout_seconds}s "
                f"(uploadStatus={upload_status}, processingStatus={processing_status}). "
                "Check https://studio.youtube.com manually — long videos can take a while."
            )
        time.sleep(poll_seconds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Upload or check a YouTube video.")
    sub = parser.add_subparsers(dest="command", required=True)

    up = sub.add_parser("upload")
    up.add_argument("--file", required=True)
    up.add_argument("--title", required=True)
    up.add_argument("--description", required=True)
    up.add_argument("--tags", default="", help="comma-separated")
    up.add_argument("--privacy", default="public", choices=["public", "unlisted", "private"])

    st = sub.add_parser("status", help="check whether a video actually finished processing")
    st.add_argument("--video-id", required=True)

    args = parser.parse_args(argv)

    if args.command == "upload":
        tags = [t.strip() for t in args.tags.split(",") if t.strip()]
        video_id = upload_video(args.file, args.title, args.description, tags, privacy_status=args.privacy)
        print(f"https://youtube.com/watch?v={video_id}")
        return 0

    if args.command == "status":
        item = get_video_status(args.video_id)
        print(json.dumps(item, indent=2))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
