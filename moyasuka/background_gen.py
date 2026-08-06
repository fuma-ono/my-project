"""Generates the looping background video for モヤスカ shorts.

Design history (owner feedback, 2026-08-05):
  1. First draft: a soft blurred lava-lamp blob blend. Feedback: "もう少し
     特徴のある感じがいいな" (wants more visual character).
  2. Second draft: static floating chat-bubble shapes (ties to the
     content itself — LINE-style message drama). Feedback: "すこしゲーム性
     のある...そっちにも目が行ってしまう感じ" (wants game-like physicality
     that pulls the eye, like the Minecraft-parkour backgrounds this
     format usually uses).
  3. Third draft: chat-bubble-shaped balls doing real elastic-collision
     physics inside a circular arena (gravity-free, constant-speed
     reflection off the boundary — the classic "ball bouncing in a ring"
     satisfying-video mechanic). Feedback: "ボールが増えたり減ったりする
     のはどう?" (wants the population to change over time).
  4. This version: balls spawn in (scale up from nothing) and despawn
     (shrink out with a little flash) on a timer, count drifting between
     MIN_BALLS and MAX_BALLS — keeps a fixed-count arena from going
     visually static over a long loop, and gives the eye a reason to
     keep checking back in ("how many are there now").

No external assets or footage — pure PIL/numpy simulation, same approach
as bgm_pipeline's thumbnails, so there's nothing to license, attribute,
or record (unlike sourcing real Minecraft/parkour gameplay).
"""
from __future__ import annotations

import argparse
import math
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 720, 1280
FPS = 24
DT = 1.0 / FPS

# Arena sits low in the frame (2026-08-06 owner feedback: the LINE chat
# panel in line_chat.py covers most of the upper screen, and the balls
# were invisible behind it at their old centered position). Kept as a
# module constant rather than a line_chat.py-only parameter since
# line_chat.py's iter_frames() shares this exact simulation — see that
# module's PANEL_BOTTOM for the layout this position is tuned against.
ARENA_CX, ARENA_CY = W / 2, H * 0.77
ARENA_R = 230

MIN_BALLS = 3
MAX_BALLS = 9
SPAWN_ANIM_SEC = 0.5    # scale-up duration when a ball appears
DESPAWN_ANIM_SEC = 0.4  # shrink-out duration when a ball disappears
EVENT_INTERVAL_RANGE = (1.6, 3.2)  # seconds between spawn/despawn events

BG = (18, 15, 30)
RING_COLOR = (255, 255, 255)
PALETTE = [
    (255, 99, 132),   # pop pink
    (99, 220, 255),   # electric cyan
    (255, 205, 86),   # sunflower
    (154, 138, 255),  # violet
    (99, 255, 178),   # mint pop
    (255, 159, 67),   # tangerine
]


class _Ball:
    def __init__(self, i: int, rng: np.random.Generator, born_at: float) -> None:
        angle = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0, ARENA_R * 0.5)
        self.x = ARENA_CX + math.cos(angle) * r
        self.y = ARENA_CY + math.sin(angle) * r
        speed = rng.uniform(170, 245)  # scaled down with ARENA_R so motion still feels proportionate in the smaller arena
        vang = rng.uniform(0, 2 * math.pi)
        self.vx = math.cos(vang) * speed
        self.vy = math.sin(vang) * speed
        self.radius = rng.uniform(20, 30)
        self.color = PALETTE[i % len(PALETTE)]
        self.tail = "left" if rng.random() < 0.5 else "right"
        # lifecycle
        self.born_at = born_at
        self.dying_at: float | None = None  # set once a despawn event targets this ball

    def scale(self, t: float) -> float:
        age = t - self.born_at
        if age < SPAWN_ANIM_SEC:
            s_in = max(0.0, age / SPAWN_ANIM_SEC)
        else:
            s_in = 1.0
        if self.dying_at is not None:
            death_age = t - self.dying_at
            s_out = max(0.0, 1.0 - death_age / DESPAWN_ANIM_SEC)
            return min(s_in, s_out)
        return s_in

    def is_dead(self, t: float) -> bool:
        return self.dying_at is not None and (t - self.dying_at) >= DESPAWN_ANIM_SEC

    def step(self) -> None:
        self.x += self.vx * DT
        self.y += self.vy * DT
        dx, dy = self.x - ARENA_CX, self.y - ARENA_CY
        dist = math.hypot(dx, dy)
        limit = ARENA_R - self.radius
        if dist > limit:
            nx, ny = dx / dist, dy / dist
            v_dot_n = self.vx * nx + self.vy * ny
            self.vx -= 2 * v_dot_n * nx
            self.vy -= 2 * v_dot_n * ny
            self.x = ARENA_CX + nx * limit
            self.y = ARENA_CY + ny * limit


