"""月テーマカレンダー(恋愛ジャンルnote)。

オーナーが変更したい場合はこの辞書を直接編集する。Routineは実行時の月から
このテーマを引いて記事を生成する。
"""

MONTHLY_THEMES = {
    1: "片思い",
    2: "失恋",
    3: "復縁",
    4: "同棲",
    5: "恋愛心理",
    6: "嫉妬・不安",
    7: "遠距離",
    8: "別れ",
    9: "新しい恋",
    10: "価値観",
    11: "恋愛依存",
    12: "総まとめ",
}


def theme_for_month(month: int) -> str:
    """1〜12の月番号からその月のテーマ名を返す。"""
    if month not in MONTHLY_THEMES:
        raise ValueError(f"invalid month: {month}")
    return MONTHLY_THEMES[month]
