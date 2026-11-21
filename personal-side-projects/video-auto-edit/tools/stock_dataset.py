"""ストック動画による代替テストデータセットの台帳と取得(検証用)

  python tools/stock_dataset.py add <ファイル> --source-url <動画のページ> --title <素材名> --creator <作者> --license <名称> \
         --license-url <根拠のページ> --terms-url <サイトの規約のページ> --tag <内容の区分> [--note <メモ>]
  python tools/stock_dataset.py report                         台帳から素材一覧(Markdown)を出す
  python tools/stock_dataset.py commons-search <検索語> [--limit N]   Wikimedia Commons の動画の候補(ライセンスつき)を出す
  python tools/stock_dataset.py commons-get <File:名前> --tag <区分>   候補を1本取得して台帳に追加(自動でライセンスを確認)

方針(オーナー指示 2026-11-21):
- 素材は Git に入れない。置き場は VAE_TESTDATA_DIR(既定 ~/vae-testdata/stock_v1、リポジトリの外)
- 取得元の URL・素材名・作者・ライセンス・ライセンスの根拠・取得日・ハッシュを台帳(manifest.json)に残す
- ライセンスを確認できない動画は台帳に入れない(add はライセンス名と根拠 URL を必須にする)
- YouTube・TikTok などの無断取得、サイトの規約が禁じる自動取得、ボット対策の回避は行わない。
  Wikimedia Commons は公式 API を使い、User-Agent を名乗り、低い頻度で取得し、429 の Retry-After に従う
- ストック動画の検証は、実際に撮影された動画の品質検証とは同一視しない
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.expanduser(os.environ.get("VAE_TESTDATA_DIR", "~/vae-testdata/stock_v1"))
MANIFEST = os.path.join(ROOT, "manifest.json")
UA = "vae-testdata/1.0 (AI video editing research prototype; low-rate, single-file requests)"
API = "https://commons.wikimedia.org/w/api.php"
MIN_INTERVAL = 12.0                        # API の呼び出しの最小の間隔(秒)
# 取り込んでよいライセンス(NC・ND は使わない)。BY・BY-SA は帰属表示を台帳に残す
ALLOWED = re.compile(r"^(CC0|Public domain|PD|CC BY(?:-SA)? [0-9.]+)", re.I)
_last = [0.0]


def load():
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"note": "Git に入れない。取得元・ライセンス・取得日の台帳", "items": []}


def save(m):
    os.makedirs(ROOT, exist_ok=True)
    with open(MANIFEST + ".tmp", "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1)
    os.replace(MANIFEST + ".tmp", MANIFEST)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,avg_frame_rate,codec_name",
                          "-of", "json", path], capture_output=True, text=True).stdout
    j = json.loads(out)
    v = next((s for s in j["streams"] if s["codec_type"] == "video"), {})
    a = next((s for s in j["streams"] if s["codec_type"] == "audio"), None)
    num, _, den = (v.get("avg_frame_rate") or "0/1").partition("/")
    return {"duration": round(float(j["format"].get("duration") or 0), 2), "width": v.get("width"), "height": v.get("height"),
            "fps": round(float(num) / float(den or 1), 2) if float(den or 1) else None, "vcodec": v.get("codec_name"), "has_audio": a is not None}


def add(path, source_url, title, creator, license_name, license_url, terms_url, tag, note="", attribution=""):
    if not (license_name and license_url and source_url and terms_url):
        raise SystemExit("ライセンス名・ライセンスの根拠 URL・取得元 URL・規約 URL が無い動画は台帳に入れられません")
    m = load()
    h = sha256(path)
    if any(i["sha256"] == h for i in m["items"]):
        print("同じファイルが登録済みです:", path)
        return
    info = probe(path)
    item = {"id": f"s{len(m['items']) + 1:02d}", "file": os.path.relpath(path, ROOT), "title": title, "creator": creator,
            "source_url": source_url, "license": license_name, "license_url": license_url, "terms_url": terms_url,
            "acquired": time.strftime("%Y-%m-%d", time.gmtime()), "sha256": h, "size_mb": round(os.path.getsize(path) / 1e6, 1),
            "tag": tag, "attribution": attribution, "note": note, **info}
    m["items"].append(item)
    save(m)
    print(f"登録: {item['id']} {title} {info['duration']}秒 {info['width']}x{info['height']} {license_name}")


def report():
    m = load()
    L = ["# ストック動画の素材一覧", "", f"置き場: `{ROOT}`(Git の外)。合計 {len(m['items'])} 本、"
         f"{sum(i['duration'] for i in m['items']):.0f} 秒", "",
         "| ID | 区分 | 素材名 | 作者 | 長さ | 大きさ | ライセンス | 取得元 | 取得日 |", "|---|---|---|---|---|---|---|---|---|"]
    for i in m["items"]:
        L.append(f"| {i['id']} | {i['tag']} | {i['title']} | {i['creator']} | {i['duration']}秒 | {i['width']}x{i['height']} | "
                 f"[{i['license']}]({i['license_url']}) | {i['source_url']} | {i['acquired']} |")
    print("\n".join(L))


def _get(url, params=None):
    wait = MIN_INTERVAL - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(2):                                    # 429 のときは指示された秒数だけ待って、1回だけやり直す
        try:
            _last[0] = time.time()
            return urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt == 0:
                ra = int(e.headers.get("retry-after") or 60)
                print(f"429: {ra} 秒待ちます", file=sys.stderr)
                time.sleep(min(ra + 2, 120))
                continue
            raise


def _commons_info(titles=None, search=None, limit=8):
    p = {"action": "query", "maxlag": "5", "prop": "imageinfo|videoinfo", "iiprop": "url|size|mime|extmetadata|mediatype",
         "viprop": "derivatives", "format": "json",
         "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription|Copyrighted|AttributionRequired|Restrictions"}
    if search:
        p.update(generator="search", gsrsearch=f"filetype:video {search}", gsrnamespace="6", gsrlimit=str(limit))
    else:
        p["titles"] = titles
    d = json.load(_get(API, p))
    return list((d.get("query", {}).get("pages") or {}).values())


def _plain(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html or "")).strip()


def commons_search(q, limit=8):
    for pg in _commons_info(search=q, limit=limit):
        ii = pg["imageinfo"][0]
        md = ii.get("extmetadata", {})
        lic = md.get("LicenseShortName", {}).get("value", "?")
        ok = bool(ALLOWED.match(lic))
        print(f"{'OK ' if ok else 'NG '} {pg['title']} | {ii['width']}x{ii['height']} {ii['size'] / 1e6:.1f}MB | {lic} | "
              f"{_plain(md.get('Artist', {}).get('value'))[:30]} | {_plain(md.get('ImageDescription', {}).get('value'))[:60]}")


def commons_get(title, tag, max_mb=120):
    pg = _commons_info(titles=title)[0]
    ii = pg["imageinfo"][0]
    md = ii.get("extmetadata", {})
    lic = md.get("LicenseShortName", {}).get("value", "")
    lurl = md.get("LicenseUrl", {}).get("value", "") or ("https://creativecommons.org/publicdomain/zero/1.0/" if lic.upper().startswith("CC0") else "")
    if not ALLOWED.match(lic):
        raise SystemExit(f"使えないライセンスです: {lic!r}")
    # 配信サーバーの負担を減らすため、トランスコード済みの 1080 以下の版(VP9/WebM)があればそれを使う。無ければ原本
    src_url, variant = ii["url"], f"original {ii['width']}x{ii['height']}"
    ders = [d for d in (pg.get("videoinfo") or [{}])[0].get("derivatives", []) if str(d.get("transcodekey", "")).endswith("p.vp9.webm")
            and max(d.get("width") or 0, d.get("height") or 0) <= 1920]
    if ders:
        d = max(ders, key=lambda d: (d.get("height") or 0) * (d.get("width") or 0))
        src_url, variant = d["src"], f"{d['transcodekey']} ({d.get('width')}x{d.get('height')}; original {ii['width']}x{ii['height']})"
    page = "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(pg["title"].replace(" ", "_"))
    os.makedirs(ROOT, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", pg["title"].split(":", 1)[-1])[:80]
    dst = os.path.join(ROOT, name)
    if src_url.startswith("//"):
        src_url = "https:" + src_url
    with _get(src_url) as r, open(dst + ".part", "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    os.replace(dst + ".part", dst)
    artist = _plain(md.get("Artist", {}).get("value"))
    add(dst, page, pg["title"].split(":", 1)[-1], artist or "(作者不明)", lic, lurl or page, "https://commons.wikimedia.org/wiki/Commons:Reuse_of_content_outside_Wikimedia",
        tag, note=f"[{variant}] " + _plain(md.get("ImageDescription", {}).get("value"))[:140],
        attribution=f"{artist}, {lic}, via Wikimedia Commons" if lic.upper().startswith("CC BY") else "")


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add")
    a.add_argument("path")
    for k in ("source-url", "title", "creator", "license", "license-url", "terms-url", "tag"):
        a.add_argument("--" + k, required=True)
    a.add_argument("--note", default="")
    a.add_argument("--attribution", default="")
    sub.add_parser("report")
    s = sub.add_parser("commons-search")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=8)
    g = sub.add_parser("commons-get")
    g.add_argument("title")
    g.add_argument("--tag", required=True)
    g.add_argument("--max-mb", type=float, default=120)
    x = ap.parse_args(argv)
    if x.cmd == "add":
        add(x.path, x.source_url, x.title, x.creator, x.license, x.license_url, x.terms_url, x.tag, x.note, x.attribution)
    elif x.cmd == "report":
        report()
    elif x.cmd == "commons-search":
        commons_search(x.query, x.limit)
    else:
        commons_get(x.title if x.title.startswith("File:") else "File:" + x.title, x.tag, x.max_mb)


if __name__ == "__main__":
    main()