def _draw_ball(canvas: Image.Image, b: _Ball, scale: float) -> None:
    """A ball silhouette with a small speech-bubble tail nub, so the
    physics arena still reads as "message bubbles", not generic dots."""
    if scale <= 0.01:
        return
    r = b.radius * scale
    d = int(r * 2)
    pad = int(b.radius * 0.6) + 4
    layer = Image.new("RGBA", (d + pad * 2, d + pad * 2), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.ellipse([pad, pad, pad + d, pad + d], fill=(*b.color, 255))
    tail_w = r * 0.35
    ty = pad + d * 0.75
    if b.tail == "left":
        ld.polygon([(pad, ty), (pad - tail_w, ty + tail_w * 0.8), (pad, ty + tail_w)], fill=(*b.color, 255))
    else:
        ld.polygon([(pad + d, ty), (pad + d + tail_w, ty + tail_w * 0.8), (pad + d, ty + tail_w)], fill=(*b.color, 255))
    hl_r = r * 0.35
    ld.ellipse(
        [pad + r * 0.4, pad + r * 0.3, pad + r * 0.4 + hl_r, pad + r * 0.3 + hl_r],
        fill=(255, 255, 255, 120),
    )
    canvas.paste(layer, (int(b.x - layer.width / 2), int(b.y - layer.height / 2)), layer)


def _draw_pop_flash(canvas: Image.Image, x: float, y: float, progress: float, color) -> None:
    """A brief expanding ring flash at a ball's spawn/despawn point."""
    if not (0 <= progress <= 1):
        return
    max_r = 70
    r = 8 + progress * max_r
    alpha = int(200 * (1 - progress))
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.ellipse([x - r, y - r, x + r, y + r], outline=(*color, alpha), width=4)
    canvas.alpha_composite(layer)


def compose_frame(balls: list[_Ball], flashes: list[tuple[float, float, float, tuple[int, int, int]]], t: float) -> Image.Image:
    """Renders one frame (arena + balls + flashes) at time `t` and returns it
    as an RGB image, given the current ball/flash state. Pulled out of
    `render_frames`'s loop so other pipelines (moyasuka/line_chat.py's LINE
    mockup overlay) can composite on top of the same background without
    round-tripping through PNG files on disk."""
    img = Image.new("RGB", (W, H), BG)
    glow = Image.new("RGB", (W, H), BG)
    gd = ImageDraw.Draw(glow)
    for b in balls:
        s = b.scale(t)
        if s <= 0.01:
            continue
        r = b.radius * s * 1.6
        gd.ellipse([b.x - r, b.y - r, b.x + r, b.y + r], fill=b.color)
    glow = glow.filter(ImageFilter.GaussianBlur(35))
    img = Image.blend(img, glow, 0.5)

    base = img.convert("RGBA")
    draw = ImageDraw.Draw(base)
    draw.ellipse(
        [ARENA_CX - ARENA_R, ARENA_CY - ARENA_R, ARENA_CX + ARENA_R, ARENA_CY + ARENA_R],
        outline=(*RING_COLOR, 200), width=6,
    )
    for b in balls:
        _draw_ball(base, b, b.scale(t))

    for (fx, fy, event_t, color) in flashes:
        _draw_pop_flash(base, fx, fy, (t - event_t) / 0.5, color)

    return base.convert("RGB")


def iter_frames(seconds: float, seed: int):
    """Generator yielding (t, Image) for one full run of the ball
    simulation — the state-update half of the old `render_frames` loop,
    reusable by any caller that wants the raw frames instead of PNGs on
    disk."""
    rng = np.random.default_rng(seed)
    n_frames = int(FPS * seconds)

    balls: list[_Ball] = [_Ball(i, rng, born_at=0.0) for i in range(5)]
    next_id = len(balls)
    next_event_t = rng.uniform(*EVENT_INTERVAL_RANGE)
    flashes: list[tuple[float, float, float, tuple[int, int, int]]] = []  # x, y, event_t, color

    for f in range(n_frames):
        t = f / FPS

        if t >= next_event_t:
            alive = [b for b in balls if b.dying_at is None]
            spawn = len(alive) <= MIN_BALLS or (len(alive) < MAX_BALLS and rng.random() < 0.55)
            if spawn:
                nb = _Ball(next_id, rng, born_at=t)
                next_id += 1
                balls.append(nb)
                flashes.append((nb.x, nb.y, t, nb.color))
            elif alive:
                target = alive[int(rng.integers(0, len(alive)))]
                target.dying_at = t
                flashes.append((target.x, target.y, t, target.color))
            next_event_t = t + rng.uniform(*EVENT_INTERVAL_RANGE)

        for b in balls:
            if b.dying_at is None:
                b.step()
        balls = [b for b in balls if not b.is_dead(t)]

        yield t, compose_frame(balls, flashes, t)

        flashes = [fl for fl in flashes if (t - fl[2]) < 0.5]


def render_frames(out_dir: str, seconds: float, seed: int) -> int:
    import os

    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for f, (_t, img) in enumerate(iter_frames(seconds, seed)):
        img.save(f"{out_dir}/f{f:05d}.png")
        n = f + 1
    return n


def render_video(out_path: str, seconds: float, seed: int = 0) -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        render_frames(tmp, seconds, seed)
        subprocess.run(
            ["ffmpeg", "-y", "-framerate", str(FPS), "-i", f"{tmp}/f%05d.png",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", out_path],
            check=True,
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render the moyasuka bouncing-bubble background video.")
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    render_video(args.out, args.seconds, args.seed)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
