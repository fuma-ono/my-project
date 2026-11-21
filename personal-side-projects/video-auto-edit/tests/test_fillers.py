"""AC-A3(表記ゆれ・文脈・記録)、AC-A4(必要な発話を削除しない)"""
from vae import fillers as F


def W(*items):
    return [dict(w=w, s=s, e=e, **({"p": p} if p is not None else {})) for w, s, e, p in items]


def test_canon_variants():
    for t in ["まぁ、", "まー", "まあ"]:
        assert F.canon(t)[0] == "ま"
    for t in ["えーっと、", "ええと", "えっと"]:
        assert F.canon(t)[0] == "えと"
    assert F.classify(*F.canon("あのー")) == "context"
    assert F.classify(*F.canon("ありがとう")) is None


def test_ac_a3_variant_maa_is_detected():
    drop, c = F.detect(W(("まぁ、", 1.0, 1.4, 0.9), ("途中で", 1.5, 1.9, 0.9)))
    assert c[0]["decision"] == "削除" and drop == {0}


def test_ac_a4_umaku_fragment_is_kept():
    # 「う」「ま」「く」と1文字ずつに分かれた「うまく」を削除しない
    drop, c = F.detect(W(("う", 1.0, 1.05, 0.9), ("ま", 1.05, 1.1, 0.9), ("く", 1.1, 1.2, 0.9), ("編集", 1.2, 1.5, 0.9)))
    assert drop == set()
    assert all(x["decision"] == "残す" for x in c)


def test_ac_a3_demonstrative_ano_is_kept():
    drop, c = F.detect(W(("あの", 1.0, 1.15, 0.9), ("動画", 1.15, 1.5, 0.9)))
    assert drop == set() and c[0]["decision"] == "残す" and "指示語" in c[0]["reason"]


def test_ac_a3_filler_ano_with_pause_is_dropped():
    drop, c = F.detect(W(("あの", 1.0, 1.2, 0.9), ("動画", 1.6, 2.0, 0.9)))
    assert drop == {0} and "間" in c[0]["reason"]


def test_low_confidence_context_filler_is_kept():
    drop, c = F.detect(W(("あの、", 1.0, 1.2, 0.2), ("動画", 1.6, 2.0, 0.9)))
    assert drop == set() and "確信度" in c[0]["reason"]


def test_cut_range_does_not_overlap_neighbors():
    # 単語の時刻が重なっていても、削除範囲は前後の単語に食い込まない
    drop, c = F.detect(W(("はい", 0.0, 1.05, 0.9), ("えーと、", 1.0, 1.8, 0.9), ("始めます", 1.75, 2.5, 0.9)))
    x = c[0]
    assert x["decision"] == "削除"
    assert x["cut_s"] >= 1.05 and x["cut_e"] <= 1.75


def test_every_candidate_has_reason():
    _, c = F.detect(W(("えー、", 0, 0.3, 0.9), ("あの", 0.4, 0.5, 0.9), ("人", 0.5, 0.7, 0.9)))
    assert c and all(x["reason"] and x["decision"] in ("削除", "残す") for x in c)
