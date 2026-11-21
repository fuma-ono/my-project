"""AC-S1〜S5: 同期・保護範囲・最小表示時間・文の区切り・はみ出し"""
import re

from vae import subtitles as S


def _words(text_times):
    return [dict(s=s, e=e, w=w) for w, s, e in text_times]


def _ident(x):
    return x


VW, FS, OL, ML = 720, 54, 4, 22


def test_ac_s2_protected_spans_dates_times_numbers():
    spans = S.protected_spans("で、2026年11月1日に14時28分です。iPhoneで1.5倍")
    texts = ["で、2026年11月1日に14時28分です。iPhoneで1.5倍"[a:b] for a, b in spans]
    assert "2026年11月1日" in texts and "14時28分" in texts and "iPhone" in texts and "1.5倍" in texts


def test_ac_s2_no_break_inside_numbers():
    m = S.Measurer(81, 6)
    fits = lambda t: m.width(t) <= 1080 - 64
    for t in ["はい、2016年11月1日、14時27分ですと", "で、2026年11月1日に、14時28分ですと"]:
        lines = S.split_lines(t, fits)
        pos = len(lines[0]) if len(lines) > 1 else None
        if pos:
            assert not any(a < pos < b for a, b in S.protected_spans(t)), lines


def test_ac_s4_sentence_split_on_halfwidth_question():
    ws = _words([("これで", 0.0, 0.4), ("いいですか?以上", 0.4, 1.6), ("動画1でした。", 2.0, 3.0)])
    ev = S.build_events(ws, _ident, VW, FS, OL, ML)
    joined = ["".join(e["lines"]) for e in ev]
    assert not any(re.search(r"[?？](?=.)", j) for j in joined), joined


def test_ac_s1_times_follow_words_through_remap():
    ws = _words([("こんにちは。", 1.0, 2.0), ("今日は晴れです。", 5.0, 7.0)])
    remap = lambda x: x - 2.0 if x >= 5.0 else x - 1.0      # 2〜5秒を削除したと仮定
    ev = S.build_events(ws, remap, VW, FS, OL, ML)
    assert abs(ev[0]["s"] - 0.0) < 1e-6
    assert abs(ev[1]["s"] - 3.0) < 1e-6


def test_ac_s3_no_short_events_except_end():
    ws = _words([("はい。", 0.0, 0.2), ("これは動画です。", 0.25, 1.5), ("以上。", 1.55, 1.7), ("終わりです。", 1.75, 3.5)])
    ev = S.build_events(ws, _ident, VW, FS, OL, ML)
    for e in ev[:-1]:
        assert e["e"] - e["s"] >= 0.8 - 1e-6, ev
    assert all(1 <= len(e["lines"]) <= 2 for e in ev)


def test_ac_s5_lines_fit_screen_width():
    long = "今回紹介するのは、2026年に発売されたばかりのワイヤレスイヤホンで、ノイズキャンセリングの性能が前のモデルと比べておよそ1.5倍に向上しています。"
    ws = _words([(long, 0.0, 12.0)])
    for vw, fs in [(720, 54), (1080, 81), (1280, 54)]:
        ml = round(vw * 0.03)
        ev = S.build_events(ws, _ident, vw, fs, max(2, round(fs / 13)), ml)
        m = S.Measurer(fs, max(2, round(fs / 13)))
        for e in ev:
            assert len(e["lines"]) <= 2
            for line in e["lines"]:
                assert m.width(line) <= vw - 2 * ml, (vw, line)


def test_dropped_filler_words_not_shown():
    ws = [dict(s=0.0, e=0.5, w="えーと、", drop=True), dict(s=0.6, e=2.0, w="始めます。")]
    ev = S.build_events(ws, _ident, VW, FS, OL, ML)
    assert "".join(ev[0]["lines"]) == "始めます"


def test_ass_has_all_fields():
    ass = S.to_ass([dict(s=0, e=1, lines=["a", "b"])], 720, 1280, 54, 4, 22, 90)
    line = [l for l in ass.splitlines() if l.startswith("Dialogue:")][0]
    assert line.split(",", 9)[9] == "a\\Nb"
