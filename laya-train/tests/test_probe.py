import math
import os

from probe_util import apply, features, load_probes, pick_dir, save_probe, text_of

LOADED = {"laya": "0.3.22", "model": "convaiinnovations/laya-multilingual", "revision": "abc"}


def saved(d, dim=3, **meta):
    w = [1.0] + [0.0] * dim  # только logit(p Laya): надстройка с такими весами возвращает ответ Laya как есть
    save_probe(os.path.join(d, "match.json"), w, 0.0, [0.0] * (dim + 1), [1.0] * (dim + 1), {**LOADED, "task": "match", "createdAt": "2026-10-16", **meta})


def test_text_of_state_lines_then_question():
    st = {"сериал": "Офис (The Office), сериал, 2005–2013", "раздача": "The Office S03E05"}
    assert text_of(st, "Эта раздача — тот же сериал?") == "сериал: Офис (The Office), сериал, 2005–2013\nраздача: The Office S03E05\nЭта раздача — тот же сериал?"


def test_apply_identity_weights_return_laya_probability(tmp_path):
    saved(str(tmp_path))
    p = load_probes(str(tmp_path), LOADED, 3)["match"]
    assert math.isclose(apply(p, 0.7, [0.1, 0.2, 0.3]), 0.7, rel_tol=1e-6)


def test_apply_uses_embedding_weights_and_standardization(tmp_path):
    save_probe(str(tmp_path / "match.json"), [0.0, 2.0, 0.0], -1.0, [0.0, 0.5, 0.0], [1.0, 0.25, 1.0], {**LOADED, "task": "match"})
    p = load_probes(str(tmp_path), LOADED, 2)["match"]
    x = features(0.5, [3.0, 4.0])  # эмбеддинг нормируется: [0.6, 0.8]
    z = -1.0 + 2.0 * (x[1] - 0.5) / 0.25
    assert math.isclose(apply(p, 0.5, [3.0, 4.0]), 1 / (1 + math.exp(-z)), rel_tol=1e-9)


def test_incompatible_probe_is_skipped_with_reason(tmp_path):
    saved(str(tmp_path), revision="other")
    out = load_probes(str(tmp_path), LOADED, 3)
    assert "match" not in out
    assert "revision" in out["skipped"]["match.json"]
    saved(str(tmp_path))
    assert "match" not in load_probes(str(tmp_path), LOADED, 4)  # другой размер эмбеддинга


def test_pick_dir_own_beats_image_and_disabled_turns_off(tmp_path):
    laya_dir, image = tmp_path / "data", tmp_path / "image"
    os.makedirs(laya_dir)
    saved(str(image))
    assert pick_dir(str(laya_dir), str(image)) == str(image)
    saved(str(laya_dir / "probe"))
    assert pick_dir(str(laya_dir), str(image)) == str(laya_dir / "probe")
    (laya_dir / "heads.disabled").write_text("")
    assert pick_dir(str(laya_dir), str(image)) is None
