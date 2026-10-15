import json
import os

import pytest
import torch
from torch import nn

from heads_util import apply_heads, pick_heads_dir, save_heads

LOADED = {"laya": "0.3.22", "model": "convaiinnovations/laya-multilingual", "revision": "abc"}


class Tiny(nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder = nn.Linear(4, 4)
        self.head = nn.Linear(4, 4)
        self.type_emb = nn.Embedding(3, 4)
        self.scorer = nn.Linear(4, 1)
        self.act_head = nn.Linear(4, 2)
        self.register_buffer("temperature", torch.ones(3))


def trained(tmp_path, keys=("scorer", "type_emb")):
    m = Tiny()
    with torch.no_grad():
        for k in keys:
            for p in getattr(m, k).parameters():
                p.fill_(0.5)
    save_heads(m, str(tmp_path), keys=keys, meta={**LOADED, "createdAt": "2026-10-15"})
    return m


def test_apply_replaces_only_heads(tmp_path):
    trained(tmp_path)
    m = Tiny()
    enc = m.encoder.weight.clone()
    ok, why = apply_heads(m, str(tmp_path), LOADED)
    assert ok, why
    assert torch.all(m.scorer.weight == 0.5) and torch.all(m.type_emb.weight == 0.5)
    assert torch.equal(m.encoder.weight, enc)  # энкодер не тронут


def test_refuses_other_model_or_broken_file(tmp_path):
    trained(tmp_path)
    m = Tiny()
    before = m.scorer.weight.clone()
    ok, why = apply_heads(m, str(tmp_path), {**LOADED, "revision": "zzz"})
    assert not ok and "ревизия" in why
    assert torch.equal(m.scorer.weight, before)
    with open(os.path.join(tmp_path, "heads.safetensors"), "wb") as f:
        f.write(b"garbage")
    ok, why = apply_heads(m, str(tmp_path), LOADED)
    assert not ok and torch.equal(m.scorer.weight, before)


def test_refuses_encoder_keys_and_wrong_shapes(tmp_path):
    from safetensors.torch import save_file

    trained(tmp_path)
    m = Tiny()
    save_file({"encoder.weight": torch.zeros(4, 4)}, os.path.join(tmp_path, "heads.safetensors"))
    ok, why = apply_heads(m, str(tmp_path), LOADED)
    assert not ok and "encoder" in why
    save_file({"scorer.weight": torch.zeros(9, 9)}, os.path.join(tmp_path, "heads.safetensors"))
    ok, why = apply_heads(m, str(tmp_path), LOADED)
    assert not ok


def test_pick_dir_own_over_image_and_disabled(tmp_path):
    data, image = tmp_path / "data", tmp_path / "image"
    for d in (data / "heads", image):
        d.mkdir(parents=True)
        (d / "heads.safetensors").write_bytes(b"x")
    assert pick_heads_dir(str(data), str(image)) == str(data / "heads")
    (data / "heads" / "heads.safetensors").unlink()
    assert pick_heads_dir(str(data), str(image)) == str(image)
    (data / "heads.disabled").write_text("")
    assert pick_heads_dir(str(data), str(image)) is None
