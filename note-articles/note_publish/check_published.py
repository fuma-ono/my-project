"""Auto-detect note.com publish status via the account's public RSS feed.

Why this exists
----------------
Claude Code cloud sessions run in a network-restricted container that
cannot reach note.com at all (confirmed by repeated testing — see
note_auth.py's docstring). So the AI managing this repo can never check
note.com directly from a normal session, and previously relied on the
owner typing "N を投稿した" in chat. That's easy to forget, and a
queue-page checkbox that *looked* like it recorded the fact actually only
wrote to the browser's localStorage and never reached this repo.

This script closes that gap by running somewhere that DOES have real
internet access: a GitHub Actions runner (see
.github/workflows/note-publish-check.yml), on a schedule. It reads
note.com's public RSS feed for the account (no login needed — this is
publicly published content), matches published titles against this
repo's draft backlog, and if a draft's exact title now appears on
note.com, flips it to "published" across all the tracking files and
commits the change directly. No chat message required.

What it does NOT do
--------------------
- It does not post anything. Posting still requires the owner (or the
  Playwright automation in publish.py, run on the owner's own machine).
- It does not touch the public queue-page artifact (note-queue.html) —
  that's published via Claude's Artifact tool, which only an interactive
  Claude Code session can call. The underlying source files this script
  updates (generation-log.json, README.md, the experiment JSONs, and the
  queue page's template.html) are corrected immediately; the *rendered*
  public queue page catches up the next time a Claude session rebuilds
  and republishes it (e.g. the next weekly review or note routine).

Usage: python3 check_published.py [--dry-run]
Exit code is always 0 on a normal "nothing new" run; non-zero only on a
genuine fetch/parse failure, so CI surfaces real problems without going
red every time there's simply nothing to detect yet.
"""
from __future__ import annotations

import argparse
import difflib
import email.utils
import json
import re
import sys
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NOTE_USERNAME = "unique_condor276"
RSS_URL = f"https://note.com/{NOTE_USERNAME}/rss"

GENERATION_LOG = ROOT / "note-articles" / "generation-log.json"
EXPERIMENTS_DIR = ROOT / "docs" / "company-os" / "experiments"
README = ROOT / "note-articles" / "README.md"
QUEUE_TEMPLATE = ROOT / "note-articles" / "queue-page" / "template.html"

TITLE_MATCH_THRESHOLD = 0.92  # difflib ratio; exact match tried first


