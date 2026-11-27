"""色の正確さの検証。

ブランド画像(基準)と描画フレームで、同じ「色相マスク」を使って各キャラの代表色(中央値)を取り、
CIE76 の ΔE で比べる。マスクの領域は画像ごとに指定(キャラの位置が違うため)。
ΔE の目安: <5 かなり近い / 5〜10 同じ色名に見える / >10 別の色味。
使い方: python3 -I src/color_check.py <ブランド画像> <描画フレーム> [出力json]
"""
import sys, json
import numpy as np
from PIL import Image

# (名前, ブランド画像の領域, 描画フレーム(1080x1920)の領域, 色相範囲, 彩度下限, 明度下限)
REGIONS = [
    ("pokomaru_body", (240, 300, 600, 740), (330, 960, 770, 1320), (95, 160), 0.25, 0.30),
    ("pipi_body",     (0, 380, 260, 720),   (90, 960, 330, 1330),  (35, 52), 0.50, 0.30),
    ("fuwari_fur",    (590, 300, 880, 700), (740, 980, 1010, 1400), (195, 230), 0.12, 0.30),
    ("fuwari_ear_inner", (640, 150, 720, 330), (780, 760, 900, 970), (330, 355), 0.20, 0.30),
]


def hsv_of(im):
    return np.array(im.convert("HSV")).astype(float)


def med(im, box, hr, smin, vmin):
    a = np.array(im.convert("RGB")).astype(float)
    hsv = hsv_of(im)
    H, S, V = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    x0, y0, x1, y1 = box
    m = np.zeros(H.shape, bool)
    m[y0:y1, x0:x1] = True
    m &= (H >= hr[0]) & (H <= hr[1]) & (S >= smin) & (V >= vmin)
    if m.sum() < 50:
        return None, int(m.sum())
    return np.median(a[m], 0), int(m.sum())


def lab(rgb):
    c = np.array(rgb, float) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = M @ c / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])


def main(ref_path, img_path, out=None):
    ref, img = Image.open(ref_path), Image.open(img_path)
    rows = []
    for name, rb, ib, hr, s, v in REGIONS:
        r, rn = med(ref, rb, hr, s, v)
        k = img.width / 1080.0  # 低解像度の試験描画でも使えるよう領域を拡縮
        i, inn = med(img, tuple(int(q * k) for q in ib), hr, s, v)
        if r is None or i is None:
            rows.append({"part": name, "error": "マスクの画素が少なすぎる", "n_ref": rn, "n_img": inn})
            continue
        de = float(np.linalg.norm(lab(r) - lab(i)))
        rows.append({"part": name, "ref": "#%02X%02X%02X" % tuple(int(x) for x in r),
                     "render": "#%02X%02X%02X" % tuple(int(x) for x in i), "deltaE76": round(de, 1),
                     "n_ref": rn, "n_img": inn})
    for r in rows:
        print(r)
    if out:
        json.dump(rows, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(*sys.argv[1:4])
