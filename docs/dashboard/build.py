"""Embed local font files into docs/dashboard/template.html and write dashboard.html.

Reuses the display/body/mono fonts already available in this environment's
canvas-design skill assets. If that path isn't available in a future
environment, swap FONT_DIR to wherever the same fonts (or equivalents) live.
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
    out = HERE / "dashboard.html"
    out.write_text(tmpl, encoding="utf-8")
    print(f"wrote {out} ({len(tmpl)} bytes)")


if __name__ == "__main__":
    main()