def fetch_rss_titles() -> list[tuple[str, str | None, str | None]]:
    """Returns [(title, link, published_date_iso_or_None), ...] from the public RSS feed."""
    req = urllib.request.Request(
        RSS_URL,
        headers={"User-Agent": "Mozilla/5.0 (compatible; note-publish-check/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    root = ET.fromstring(raw)
    items = []
    for item in root.iter("item"):
        title_el = item.find("title")
        link_el = item.find("link")
        pubdate_el = item.find("pubDate")
        title = (title_el.text or "").strip() if title_el is not None else ""
        link = (link_el.text or "").strip() if link_el is not None else None
        pub_iso = None
        if pubdate_el is not None and pubdate_el.text:
            try:
                pub_iso = email.utils.parsedate_to_datetime(pubdate_el.text).date().isoformat()
            except (TypeError, ValueError):
                pub_iso = None
        if title:
            items.append((title, link, pub_iso))
    return items


def normalize(s: str) -> str:
    return re.sub(r"\s+", "", s.strip())


def best_match(draft_title: str, rss_items: list[tuple[str, str | None, str | None]]):
    norm_draft = normalize(draft_title)
    for title, link, pub_iso in rss_items:
        if normalize(title) == norm_draft:
            return (title, link, pub_iso, 1.0)
    best = None
    for title, link, pub_iso in rss_items:
        ratio = difflib.SequenceMatcher(None, norm_draft, normalize(title)).ratio()
        if ratio >= TITLE_MATCH_THRESHOLD and (best is None or ratio > best[3]):
            best = (title, link, pub_iso, ratio)
    return best


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def find_experiment_path(article_number: str) -> Path | None:
    matches = list(EXPERIMENTS_DIR.glob(f"note-{article_number}-*.json"))
    return matches[0] if matches else None


def update_readme(article_number: str, title: str, pillar: str, theme_backlog_id, note_suffix: str) -> bool:
    text = README.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"^- \[ \] {re.escape(article_number)} - {re.escape(title)}\([^\n]*\)$",
        re.MULTILINE,
    )
    if not pattern.search(text):
        return False
    backlog_part = f"、バックログ#{theme_backlog_id}" if theme_backlog_id is not None else ""
    replacement = f"- [x] {article_number} - {title}(**公開済み・柱{pillar}**{backlog_part}。{note_suffix})"
    text = pattern.sub(replacement, text, count=1)
    README.write_text(text, encoding="utf-8")
    return True


def remove_queue_card(article_number: str) -> bool:
    if not QUEUE_TEMPLATE.exists():
        return False
    text = QUEUE_TEMPLATE.read_text(encoding="utf-8")
    pattern = re.compile(
        rf'\n  <div class="article" id="art-{re.escape(article_number)}">.*?'
        rf'data-target="art-{re.escape(article_number)}"> 投稿した</label>\n  </div>\n',
        re.DOTALL,
    )
    new_text, n = pattern.subn("\n", text, count=1)
    if n == 0:
        return False
    QUEUE_TEMPLATE.write_text(new_text, encoding="utf-8")
    return True


def refresh_queue_counts() -> None:
    if not QUEUE_TEMPLATE.exists():
        return
    log = load_json(GENERATION_LOG)
    published = sum(1 for e in log["entries"] if e["status"] == "published")
    draft = sum(1 for e in log["entries"] if e["status"] == "draft")
    text = QUEUE_TEMPLATE.read_text(encoding="utf-8")
    text = re.sub(r"\d+本公開済み", f"{published}本公開済み", text)
    text = re.sub(r"\d+本待ち", f"{draft}本待ち", text)
    QUEUE_TEMPLATE.write_text(text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        rss_items = fetch_rss_titles()
    except (urllib.error.URLError, ET.ParseError, TimeoutError) as e:
        print(f"ERROR: failed to fetch/parse RSS feed at {RSS_URL}: {e}", file=sys.stderr)
        return 1

    if not rss_items:
        print("WARNING: RSS feed returned zero items — treating as a fetch problem, not 'nothing published'.", file=sys.stderr)
        return 1

    log = load_json(GENERATION_LOG)
    drafts = [e for e in log["entries"] if e["status"] == "draft"]
    if not drafts:
        print("No draft entries to check.")
        return 0

    today = date.today().isoformat()
    changed_any = False

    for entry in drafts:
        exp_path = find_experiment_path(entry["article_number"])
        if exp_path is None:
            print(f"WARNING: no experiment file found for article {entry['article_number']}, skipping.")
            continue
        exp = load_json(exp_path)
        title = exp["title"]

        match = best_match(title, rss_items)
        if match is None:
            continue

        matched_title, link, pub_iso, ratio = match
        published_date = pub_iso or today
        print(f"MATCH: article {entry['article_number']} \"{title}\" -> note.com \"{matched_title}\" (ratio={ratio:.2f}, date={published_date})")

        if args.dry_run:
            continue

        entry["status"] = "published"
        entry["published_auto_detected_at"] = today

        exp["status"] = "published"
        exp["published_at"] = published_date
        if link:
            exp["note_url"] = link
        exp["publish_confirmation_note"] = (
            f"{today}、note.com公開RSSフィードとのタイトル一致により自動検知(GitHub Actions定期実行)。"
        )

        save_json(exp_path, exp)
        note_suffix = f"{published_date} RSS自動検知"
        update_readme(entry["article_number"], title, entry["pillar"], entry.get("theme_backlog_id"), note_suffix)
        remove_queue_card(entry["article_number"])
        changed_any = True

    if changed_any and not args.dry_run:
        save_json(GENERATION_LOG, log)
        refresh_queue_counts()
        print("Updated tracking files for newly-detected publications.")
    elif not changed_any:
        print("No new publications detected this run.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
