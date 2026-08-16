"""Renders a script as an actual LINE-style chat exchange (rounded message
bubbles, green for the protagonist's own messages / white for everyone
else's, a group-chat header bar) — owner feedback 2026-08-06: "ラインの
ようなやり取りにして".

Until now `assemble_video.py` burned the script's prose straight onto the
screen as plain subtitle captions. That was never actually "LINE-style":
this channel's whole premise is a LINE conversation, so the content itself
needed to become message turns, not narrated paragraphs read over a
caption. See docs/projects/moyasuka/line-chat-ui.md for the full design
note and the script-format convention this module expects.

Layout (720x1280, matching background_gen.py) — revised 2026-08-06 after
the first version made the background nearly invisible behind a
bottom-sheet panel that covered most of the screen, then again 2026-08-14
when the background itself changed from a ball-physics arena to a slow
parallax scroll (see background_gen.py's module docstring for why), then
again 2026-08-16 per the owner's UI修正指示報告書, reference screenshot
attached ("Made with AI"-badge style — bubbles floating directly over the
blurred background, no enclosing card, no header bar):
  - there is no opaque panel card and no green LINE-style header/group-name
    bar anymore — those used to sit behind/above the messages (draw_panel_
    chrome, removed) and the owner's review called them out as unwanted
    clutter that didn't match the reference channel's look
  - message bubbles (still individually white/green with their own
    rounded-rect background — that part of the reference IS kept) are
    composited straight onto the parallax background within the same
    PANEL_TOP..PANEL_BOTTOM vertical band the old panel used to occupy, so
    the background is visible everywhere around/behind them, exactly like
    the reference

No system-notice/narration cards: owner feedback 2026-08-06 ("心の声とか
いらない") was that scene-setting narration text doesn't belong in a pure
chat format — the story now has to be told entirely through what
characters actually type, the same way real LINE-drama channels do it.
`parse_chat_script` still recognizes `> ` lines for flexibility, but the
shipped scripts no longer use them (see git history for the before/after).

Messages reveal progressively and the log auto-scrolls (oldest content
clips off the top of the panel) exactly like scrolling through a real
chat, timed by the same character-count reading-speed heuristic
`assemble_video.py` already uses (see that file's TODO about swapping this
for VOICEVOX's real mora timings once it's set up).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from moyasuka.background_gen import FPS
from moyasuka.background_gen import H as BG_H
from moyasuka.background_gen import W as BG_W
from moyasuka.background_gen import iter_frames
from moyasuka.bgm import render_bgm_loop
from moyasuka.sfx import SFX_GENERATORS

JP_FONT_PATH = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"

PANEL_TOP = 50          # px from top where messages start appearing
PANEL_BOTTOM = 700      # px where the visible log is cropped — background_gen.py's parallax layers are seeded within VISIBLE_Y0-Y1 (≈538-1254), fully below this
SELF_BUBBLE = (0, 195, 106)     # sent-message green
SELF_TEXT = (255, 255, 255)
OTHER_BUBBLE = (255, 255, 255)
OTHER_TEXT = (30, 30, 34)
OTHER_BORDER = (224, 224, 230)
NAME_TEXT = (110, 114, 128)
CARD_BG = (223, 224, 228)
CARD_TEXT = (90, 92, 102)
AVATAR_COLORS = [(255, 138, 101), (77, 182, 172), (149, 117, 205), (100, 181, 246)]


# 2026-08-14 UI pass (owner review against the reference video: "重い・
# 大きい・読みにくい"): bubbles narrower + more inset from the edges, text
# smaller, more breathing room between messages.
BUBBLE_FONT_SIZE = 26    # was 30 (-13%)
NAME_FONT_SIZE = 19      # was 22, scaled with BUBBLE_FONT_SIZE
CARD_FONT_SIZE = 24

BUBBLE_MAX_WIDTH = int(BG_W * 0.60)  # was 0.66 — "吹き出し幅を60%前後に"
PANEL_PAD_X = 34                      # was 24 — wider L/R margins, closer to real LINE
GAP_BETWEEN_BLOCKS = 28               # was 18 — more room between different senders' bursts

CHARS_PER_SECOND = 6.5
MIN_BLOCK_SECONDS = 1.3
GAP_SECONDS = 0.15  # 2026-08-16: was 0.235 (2026-08-14) — trimmed further to make room for LEAD_IN_SECONDS growing, still ~59.5-60.0s (Shorts duration budget)

# Owner feedback (2026-08-16): "最初の通知音が音声と被っている" — the opening
# notification cue (sfx.py's "notification", now a real ~1.9s clip, see
# NOTICE.md) was firing at t=0 while the old 0.5s lead-in let the first
# line's speech start at t=0.5, well before the notification finished —
# audible overlap. Lead-in now covers the notification's full length (with
# a little breathing room) so speech never starts until it's done.
LEAD_IN_SECONDS = 2.0


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
      - a message of exactly `[image]` or `[image:ラベル1=値1,ラベル2=値2]`
        renders as a self-generated "app screenshot" evidence chart
        instead of a bubble with text
      - a message of exactly `[sticker]` or `[sticker:困り顔]` renders as a
        self-generated sticker graphic (no bubble/border, LINE-sticker
        style) instead of a text bubble
      - a line `!sfx:名前` (e.g. `!sfx:scratch_hype`, see sfx.py) is a
        zero-duration audio cue: no visual block, doesn't advance the
        script's timeline, just marks the moment a sound effect should
        land in the mixed audio track
    (owner feedback 2026-08-06: "画像とかスタンプとかが文字表記になって
    いるので変えて" — these used to just be bracketed placeholder text
    inside an ordinary bubble, e.g. "[家事記録アプリの画面を送信]";  now
    they render as actual graphics, self-generated the same way as every
    other visual asset in this repo, not stock images.)

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
        if line.startswith("!sfx:"):
            items.append({"type": "sfx", "name": line.split(":", 1)[1].strip()})
            continue
        if ":" in line or "：" in line:
            sep = ":" if ":" in line else "："
            speaker, msg = line.split(sep, 1)
            speaker, msg = speaker.strip(), msg.strip()
            if not msg:
                continue
            side = "self" if speaker == "私" else "other"
            kind, payload, body_text = "text", None, msg
            if msg.startswith("[") and msg.endswith("]"):
                tag, _, rest = msg[1:-1].partition(":")
                if tag == "image":
                    kind, payload, body_text = "image", rest or None, ""
                elif tag == "sticker":
                    kind, payload, body_text = "sticker", rest or "困り顔", ""
            items.append({"type": "msg", "speaker": speaker, "text": body_text, "side": side, "kind": kind, "payload": payload})

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
        elif item["type"] != "sfx":  # a card resets the burst; a zero-duration sfx cue doesn't
            prev_speaker = None

    return title, items


IMAGE_VIEW_SECONDS = 2.2   # dwell time for an [image] evidence chart (no text to time against)
STICKER_VIEW_SECONDS = 1.6  # dwell time for a [sticker]

# Owner feedback (2026-08-14, after watching 台本01's actual audio): a
# message that's just "......" (a beat of silence/hesitation, several
# scripts use this) doesn't read as silence when sent to a TTS
# engine — Cloud TTS (and VOICEVOX) will synthesize *something* for a
# string of punctuation, which comes out as an odd noise, not the pause
# it's meant to represent. Fix: recognize these lines up front and treat
# them as a fixed-length silent beat instead of calling TTS at all — the
# bubble still renders normally (unchanged visually), only the narration
# generators (gcp_tts_narrate.py, voicevox_narrate.py, manual_narration.py)
# special-case it via is_pause_only()/PAUSE_SECONDS below.
PAUSE_SECONDS = 0.3  # 2026-08-14: was 0.4, tightened to fit the owner's 0.2-0.3s "間" spec and the 60s Shorts duration budget
_PAUSE_ONLY_RE = re.compile(r"^[.…。、・\s]+$")


def is_pause_only(text: str) -> bool:
    return bool(text) and bool(_PAUSE_ONLY_RE.match(text))

# Owner request (2026-08-10): "ひどい言葉や衝撃的な言葉を言われた際に、
# BGMとして驚きのような効果音入れて" — a harsh/shocking word landing in the
# dialogue should trigger a surprise stinger (sfx.py's "surprise_hit")
# automatically, not just the one manually-placed climax cue. Plain
# substring match against each spoken line's text (Japanese doesn't need
# word-boundary handling for this); deliberately a curated list rather
# than sentiment analysis — false positives are cheap to fix by editing
# this list, a missed subtle line is not worth chasing with NLP here.
# Covers both direct insults/threats and the "someone did something
# unforgivable" reveal words this genre's antagonists and twists use
# (嘘つき already fires on 01-sample.md's reveal reaction line).
HARSH_TRIGGER_WORDS = [
    "死ね", "消えろ", "きもい", "うざい", "ばか", "アホ", "あほ",
    "無能", "クビ", "離婚", "浮気", "借金", "泥棒", "盗ん",
    "嘘つき", "裏切り", "ゴミ", "カス", "図々しい", "ずるい",
    "才能ない", "向いてない", "許せない", "ありえない", "最悪",
]


def _has_harsh_word(text: str) -> bool:
    return any(word in text for word in HARSH_TRIGGER_WORDS)


def estimate_arrivals(items: list[dict], durations: list[float] | None = None) -> list[tuple[float, float, dict]]:
    """`durations`, when given, is a list of real clip lengths aligned 1:1
    with `items` (one float per item, unused/0 for "sfx") — this is what
    moyasuka/voicevox_narrate.py produces once real narration audio
    exists, so bubbles/captions land exactly when each line is actually
    spoken instead of the character-count guess below. Without it (no
    VOICEVOX audio yet), the guess is all there is to time against."""
    t = LEAD_IN_SECONDS
    out = []
    for i, item in enumerate(items):
        if item["type"] == "sfx":
            # zero-duration: stamps the current timeline position without
            # pushing anything after it later, since it's just an audio cue
            out.append((t, t, item))
            continue
        if durations is not None:
            dur = durations[i]
        else:
            kind = item.get("kind", "text")
            if kind == "image":
                dur = IMAGE_VIEW_SECONDS
            elif kind == "sticker":
                dur = STICKER_VIEW_SECONDS
            else:
                dur = max(MIN_BLOCK_SECONDS, len(item["text"]) / CHARS_PER_SECOND)
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


# Owner request (2026-08-16): "既読がまだついてない" — real LINE shows a
# small "既読" label under a message once the recipient has read it; the
# reference channel's drama often leans on this (a visible "既読" with no
# reply for several beats reads as more cutting than the words alone).
# Implemented as its own tiny follow-up block rather than baking it into
# the bubble image itself, so it can appear on a delay (see render_video)
# using the exact same stacking/visibility machinery every other block
# already uses — no new compositing logic needed.
READ_RECEIPT_DELAY = 0.45  # beat after the bubble lands, not instant — reads as someone actually glancing at their phone
READ_RECEIPT_H = 20
READ_RECEIPT_FONT_SIZE = 15
READ_RECEIPT_COLOR = (154, 158, 168)


def _render_read_receipt() -> _Block:
    font = _font(READ_RECEIPT_FONT_SIZE)
    text = "既読"
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    tw = probe.textbbox((0, 0), text, font=font)[2]
    img = Image.new("RGBA", (BG_W, READ_RECEIPT_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x1 = BG_W - PANEL_PAD_X
    d.text((x1 - tw, 0), text, font=font, fill=READ_RECEIPT_COLOR)
    return _Block(img, tight=True)


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


def _wrap_media_block(speaker: str, side: str, grouped: bool, media: Image.Image) -> _Block:
    """Positions a pre-rendered image/sticker graphic the same way
    `_render_bubble` positions a text bubble (self→right edge, other→left
    with name/avatar on first-of-burst), but with no bubble background —
    the graphic's own transparent-canvas edges are the message."""
    avatar_d = 56
    show_header = side == "other" and not grouped
    name_h = NAME_FONT_SIZE + 10 if show_header else 0
    total_h = name_h + media.height + 6
    img = Image.new("RGBA", (BG_W, total_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if side == "self":
        x0 = BG_W - PANEL_PAD_X - media.width
        img.alpha_composite(media, (x0, 0))
    else:
        ax = PANEL_PAD_X
        x0 = ax + avatar_d + 12
        if show_header:
            avatar_color = AVATAR_COLORS[abs(hash(speaker)) % len(AVATAR_COLORS)]
            d.text((x0, 0), speaker, font=_font(NAME_FONT_SIZE), fill=NAME_TEXT)
            d.ellipse([ax, name_h, ax + avatar_d, name_h + avatar_d], fill=avatar_color)
            d.text(
                (ax + avatar_d / 2, name_h + avatar_d / 2), speaker[:1],
                font=_font(24), fill=(255, 255, 255), anchor="mm",
            )
        img.alpha_composite(media, (x0, name_h))

    return _Block(img, tight=grouped)


def _parse_evidence_payload(payload: str | None) -> tuple[str, list[tuple[str, str]]]:
    """`[image:家事記録アプリ:掃除=613,洗濯=890]` → ("家事記録アプリ",
    [("掃除","613"),("洗濯","890")]). The header segment is optional —
    `[image:掃除=613,洗濯=890]` (no leading `見出し:`) falls back to a
    generic header. Values that parse as int render as a labeled bar;
    anything else (dates, etc.) renders as plain right-aligned text — see
    _render_evidence_chart."""
    header = "証拠"
    rows_part = payload or ""
    if payload and ":" in payload:
        maybe_header, _, rest = payload.partition(":")
        if "=" in rest:  # only treat the prefix as a header if `rest` still looks like row data
            header, rows_part = maybe_header.strip(), rest

    rows = []
    for part in rows_part.split(","):
        if "=" in part:
            label, _, val = part.partition("=")
            rows.append((label.strip(), val.strip()))
    return header, (rows or [("記録", "1")])


def _render_evidence_chart(header: str, data: list[tuple[str, str]], width: int = 300) -> Image.Image:
    """The self-generated "app screenshot" graphic used for [image]
    messages — a small bar chart (for numeric data) or a plain labeled
    list (for text values like dates) mocked up to look like a phone
    screenshot, standing in for the "証拠" (evidence) the story's
    protagonist sends. Pure PIL, same policy as every other visual asset
    in this repo (background_gen.py, channel_art.py): no stock images."""
    row_h, pad, header_h = 54, 18, 44
    height = header_h + pad + row_h * len(data) + pad
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, width - 1, height - 1], radius=18, fill=(255, 255, 255, 255), outline=(224, 224, 230, 255), width=2)
    d.text((pad, 12), header, font=_font(22), fill=(60, 60, 66))
    d.line([(0, header_h), (width, header_h)], fill=(230, 230, 235), width=2)

    lf = _font(20)
    numeric = [int(v) for _, v in data if v.isdigit()]
    max_val = max(numeric, default=1) or 1
    bar_x0 = pad + 70
    bar_max_w = width - bar_x0 - pad - 60
    # 2026-08-14 (owner review: 証拠UIの彩度が高くチャットより主張してし
    # まう): desaturated to ~35% of the original saturation (blended
    # toward each color's gray/luminance average) so this stays a quiet
    # background element instead of competing with the chat bubbles.
    colors = [(195, 140, 152), (150, 179, 205), (201, 175, 140), (149, 170, 142)]
    y = header_h + pad
    for i, (label, val) in enumerate(data):
        d.text((pad, y + 8), label, font=lf, fill=(80, 80, 90))
        if val.isdigit():
            n = int(val)
            bw = max(int(bar_max_w * n / max_val), 6)
            d.rounded_rectangle([bar_x0, y + 6, bar_x0 + bw, y + row_h - 14], radius=8, fill=colors[i % len(colors)])
            d.text((bar_x0 + bw + 10, y + 8), f"{n}回", font=lf, fill=(60, 60, 66))
        else:
            tw = d.textbbox((0, 0), val, font=lf)[2]
            d.text((width - pad - tw, y + 8), val, font=lf, fill=(60, 60, 66))
        y += row_h
    return img


