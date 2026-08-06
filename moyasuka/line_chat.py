"""Renders a script as an actual LINE-style chat exchange (rounded message
bubbles, green for the protagonist's own messages / white for everyone
else's, a group-chat header bar, system-notice cards for scene-setting
narration) — owner feedback 2026-08-06: "ラインのようなやり取りにして".

Until now `assemble_video.py` burned the script's prose straight onto the
screen as plain subtitle captions. That was never actually "LINE-style":
this channel's whole premise is a LINE conversation, so the content itself
needed to become message turns, not narrated paragraphs read over a
caption. See docs/projects/moyasuka/line-chat-ui.md for the full design
note and the script-format convention this module expects.

Layout (720x1280, matching background_gen.py):
  - top ~PANEL_TOP px: the existing ball-bounce background stays fully
    visible here, unobstructed — that's the "ボーっと見れる" ambient loop
    the owner asked for (2026-08-05), and this feature is about the
    conversation content, not a replacement for it.
  - below that: an opaque white "bottom sheet" chat panel with a LINE-green
    header bar, so the two design elements each get their own clear space
    instead of competing for the same pixels.

Messages/cards reveal progressively and the log auto-scrolls (oldest
content clips off the top of the panel) exactly like scrolling through a
real chat, timed by the same character-count reading-speed heuristic
`assemble_video.py` already uses (see that file's TODO about swapping this
for VOICEVOX's real mora timings once it's set up).
"""
from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from moyasuka.background_gen import FPS
from moyasuka.background_gen import H as BG_H
from moyasuka.background_gen import W as BG_W
from moyasuka.background_gen import iter_frames

JP_FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"

PANEL_TOP = 360        # px from top where the chat "bottom sheet" starts
HEADER_H = 92
PANEL_BG = (247, 247, 250)
HEADER_COLOR = (6, 199, 85)     # LINE brand green
HEADER_TEXT = (255, 255, 255)
SELF_BUBBLE = (0, 195, 106)     # sent-message green
SELF_TEXT = (255, 255, 255)
OTHER_BUBBLE = (255, 255, 255)
OTHER_TEXT = (30, 30, 34)
OTHER_BORDER = (224, 224, 230)
NAME_TEXT = (110, 114, 128)
CARD_BG = (223, 224, 228)
CARD_TEXT = (90, 92, 102)
AVATAR_COLORS = [(255, 138, 101), (77, 182, 172), (149, 117, 205), (100, 181, 246)]

BUBBLE_FONT_SIZE = 30
NAME_FONT_SIZE = 22
CARD_FONT_SIZE = 24
HEADER_FONT_SIZE = 32

BUBBLE_MAX_WIDTH = int(BG_W * 0.66)
PANEL_PAD_X = 24
GAP_BETWEEN_BLOCKS = 18

CHARS_PER_SECOND = 6.5
MIN_BLOCK_SECONDS = 1.3
GAP_SECONDS = 0.25


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(JP_FONT_PATH, size)


