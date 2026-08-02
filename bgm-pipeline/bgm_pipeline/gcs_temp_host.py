"""Temporary public hosting for video files, using the same Google Cloud
project/OAuth token already set up for YouTube.

Instagram's Content Publishing API doesn't accept direct file uploads —
it creates a media container from a public URL and fetches the file
itself. This uploads a file to a Cloud Storage bucket with public-read
access, returns the URL, and deletes it again once Instagram has fetched
it (nothing sits in public storage longer than one publish call).

One-time setup required (see bgm-pipeline/README.md): in the same Google
Cloud project used for YouTube, enable the Cloud Storage API and create a
bucket with "Fine-grained" access control (not Uniform bucket-level
access) so per-object public-read ACLs work.
"""
from __future__ import annotations

import argparse
import os
import sys
import uuid

import requests

from . import youtube_auth

STORAGE_API = "https://storage.googleapis.com"


def upload_public(file_path: str, bucket: str, content_type: str = "video/mp4") -> tuple[str, str]:
    """Uploads a file with public-read ACL. Returns (public_url, object_name)."""
    access_token = youtube_auth.get_access_token()
    object_name = f"tmp-{uuid.uuid4().hex}-{os.path.basename(file_path)}"

    with open(file_path, "rb") as f:
        resp = requests.post(
            f"{STORAGE_API}/upload/storage/v1/b/{bucket}/o",
            params={"uploadType": "media", "name": object_name, "predefinedAcl": "publicRead"},
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": content_type},
            data=f,
            timeout=None,
        )
    resp.raise_for_status()

    public_url = f"https://storage.googleapis.com/{bucket}/{object_name}"
    return public_url, object_name


def delete_object(bucket: str, object_name: str) -> None:
    access_token = youtube_auth.get_access_token()
    resp = requests.delete(
        f"{STORAGE_API}/storage/v1/b/{bucket}/o/{object_name}",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    if resp.status_code not in (200, 204, 404):
        resp.raise_for_status()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Upload a file to GCS with a public URL (for testing).")
    parser.add_argument("--file", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--keep", action="store_true", help="don't delete after printing the URL")
    args = parser.parse_args(argv)

    url, object_name = upload_public(args.file, args.bucket)
    print(url)
    if not args.keep:
        input("Press Enter to delete the object...")
        delete_object(args.bucket, object_name)
        print("deleted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
