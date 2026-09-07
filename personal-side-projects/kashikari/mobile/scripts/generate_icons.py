"""kashikariのアプリアイコンを生成する(プレースホルダー、正式なブランドアイコンが
できたら差し替える前提)。

以前は矢印(⇄)をImageDrawの図形だけで描いていたが、アプリ内のロゴマーク
(src/components/Mark.tsx)を🤝の絵文字に変更したのに合わせて、こちらの
静的アイコンも🤝に統一した(アプリ内の見た目と、Expo Go上に表示される
アイコンの見た目が食い違っていたため)。絵文字はNoto Color Emojiフォント
(このリポジトリのビルド環境にインストール済み)を使い、ビットマップとして
そのまま描画する。
"""
from PIL import Image, ImageDraw, ImageFont

ACCENT = (255, 107, 74)  # colors.accent
PLUM = (107, 58, 120)  # colors.plum

SIZE = 1024
OUT_DIR = "assets"
EMOJI_FONT_PATH = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"
EMOJI = "🤝"


def gradient_bg(size, c1, c2):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)  # 対角グラデーション
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            px[x, y] = (r, g, b)
    return img


def rounded_mask(size, radius_ratio):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size, size], radius=int(size * radius_ratio), fill=255)
    return mask


def emoji_layer(size, zoom=3):
    """絵文字1文字を、指定サイズいっぱいに大きく描画したRGBAレイヤーを返す。
    NotoColorEmojiは固定のビットマップサイズでしか描画できないため、
    大きめのキャンバスに描いてから拡大・トリミングして必要な大きさにする。
    """
    font = ImageFont.truetype(EMOJI_FONT_PATH, 109)
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    bbox = draw.textbbox((0, 0), EMOJI, font=font, embedded_color=True)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), EMOJI, font=font, embedded_color=True)
    layer = layer.resize((int(size * zoom), int(size * zoom)), Image.LANCZOS)
    off = int(size * (zoom - 1) // 2)
    return layer.crop((off, off, off + size, off + size))


def make_icon():
    # 「手のマークをもう少し大きく」という指摘を受け、zoomを3→4.5→6に
    # 上げた(emoji_layerは対角トリミングで拡大する仕組みなので、
    # zoomを上げるほど絵文字がキャンバスいっぱいに大きく見える)。
    bg = gradient_bg(SIZE, ACCENT, PLUM).convert("RGBA")
    rounded = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rounded.paste(bg, (0, 0), rounded_mask(SIZE, 0.22))
    out = Image.alpha_composite(rounded, emoji_layer(SIZE, zoom=6))
    out.convert("RGB").save(f"{OUT_DIR}/icon.png")
    out.convert("RGB").resize((256, 256), Image.LANCZOS).save(f"{OUT_DIR}/favicon.png")


def make_adaptive_foreground():
    # Androidアダプティブアイコンは背景色を別途app.jsonで指定するため、
    # ここは透明背景に絵文字だけを描く。
    emoji_layer(SIZE).save(f"{OUT_DIR}/android-icon-foreground.png")


# 「実機で確認したら、ホーム画面アイコンとアプリ内のロゴマーク(Mark.tsx)で
# 手の絵文字の見た目そのものが違う(平面的なNoto vs 実機OSの絵文字フォント、
# iOSなら光沢のあるApple Color Emoji)」という指摘への対応。Mark.tsxが
# これまで絵文字を文字として描画していたため、実機ではOS標準の絵文字
# フォントに差し替わってしまい、ホーム画面アイコン(Notoで静的画像に
# 焼き込み済み)と食い違って見えていた。ブランドのロゴマークとしての
# 見た目を完全に固定するため、透明背景の画像としてここで書き出し、
# Mark.tsx側はこれをImageとして埋め込む(=どの端末で見ても同じ絵柄になる)。
# icon.pngと全く同じzoom=6を使い、見た目を完全に一致させる。
#
# 【一度出した不具合】最初512pxの別キャンバスサイズで書き出したところ、
# 「手の大きさがおかしい」という指摘を受けて実測したら、手が枠から
# はみ出るほど大きくなっていた。原因はemoji_layer内のフォントサイズが
# 常に109pt固定であること: キャンバスに対する絵文字の相対サイズが
# size引数に反比例して変わってしまうため、icon.pngと同じzoom=6を使っても
# 512px版では絵文字がicon.png(1024px)の約2倍相対的に大きく描かれ、
# そこにさらに6倍ズームがかかって破綻していた。icon.pngと完全に同じ
# 比率にするには、emoji_layerに渡すsize自体もicon.pngと同じ(SIZE定数、
# 1024px)にする必要がある(scale-invariantな関数ではないため)。
def make_mark_asset():
    emoji_layer(SIZE, zoom=6).save(f"{OUT_DIR}/mark.png")


if __name__ == "__main__":
    make_icon()
    make_adaptive_foreground()
    make_mark_asset()
    print("done")
