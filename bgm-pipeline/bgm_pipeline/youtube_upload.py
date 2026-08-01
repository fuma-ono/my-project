"""Upload a video to YouTube via the Data API's resumable upload endpoint.

No browser, no stored password — just the OAuth token from youtube_auth.py.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import requests

from . import youtube_auth

UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"


def upload_video(
    file_path: str,
    title: str,
    description: str,
    tags: list[str],
    category_id: str = "10",  # Music
    privacy_status: str = "public",
) -> str:
    """Uploads a video and returns its YouTube video ID."""
    access_token = youtube_auth.get_access_token()
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Upload a video to YouTube.")
    parser.add_argument("--file", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--description", required=True)
    parser.add_argument("--tags", default="", help="comma-separated")
    parser.add_argument("--privacy", default="public", choices=["public", "unlisted", "private"])
    args = parser.parse_args(argv)

    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    video_id = upload_video(args.file, args.title, args.description, tags, privacy_status=args.privacy)
    print(f"https://youtube.com/watch?v={video_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
