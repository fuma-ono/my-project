"""kashikariのアプリアイコンを生成する(プレースホルダー、正式なブランドアイコンが
できたら差し替える前提)。フォントのグリフに依存せず、ImageDrawの図形だけで
「交換(⇄)」を表現する矢印を描く。
"""
import math
from PIL import Image, ImageDraw

ACCENT = (255, 107, 74)  # #ff6b4a
FAVOR = (140, 79, 209)  # #8c4fd1
WHITE = (255, 255, 255, 255)

SIZE = 1024
OUT_DIR = "assets"


def gradient_bg(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)  # 対角グラデーション
            r = int(ACCENT[0] + (FAVOR[0] - ACCENT[0]) * t)
            g = int(ACCENT[1] + (FAVOR[1] - ACCENT[1]) * t)
            b = int(ACCENT[2] + (FAVOR[2] - ACCENT[2]) * t)
            px[x, y] = (r, g, b)
    return img


def draw_arrow(draw, x1, y1, x2, y2, width, head_size, color):
    draw.line([(x1, y1), (x2, y2)], fill=color, width=width)
    angle = math.atan2(y2 - y1, x2 - x1)
    for da in (-1, 1):
        a = angle + da * math.radians(28)
        hx = x2 - head_size * math.cos(a)
        hy = y2 - head_size * math.sin(a)
        draw.line([(x2, y2), (hx, hy)], fill=color, width=width)


def draw_mark(draw, cx, cy, scale):
    w = int(46 * scale)
    head = int(70 * scale)
    span = int(230 * scale)
    gap = int(70 * scale)
    # 上向き矢印(右向き)
    draw_arrow(draw, cx - span, cy - gap, cx + span, cy - gap, w, head, WHITE)
    # 下向き矢印(左向き)
    draw_arrow(draw, cx + span, cy + gap, cx - span, cy + gap, w, head, WHITE)


def make_icon():
    img = gradient_bg(SIZE).convert("RGBA")
    draw = ImageDraw.Draw(img)
    draw_mark(draw, SIZE // 2, SIZE // 2, scale=1.55)
    img.convert("RGB").save(f"{OUT_DIR}/icon.png")
    img.convert("RGB").resize((256, 256), Image.LANCZOS).save(f"{OUT_DIR}/favicon.png")


def make_adaptive_foreground():
    # Androidアダプティブアイコンは安全領域が中央66%程度なので、そこに収める。
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw_mark(draw, SIZE // 2, SIZE // 2, scale=1.0)
    img.save(f"{OUT_DIR}/android-icon-foreground.png")


if __name__ == "__main__":
    make_icon()
    make_adaptive_foreground()
    print("done")
