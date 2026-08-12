"""Embed local font files into template.html and write audit.html.
Same pattern as docs/dashboard/build.py / docs/ai-company-os/hub/build.py.
"""
import base64
import pathlib

FONT_DIR = pathlib.Path("/mnt/skills/examples/canvas-design/canvas-fonts")
HERE = pathlib.Path(__file__).parent

FONTS = {
    "__GLOOCK__": "Gloock-Regular.ttf",
    "__WORKSANS_REG__": "WorkSans-Regular.ttf",
    "__WORKSANS_BOLD__": "WorkSans-Bold.ttf",
    "__PLEXMONO_REG__": "IBMPlexMono-Regular.ttf",
    "__PLEXMONO_BOLD__": "IBMPlexMono-Bold.ttf",
}


def main() -> None:
    tmpl = (HERE / "template.html").read_text(encoding="utf-8")
    for placeholder, fname in FONTS.items():
        b64 = base64.b64encode((FONT_DIR / fname).read_bytes()).decode()
        tmpl = tmpl.replace(placeholder, b64)
    out = HERE / "audit.html"
    out.write_text(tmpl, encoding="utf-8")
    print(f"wrote {out} ({len(tmpl)} bytes)")


if __name__ == "__main__":
    main()
