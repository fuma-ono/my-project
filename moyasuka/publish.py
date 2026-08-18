"""End-to-end publish for one モヤスカ episode: render the LINE-chat video
from a script + its recorded narration, then upload it to the @moyasuka
YouTube channel.

This is the actual missing piece behind "日々投稿" — docs/projects/moyasuka/
posting-policy.md always assumed publishing would reuse bgm_pipeline's
Routine mechanism, but until now nothing in this repo ever called the
YouTube API for moyasuka; script 01 having real narration (2026-08-09)
only produced an mp4 that got sent to the owner in chat, never uploaded.
This module closes that gap by reusing bgm_pipeline's upload/status-
polling code (youtube_upload.py) unmodified, just pointed at this
channel's own OAuth token (moyasuka/youtube_auth.py — @moyasuka is a
separate channel from bgm_pipeline's, so it needs its own authorization).

Usage (once a script's narration audio+durations exist — from
voicevox_narrate.py, or manual_narration.py's `assemble` for the
Shortcuts/phone-app workflow, see docs/projects/moyasuka/narration-sop.md):

    python3 -m moyasuka.publish \\
        --script moyasuka/scripts/01-sample.md \\
        --audio /tmp/moyasuka-01-narration.wav \\
        --durations /tmp/moyasuka-01-narration.durations.json \\
        --privacy public

Title is pulled from the script's `**タイトル案**:` header line (every
scripts/*.md file has one). Description is the fixed per-video template
below — separate from docs/projects/moyasuka/channel-description.md,
which is the channel's one-time "About" section, not the per-upload
description YouTube shows under each video.

One-time setup before this can upload anything at all:
`python3 -m moyasuka.youtube_auth login`, approved while signed into
whichever Google account manages @moyasuka.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from moyasuka import youtube_auth
from moyasuka.line_chat import render_video

# Reused as-is from bgm_pipeline — moyasuka/youtube_auth.py already puts
# bgm-pipeline/ on sys.path as a side effect of importing it above.
from bgm_pipeline import youtube_upload

CATEGORY_ENTERTAINMENT = "24"  # not bgm_pipeline's default "10" (Music) — this is drama content
DEFAULT_TAGS = ["スカッと", "LINEドラマ", "ショートドラマ", "スカッとする話", "Shorts"]

# 2026-08-18: 【ネタ募集】行を追加(channel-description.mdの「概要」欄には
# 元々あったが、動画ごとのこのテンプレートには反映し忘れていた)。オーナーが
# ちょうどモヤスカ専用Xアカウント(@moyasuka_ch、第一候補@moyasukaは取得
# できず)を作成したタイミングに合わせて、告知が実際に効く状態にする。
DESCRIPTION_TEMPLATE = """{title}

■ 使用音声
Google Cloud Text-to-Speechによる音声合成を使用しています

■ ネタ募集
実際にあった「モヤモヤ→スカッと」なLINEエピソード、募集中です。X(@moyasuka_ch)にDMいただけると嬉しいです✨

■ ご注意
本チャンネルのストーリーはすべてフィクションです。実在の人物・団体とは一切関係ありません。

毎日20:00更新。チャンネル登録で見逃し防止。

#スカッと #LINEドラマ #ショートドラマ #Shorts"""


def _title_from_script(script_path: str) -> str:
    """Pulls the `**タイトル案**: ...` line every scripts/*.md file has and
    appends " #Shorts" (owner request, 2026-08-14: Shorts向けにタイトルも
    最適化する) — YouTube's Shorts classifier already picks this video up
    automatically from format (line_chat.py's 720x1280, 9:16) + duration
    (well under 3 minutes), but a "#Shorts" signal in the title itself is
    the extra nudge many creators rely on, on top of DEFAULT_TAGS/
    DESCRIPTION_TEMPLATE already carrying it. Skipped if the title already
    mentions Shorts so this never double-appends."""
    text = Path(script_path).read_text(encoding="utf-8")
    m = re.search(r"\*\*タイトル案\*\*:\s*(.+)", text)
    if not m:
        raise SystemExit(f"{script_path} に「**タイトル案**:」行が見つかりません。")
    title = m.group(1).strip()
    if "shorts" not in title.lower():
        title = f"{title} #Shorts"
    return title


def publish(
    script_path: str,
    audio_path: str,
    durations_path: str,
    privacy: str = "public",
    workdir: str = "/tmp/moyasuka-publish",
) -> str:
    """Renders the video and uploads it. Returns the new video's ID."""
    title = _title_from_script(script_path)
    Path(workdir).mkdir(parents=True, exist_ok=True)
    mp4_path = f"{workdir}/{Path(script_path).stem}.mp4"

    render_video(script_path, mp4_path, audio_path=audio_path, durations_path=durations_path)

    description = DESCRIPTION_TEMPLATE.format(title=title)
    video_id = youtube_upload.upload_video(
        mp4_path, title, description, DEFAULT_TAGS,
        category_id=CATEGORY_ENTERTAINMENT, privacy_status=privacy,
        auth=youtube_auth.auth,
    )
    youtube_upload.wait_for_processing(video_id, timeout_seconds=600, auth=youtube_auth.auth)
    return video_id


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render and publish one モヤスカ episode to YouTube.")
    parser.add_argument("--script", required=True)
    parser.add_argument("--audio", required=True, help="narration wav (voicevox_narrate.py / manual_narration.py output)")
    parser.add_argument("--durations", required=True, help="matching <out>.durations.json")
    parser.add_argument("--privacy", default="public", choices=["public", "unlisted", "private"])
    parser.add_argument("--workdir", default="/tmp/moyasuka-publish")
    args = parser.parse_args(argv)

    video_id = publish(args.script, args.audio, args.durations, privacy=args.privacy, workdir=args.workdir)
    print(f"https://youtube.com/watch?v={video_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