def _render_sticker_face(label: str, size: int = 170) -> Image.Image:
    """A simple self-drawn emoji-style sticker face, standing in for a
    real LINE sticker (which this repo can't legally bundle). Currently
    supports a 困り顔/"troubled" expression — the one the shipped scripts
    use — with room to add more by label if future scripts need them."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([4, 4, size - 4, size - 4], fill=(255, 205, 112, 255), outline=(210, 160, 80, 255), width=3)

    eb_y = size * 0.36
    d.line([(size * 0.28, eb_y + 8), (size * 0.42, eb_y - 4)], fill=(90, 70, 40), width=6)
    d.line([(size * 0.58, eb_y - 4), (size * 0.72, eb_y + 8)], fill=(90, 70, 40), width=6)

    er = size * 0.045
    for ex in (0.34, 0.66):
        d.ellipse([size * ex - er, size * 0.46 - er, size * ex + er, size * 0.46 + er], fill=(70, 50, 30, 255))

    mx0, mx1, my = size * 0.34, size * 0.66, size * 0.68
    d.line(
        [(mx0, my), (mx0 + (mx1 - mx0) * 0.33, my - 10), (mx0 + (mx1 - mx0) * 0.66, my + 10), (mx1, my)],
        fill=(120, 80, 40), width=5, joint="curve",
    )
    d.ellipse([size * 0.78, size * 0.26, size * 0.78 + size * 0.09, size * 0.26 + size * 0.15], fill=(120, 200, 255, 255))
    return img


def render_block(item: dict) -> _Block:
    if item["type"] == "card":
        return _render_card(item["text"])
    kind = item.get("kind", "text")
    grouped = item.get("grouped", False)
    if kind == "image":
        header, data = _parse_evidence_payload(item.get("payload"))
        chart = _render_evidence_chart(header, data)
        return _wrap_media_block(item["speaker"], item["side"], grouped, chart)
    if kind == "sticker":
        face = _render_sticker_face(item.get("payload") or "困り顔")
        return _wrap_media_block(item["speaker"], item["side"], grouped, face)
    return _render_bubble(item["speaker"], item["text"], item["side"], grouped)


TIGHT_GAP = 10  # vertical gap within a same-speaker burst (vs. GAP_BETWEEN_BLOCKS between senders) — was 6, widened alongside GAP_BETWEEN_BLOCKS 2026-08-14


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


def render_frame(base: Image.Image, all_blocks: list[_Block], arrival_times: list[float], t: float) -> Image.Image:
    """`all_blocks`/`arrival_times` are pre-rendered once per script (see
    render_video) and reused across every frame — rendering each bubble's
    text/wrapping fresh on every single frame (this function used to take
    the raw `items` and call render_block() here) turned an easy render
    into an O(frames × messages) one and was the reason the first end-to-
    end test run didn't finish in a reasonable time.

    2026-08-16: no more enclosing card/header (see module docstring) — the
    parallax background frame is used as-is and bubbles are composited
    straight onto it within the PANEL_TOP..PANEL_BOTTOM band."""
    frame = base.convert("RGBA")

    visible = [b for b, start in zip(all_blocks, arrival_times) if start <= t]
    panel_h = PANEL_BOTTOM - PANEL_TOP
    overlay = compose_chat_overlay(visible, panel_h)
    frame.alpha_composite(overlay, (0, PANEL_TOP))
    return frame.convert("RGB")


def _mix_audio(narration_path: str, total_seconds: float, sfx_cues: list[tuple[float, str]], tmp: str) -> str:
    """Layers the BGM loop (always, quiet — owner request 2026-08-06:
    "小さい音でいいからBGMは付けて") and each `!sfx:` cue's synthesized
    stinger (at its cue time, via adelay) onto the narration track.

    `normalize=0` on amix is deliberate: the default normalizes by
    dividing every input's volume by the input count, which would make a
    placeholder silence track (or the always-on BGM bed) "quieter" for no
    reason and mute short cue clips mixed against long narration — with
    normalize off, tracks with nothing playing at a given moment
    contribute nothing and don't dilute the others' volume. BGM's own
    quiet level is baked into bgm.render_bgm_loop's `amplitude`, not
    handled here."""
    bgm_path = f"{tmp}/bgm.wav"
    render_bgm_loop(total_seconds, bgm_path)

    inputs = ["-i", narration_path, "-i", bgm_path]
    filter_parts = [
        "[0:a]aformat=sample_rates=44100:channel_layouts=mono[a0]",
        "[1:a]aformat=sample_rates=44100:channel_layouts=mono[bgm]",
    ]
    mix_labels = ["[a0]", "[bgm]"]
    generated: dict[str, str] = {}  # cue name -> rendered wav path, so a name used many times (message_pop) is synthesized once
    for i, (start, name) in enumerate(sfx_cues):
        if name not in generated:
            gen = SFX_GENERATORS.get(name)
            if gen is None:
                continue
            path = f"{tmp}/sfx_{name}.wav"
            gen(path)
            generated[name] = path
        inputs += ["-i", generated[name]]
        delay_ms = max(int(start * 1000), 0)
        filter_parts.append(
            f"[{len(mix_labels)}:a]aformat=sample_rates=44100:channel_layouts=mono,adelay=delays={delay_ms}:all=1[sfx{i}]"
        )
        mix_labels.append(f"[sfx{i}]")

    filter_complex = ";".join(filter_parts) + f";{''.join(mix_labels)}amix=inputs={len(mix_labels)}:duration=first:dropout_transition=0:normalize=0[mixed]"
    mixed_path = f"{tmp}/mixed_audio.wav"
    subprocess.run(
        ["ffmpeg", "-y", *inputs, "-filter_complex", filter_complex, "-map", "[mixed]", mixed_path],
        check=True, capture_output=True,
    )
    return mixed_path


def render_video(script_path: str, out_path: str, seed: int = 0, audio_path: str | None = None, durations_path: str | None = None) -> float:
    """Full pipeline: parse the chat script, render every frame (ball
    background from background_gen.iter_frames + the LINE chat overlay on
    top), encode, and mux with narration audio.

    Mirrors assemble_video.py's placeholder-audio approach: with no
    --audio, a silent track is generated from the estimated total duration
    so this can be built/tested end-to-end before VOICEVOX is set up.

    `durations_path`, once real narration exists, points at the
    `<out>.durations.json` sidecar moyasuka/voicevox_narrate.py writes
    alongside its audio — passing both --audio and --durations syncs
    every bubble/caption to the real recorded speech instead of the
    character-count guess.
    """
    _title, items = parse_chat_script(script_path)  # group title no longer drawn on-screen (2026-08-16); still parsed for script-format compatibility
    if not items:
        raise ValueError(f"no chat items found in {script_path}")
    durations = None
    if durations_path:
        with open(durations_path, encoding="utf-8") as f:
            durations = json.load(f)
    arrivals = estimate_arrivals(items, durations)
    total_seconds = arrivals[-1][1] + 1.2

    # sfx cues carry no visual block (see estimate_arrivals) — pull them
    # out before building the chat overlay's block list
    sfx_cues = [(start, item["name"]) for (start, _end, item) in arrivals if item["type"] == "sfx"]
    visual_arrivals = [(start, end, item) for (start, end, item) in arrivals if item["type"] != "sfx"]

    # every message bubble gets a short notification "pop" as it lands —
    # not a one-off cue, this is the actual, constant soundscape of the
    # genre (owner feedback 2026-08-06, round 3: the missing piece wasn't
    # the climax stinger, it was this)
    pop_cues = [(start, "message_pop") for (start, _end, item) in visual_arrivals if item["type"] == "msg"]

    # content-triggered surprise stinger — see HARSH_TRIGGER_WORDS above.
    # Deliberately layered on top of that same bubble's message_pop rather
    # than replacing it: the pop is the constant per-message soundscape,
    # the shock hit is the extra emphasis on top of it for this one line.
    shock_cues = [
        (start, "surprise_hit")
        for (start, _end, item) in visual_arrivals
        if item["type"] == "msg" and item.get("kind", "text") == "text" and _has_harsh_word(item["text"])
    ]

    # 証拠提示(evidence reveal) gets its own cue — owner request 2026-08-14.
    # Auto-triggered the same way pop_cues/shock_cues are: every [image]
    # cue, no manual !sfx: line needed.
    screenshot_cues = [
        (start, "screenshot")
        for (start, _end, item) in visual_arrivals
        if item["type"] == "msg" and item.get("kind") == "image"
    ]

    # opening hook — owner request (2026-08-16): "まず最初に通知音を出して".
    # Fires once at t=0, ahead of the first message's own message_pop
    # (which lands at estimate_arrivals' 0.5s lead-in), so it reads as "a
    # notification just arrived" a beat before the chat itself opens,
    # rather than overlapping the first bubble's own pop.
    notification_cues = [(0.0, "notification")]

    sfx_cues = sfx_cues + notification_cues + pop_cues + shock_cues + screenshot_cues

    # render each bubble/card once and reuse the image across every frame
    # instead of re-wrapping and re-drawing text per frame (see render_frame's
    # docstring for why that matters)
    all_blocks: list[_Block] = []
    arrival_times: list[float] = []
    for start, _end, item in visual_arrivals:
        all_blocks.append(render_block(item))
        arrival_times.append(start)
        # a delayed follow-up "既読" block right after its own bubble — only
        # on messages 私 sent, matching real LINE (the receipt shows who
        # read *your* message, not the other way around)
        if item["type"] == "msg" and item.get("side") == "self":
            all_blocks.append(_render_read_receipt())
            arrival_times.append(start + READ_RECEIPT_DELAY)

    with tempfile.TemporaryDirectory() as tmp:
        frame_dir = Path(tmp) / "frames"
        frame_dir.mkdir()
        n = 0
        for f, (t, bg_img) in enumerate(iter_frames(total_seconds, seed)):
            frame = render_frame(bg_img, all_blocks, arrival_times, t)
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

        audio_path = _mix_audio(audio_path, total_seconds, sfx_cues, tmp)

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
    parser.add_argument("--durations", default=None, help="<out>.durations.json from voicevox_narrate.py — syncs bubbles to the real audio instead of estimating from character count")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    total = render_video(args.script, args.out, args.seed, args.audio, args.durations)
    print(f"wrote {args.out} ({total:.1f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
