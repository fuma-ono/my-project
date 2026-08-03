"""Pull channel performance data via the YouTube Analytics API, so the
weekly review can decide what to make next based on what's actually
working instead of guessing.

NOT CURRENTLY FUNCTIONAL: this needs a yt-analytics.readonly-scoped
token, but that scope is rejected outright by Google's device-flow
endpoint (confirmed 2026-08 — see the comment in youtube_auth.py). The
token from `youtube_auth.py login` only carries youtube.upload and
devstorage.read_write, so calling channel_summary() will fail with an
insufficient-scope error until a normal authorization-code flow (run
locally by the owner, like note_publish/'s login) is built to grant this
scope separately. Until then, basic view counts are still available via
the plain YouTube Data API (videos.list) without this scope.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta

import requests

from . import youtube_auth

ANALYTICS_URL = "https://youtubeanalytics.googleapis.com/v2/reports"


def channel_summary(days: int = 28) -> dict:
    access_token = youtube_auth.get_access_token()
    end = date.today()
    start = end - timedelta(days=days)

    resp = requests.get(
        ANALYTICS_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        params={
            "ids": "channel==MINE",
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "metrics": "views,estimatedMinutesWatched,averageViewDuration,subscribersGained",
            "dimensions": "video",
            "sort": "-views",
            "maxResults": 25,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print recent channel performance.")
    parser.add_argument("--days", type=int, default=28)
    args = parser.parse_args(argv)

    data = channel_summary(args.days)
    headers = [h["name"] for h in data.get("columnHeaders", [])]
    print(f"Per-video stats, last {args.days} days:")
    print(" | ".join(headers))
    for row in data.get("rows", []):
        print(" | ".join(str(v) for v in row))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
