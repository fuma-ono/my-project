"""字幕を PNG(透過)で作る。ナレーションの start/end(timing.json)から表示時間を決める。
文字は M+ FONTS(OFL)。はみ出す場合は自動で縮める。
使い方: python3 -I src/subtitles.py <config.json> <timing.json> <workdir>
"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont


def main(cfg_path, timing_path, workdir):
    c = json.load(open(cfg_path, encoding="utf-8"))
    T = json.load(open(timing_path, encoding="utf-8"))
    s = c["subtitle"]
    W, H = c["width"], 340
    cues = []
    for n in T["narration"]:
        lines = n["subtitle"].split(" ")  # 半角スペースの位置で改行(大きな文字を保つ)
        size = s["size"]
        sw = s["stroke_width"]
        tmp = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
        while True:
            font = ImageFont.truetype(s["font"], size)
            boxes = [tmp.textbbox((0, 0), ln, font=font, stroke_width=sw) for ln in lines]
            if max(b[2] - b[0] for b in boxes) <= W - 120 or size < 40:
                break
            size -= 4
        lh = int(size * 1.25)
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        y0 = (H - lh * len(lines)) // 2
        for k, (ln, bb) in enumerate(zip(lines, boxes)):
            x = (W - (bb[2] - bb[0])) // 2 - bb[0]
            d.text((x, y0 + k * lh), ln, font=font, fill=s["fill"], stroke_width=sw, stroke_fill=s["stroke"])
        p = os.path.join(workdir, f"sub_{n['id']}.png")
        im.save(p)
        cues.append({"png": p, "start": round(max(0.0, n["start"] - 0.05), 3),
                     "end": round(min(c["duration_sec"], n["end"] + 0.45), 3),
                     "y_top": s["y_center"] - H // 2, "font_size": size, "lines": lines})
    json.dump(cues, open(os.path.join(workdir, "subtitle_cues.json"), "w"), indent=1)
    print(json.dumps(cues, ensure_ascii=False))


if __name__ == "__main__":
    main(*sys.argv[1:4])
