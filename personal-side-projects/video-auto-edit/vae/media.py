"""入力動画の情報取得と検証(AC-V1, AC-V6)"""
import json
import os
from dataclasses import asdict, dataclass
from fractions import Fraction

from . import errors, proc

ALLOWED_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".webm"}
MIN_SECONDS = 1.0


@dataclass
class MediaInfo:
    path: str
    duration: float
    width: int            # 表示上の幅(回転を反映)
    height: int
    coded_width: int
    coded_height: int
    rotation: int
    fps_num: int
    fps_den: int
    vfr: bool
    vcodec: str
    acodec: str | None
    sample_rate: int | None
    channels: int

    @property
    def fps(self) -> Fraction:
        return Fraction(self.fps_num, self.fps_den)

    def to_dict(self):
        d = asdict(self)
        d["fps"] = f"{self.fps_num}/{self.fps_den}"
        return d


def probe(path: str) -> MediaInfo:
    try:
        out = proc.run_text(["ffprobe", "-v", "error", "-show_entries",
                             "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,"
                             "sample_rate,channels:stream_side_data=rotation:stream_tags=rotate",
                             "-of", "json", path])
        j = json.loads(out)
    except (proc.ProcError, json.JSONDecodeError, OSError) as e:
        raise errors.broken() from e
    streams = j.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if v is None or not v.get("width"):
        raise errors.broken("映像が見つかりません。")
    try:
        dur = float(j.get("format", {}).get("duration") or 0)
    except ValueError:
        dur = 0.0
    fps = _fps(v)
    rot = 0
    for d in v.get("side_data_list", []) or []:
        if "rotation" in d:
            rot = int(d["rotation"])
    if not rot and (v.get("tags") or {}).get("rotate"):
        rot = int(v["tags"]["rotate"])
    w, h = int(v["width"]), int(v["height"])
    dw, dh = (h, w) if abs(rot) % 180 == 90 else (w, h)
    return MediaInfo(path=path, duration=dur, width=dw, height=dh, coded_width=w, coded_height=h, rotation=rot,
                     fps_num=fps.numerator, fps_den=fps.denominator,
                     vfr=(v.get("avg_frame_rate") != v.get("r_frame_rate")),
                     vcodec=v.get("codec_name", "?"), acodec=a.get("codec_name") if a else None,
                     sample_rate=int(a["sample_rate"]) if a and a.get("sample_rate") else None,
                     channels=int(a.get("channels") or 0) if a else 0)


def _fps(v) -> Fraction:
    for key in ("avg_frame_rate", "r_frame_rate"):
        try:
            f = Fraction(v.get(key) or "0/1")
            if 1 <= f <= 240:
                # 29.97 などは分母1001のまま。極端な分母は30fps近似に丸める
                return f if f.denominator <= 1001 else Fraction(round(float(f) * 1000), 1000)
        except (ValueError, ZeroDivisionError):
            continue
    return Fraction(30, 1)


def validate(path: str, max_seconds: float | None = None, plan_name: str = "無料") -> MediaInfo:
    """処理前の検証。問題があれば VAEError(原因と対処つき)"""
    ext = os.path.splitext(path)[1].lower()
    if ext not in ALLOWED_EXT:
        raise errors.unsupported(f"(拡張子 {ext or 'なし'})")
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        raise errors.broken("ファイルが空です。")
    info = probe(path)
    if info.acodec is None:
        raise errors.no_audio()
    if info.duration < MIN_SECONDS:
        raise errors.too_short(info.duration)
    if max_seconds is not None and info.duration > max_seconds + 0.05:
        raise errors.over_plan_limit(info.duration, max_seconds, plan_name)
    return info


def combine(paths, out, infos=None, timeout=None):
    """複数の動画を1本につなぐ(STANDARD / PRO の複数動画。料金仕様 v1)。
    大きさと fps は1本目に合わせる(はみ出す動画は縮小し、余白は黒で埋める。拡大はしない)。
    音声は 48kHz ステレオにそろえる。元の動画は読むだけ。戻り値: 結合後の MediaInfo"""
    infos = infos or [probe(p) for p in paths]
    first = infos[0]
    w, h = first.width - first.width % 2, first.height - first.height % 2
    fr = f"{first.fps_num}/{first.fps_den}"
    parts, ins = [], []
    for i, p in enumerate(paths):
        ins += ["-i", os.path.abspath(p)]
        parts.append(f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,"
                     f"setsar=1,fps={fr},format=yuv420p[v{i}];"
                     f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}]")
    n = len(paths)
    graph = ";".join(parts) + ";" + "".join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[v][a]"
    total = sum(x.duration for x in infos)
    tmp = out + ".part.mp4"
    try:
        proc.run(["ffmpeg", "-y", "-v", "error", *ins, "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
                  "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k",
                  "-movflags", "+faststart", tmp], timeout=timeout or proc.timeout_for(total, factor=6.0), mem_limit_mb=3000)
        os.replace(tmp, out)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return probe(out)