def _wrap(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """Character-wrap, not word-wrap — Japanese has no spaces between
    words. Same approach as bgm_pipeline/thumbnail.py and assemble_video.py."""
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    lines: list[str] = []
    current = ""
    for ch in text:
        candidate = current + ch
        if probe.textbbox((0, 0), candidate, font=font)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = ch
    if current:
        lines.append(current)
    return lines


def parse_chat_script(path: str) -> tuple[str, list[dict]]:
    """Parses the turn-based chat format:
      - a line starting with `> ` is a narration/system-notice card
      - a line `名前: メッセージ` is a chat message; speaker "私" renders as
        the protagonist's own (green, right) bubble, any other name as an
        incoming (white, left) bubble with that name shown above it
    Returns (group_title, items). group_title comes from the first `#
    タイトル:` style header line if present, else falls back to a generic
    label.
    """
    text = Path(path).read_text(encoding="utf-8")
    title = "家族LINE"
    body = text.split("---", 1)[1] if "---" in text else text
    items: list[dict] = []
    for raw in body.strip().splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("グループ名:"):
            title = line.split(":", 1)[1].strip()
            continue
        if line.startswith("> "):
            items.append({"type": "card", "text": line[2:].strip()})
            continue
        if ":" in line or "：" in line:
            sep = ":" if ":" in line else "："
            speaker, msg = line.split(sep, 1)
            speaker, msg = speaker.strip(), msg.strip()
            if not msg:
                continue
            side = "self" if speaker == "私" else "other"
            items.append({"type": "msg", "speaker": speaker, "text": msg, "side": side})

    # group consecutive messages from the same speaker: real LINE only
    # shows the name/avatar once per burst, not on every bubble, and
    # tightens the vertical gap within a burst — repeating them on every
    # short message (found by rendering and looking at it, after
    # compacting the script text per owner feedback 2026-08-06) read as
    # noticeably less authentic than a real chat log.
    prev_speaker = None
    for item in items:
        if item["type"] == "msg":
            item["grouped"] = item["speaker"] == prev_speaker
            prev_speaker = item["speaker"]
        else:
            prev_speaker = None

    return title, items


def estimate_arrivals(items: list[dict]) -> list[tuple[float, float, dict]]:
    t = 0.5  # small lead-in before the first message
    out = []
    for item in items:
        text = item["text"]
        dur = max(MIN_BLOCK_SECONDS, len(text) / CHARS_PER_SECOND)
        out.append((t, t + dur, item))
        t += dur + GAP_SECONDS
    return out


class _Block:
    """A pre-rendered chat element (bubble or card) with its own RGBA image
    and stacking height, so the per-frame draw loop only has to paste
    already-composed pieces rather than re-measuring text every frame.

    `tight`: True when this block should stack close to the block before
    it (a consecutive same-speaker message) rather than with the normal
    gap — mirrors how real LINE tightens spacing within one sender's
    "burst" of messages."""

    def __init__(self, image: Image.Image, tight: bool = False):
        self.image = image
        self.height = image.height
        self.tight = tight


def _render_card(text: str) -> _Block:
    font = _font(CARD_FONT_SIZE)
    max_w = int(BG_W * 0.7)
    lines = _wrap(text, font, max_w)
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    line_h = probe.textbbox((0, 0), "あ", font=font)[3] + 8
    text_w = max(probe.textbbox((0, 0), ln, font=font)[2] for ln in lines)
    pad_x, pad_y = 20, 12
    w, h = text_w + pad_x * 2, line_h * len(lines) + pad_y * 2
    img = Image.new("RGBA", (BG_W, h + 10), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = BG_W // 2
    d.rounded_rectangle([cx - w // 2, 5, cx + w // 2, 5 + h], radius=h // 2, fill=(*CARD_BG, 235))
    for i, ln in enumerate(lines):
        tw = d.textbbox((0, 0), ln, font=font)[2]
        d.text((cx - tw // 2, 5 + pad_y + i * line_h), ln, font=font, fill=CARD_TEXT)
    return _Block(img)


def _render_bubble(speaker: str, text: str, side: str, grouped: bool) -> _Block:
    """`grouped`: True when this is a consecutive message from the same
    speaker as the block before it — skips the name label/avatar (real
    LINE only shows those once per burst) but still indents the bubble to
    the same column so the burst reads as one visual group."""
    font = _font(BUBBLE_FONT_SIZE)
    name_font = _font(NAME_FONT_SIZE)
    lines = _wrap(text, font, BUBBLE_MAX_WIDTH - 40)
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    line_h = probe.textbbox((0, 0), "あ", font=font)[3] + 10
    text_w = max(probe.textbbox((0, 0), ln, font=font)[2] for ln in lines)
    pad_x, pad_y = 22, 16
    bw, bh = text_w + pad_x * 2, line_h * len(lines) + pad_y * 2

    avatar_d = 56
    show_header = side == "other" and not grouped
    name_h = NAME_FONT_SIZE + 10 if show_header else 0
    total_h = name_h + bh + 6
    img = Image.new("RGBA", (BG_W, total_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if side == "self":
        bx0, bx1 = BG_W - PANEL_PAD_X - bw, BG_W - PANEL_PAD_X
        fill, text_color = SELF_BUBBLE, SELF_TEXT
        d.rounded_rectangle([bx0, 0, bx1, bh], radius=22, fill=fill)
        for i, ln in enumerate(lines):
            tw = d.textbbox((0, 0), ln, font=font)[2]
            d.text((bx1 - pad_x - tw, pad_y + i * line_h), ln, font=font, fill=text_color)
    else:
        ax = PANEL_PAD_X
        bx0 = ax + avatar_d + 12
        bx1 = bx0 + bw
        if show_header:
            avatar_color = AVATAR_COLORS[abs(hash(speaker)) % len(AVATAR_COLORS)]
            d.text((bx0, 0), speaker, font=name_font, fill=NAME_TEXT)
            d.ellipse([ax, name_h, ax + avatar_d, name_h + avatar_d], fill=avatar_color)
            d.text(
                (ax + avatar_d / 2, name_h + avatar_d / 2), speaker[:1],
                font=_font(24), fill=(255, 255, 255), anchor="mm",
            )
        d.rounded_rectangle([bx0, name_h, bx1, name_h + bh], radius=22, fill=OTHER_BUBBLE, outline=OTHER_BORDER, width=2)
        for i, ln in enumerate(lines):
            d.text((bx0 + pad_x, name_h + pad_y + i * line_h), ln, font=font, fill=OTHER_TEXT)

    return _Block(img, tight=grouped)


def render_block(item: dict) -> _Block:
    if item["type"] == "card":
        return _render_card(item["text"])
    return _render_bubble(item["speaker"], item["text"], item["side"], item.get("grouped", False))


TIGHT_GAP = 6  # vertical gap within a same-speaker burst (vs. GAP_BETWEEN_BLOCKS between senders)


def compose_chat_overlay(blocks_with_state: list[_Block], panel_h: int) -> Image.Image:
    """Stacks already-visible blocks bottom-up inside the panel, scrolling
    older ones off the top once the log is taller than the panel — the
    same "newest message pins to the bottom" behavior as a real chat app.
    Gap before each block is tightened when it's `tight` (grouped with the
    block above it)."""
    gaps = [0] + [TIGHT_GAP if b.tight else GAP_BETWEEN_BLOCKS for b in blocks_with_state[1:]]
    total_h = sum(b.height for b in blocks_with_state) + sum(gaps)
    canvas = Image.new("RGBA", (BG_W, max(total_h, panel_h)), (0, 0, 0, 0))
    y = canvas.height - total_h
    for b, gap in zip(blocks_with_state, gaps):
        y += gap
        canvas.alpha_composite(b.image, (0, y))
        y += b.height
    # crop to just the bottom `panel_h` px so only the most recent log is kept
    top = max(0, canvas.height - panel_h)
    return canvas.crop((0, top, BG_W, top + panel_h))


def draw_panel_chrome(frame: Image.Image, title: str) -> None:
    """Draws the opaque bottom-sheet panel + LINE-green header bar onto a
    background frame, in place."""
    draw = ImageDraw.Draw(frame, "RGBA")
    draw.rounded_rectangle(
        [0, PANEL_TOP, BG_W, BG_H], radius=28, fill=(*PANEL_BG, 255), corners=(True, True, False, False)
    )
    draw.rectangle([0, PANEL_TOP, BG_W, PANEL_TOP + HEADER_H], fill=HEADER_COLOR)
    # re-round just the top corners of the header so it matches the panel edge
    draw.pieslice([0, PANEL_TOP, 56, PANEL_TOP + 56], 180, 270, fill=HEADER_COLOR)
    draw.pieslice([BG_W - 56, PANEL_TOP, BG_W, PANEL_TOP + 56], 270, 360, fill=HEADER_COLOR)
    hf = _font(HEADER_FONT_SIZE)
    draw.text((BG_W / 2, PANEL_TOP + HEADER_H / 2), title, font=hf, fill=HEADER_TEXT, anchor="mm")


def render_frame(base: Image.Image, title: str, all_blocks: list[_Block], arrival_times: list[float], t: float) -> Image.Image:
    """`all_blocks`/`arrival_times` are pre-rendered once per script (see
    render_video) and reused across every frame — rendering each bubble's
    text/wrapping fresh on every single frame (this function used to take
    the raw `items` and call render_block() here) turned an easy render
    into an O(frames × messages) one and was the reason the first end-to-
    end test run didn't finish in a reasonable time."""
    frame = base.convert("RGBA")
    draw_panel_chrome(frame, title)

    visible = [b for b, start in zip(all_blocks, arrival_times) if start <= t]
    panel_h = BG_H - PANEL_TOP - HEADER_H
    overlay = compose_chat_overlay(visible, panel_h)
    frame.alpha_composite(overlay, (0, PANEL_TOP + HEADER_H))
    return frame.convert("RGB")


def render_video(script_path: str, out_path: str, seed: int = 0, audio_path: str | None = None) -> float:
    """Full pipeline: parse the chat script, render every frame (ball
    background from background_gen.iter_frames + the LINE chat overlay on
    top), encode, and mux with narration audio.

    Mirrors assemble_video.py's placeholder-audio approach: with no
    --audio, a silent track is generated from the estimated total duration
    so this can be built/tested end-to-end before VOICEVOX is set up.
    """
    title, items = parse_chat_script(script_path)
    if not items:
        raise ValueError(f"no chat items found in {script_path}")
    arrivals = estimate_arrivals(items)
    total_seconds = arrivals[-1][1] + 1.2

    # render each bubble/card once and reuse the image across every frame
    # instead of re-wrapping and re-drawing text per frame (see render_frame's
    # docstring for why that matters)
    all_blocks = [render_block(item) for (_start, _end, item) in arrivals]
    arrival_times = [start for (start, _end, _item) in arrivals]

    with tempfile.TemporaryDirectory() as tmp:
        frame_dir = Path(tmp) / "frames"
        frame_dir.mkdir()
        n = 0
        for f, (t, bg_img) in enumerate(iter_frames(total_seconds, seed)):
            frame = render_frame(bg_img, title, all_blocks, arrival_times, t)
            frame.save(frame_dir / f"f{f:05d}.png")
            n = f + 1

        video_only = f"{tmp}/video_only.mp4"
        subprocess.run(
            ["ffmpeg", "-y", "-framerate", str(FPS), "-i", f"{frame_dir}/f%05d.png",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", video_only],
            check=True, capture_output=True,
        )

        if audio_path is None:
            audio_path = f"{tmp}/silence.wav"
            subprocess.run(
                ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
                 "-t", str(total_seconds), audio_path],
                check=True, capture_output=True,
            )

        subprocess.run(
            ["ffmpeg", "-y", "-i", video_only, "-i", audio_path,
             "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
             "-shortest", out_path],
            check=True, capture_output=True,
        )

    return total_seconds


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render a モヤスカ short as a LINE-chat-style conversation.")
    parser.add_argument("--script", required=True, help="path to a scripts/*.md file in the turn-based chat format")
    parser.add_argument("--seed", type=int, default=0, help="background ball-simulation seed")
    parser.add_argument("--audio", default=None, help="narration audio; omit for a silent placeholder")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    total = render_video(args.script, args.out, args.seed, args.audio)
    print(f"wrote {args.out} ({total:.1f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
