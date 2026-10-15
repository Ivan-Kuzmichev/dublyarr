"""Дообученные головы Laya: сохранение (laya-train) и подмена весов после laya.load (laya-serve).

В файле — только веса голов (scorer, type_emb, head, temperature); энкодер берётся из базовой модели.
meta.json фиксирует, для какой модели и версии библиотеки они обучены: другое — не грузим.
"""

import json
import os
from typing import Dict, Iterable, Optional, Tuple

HEAD_KEYS = ("scorer", "type_emb", "head", "temperature")
WEIGHTS = "heads.safetensors"
META = "meta.json"
CALIBRATION = "calibration.json"
DISABLED = "heads.disabled"


def _is_head(key: str, keys: Iterable[str] = HEAD_KEYS) -> bool:
    return any(key == k or key.startswith(k + ".") for k in keys)


def save_heads(model, out_dir: str, keys: Iterable[str], meta: Dict) -> str:
    """Веса выбранных голов (fp16, температура — fp32) и meta.json."""
    import torch
    from safetensors.torch import save_file

    keys = tuple(keys)
    os.makedirs(out_dir, exist_ok=True)
    state = {k: (v.detach().cpu().half() if v.is_floating_point() and k != "temperature" else v.detach().cpu()).contiguous()
             for k, v in model.state_dict().items() if _is_head(k, keys)}
    save_file(state, os.path.join(out_dir, WEIGHTS))
    with open(os.path.join(out_dir, META), "w") as f:
        json.dump({**meta, "keys": list(keys)}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return os.path.join(out_dir, WEIGHTS)


def pick_heads_dir(data_dir: str, image_dir: str) -> Optional[str]:
    """Свои головы (${DATA_DIR}/laya/heads) важнее, чем в образе; файл heads.disabled — базовая модель."""
    if os.path.exists(os.path.join(data_dir, DISABLED)):
        return None
    for d in (os.path.join(data_dir, "heads"), image_dir):
        if os.path.exists(os.path.join(d, WEIGHTS)):
            return d
    return None


def apply_heads(model, heads_dir: str, loaded: Dict) -> Tuple[bool, str]:
    """Подменить веса голов. Не та модель, битый файл, лишние ключи или другие размеры — модель не трогается."""
    try:
        with open(os.path.join(heads_dir, META)) as f:
            meta = json.load(f)
    except Exception as e:  # noqa: BLE001
        return False, f"meta.json не читается: {e}"
    for field, label in (("model", "модель"), ("revision", "ревизия"), ("laya", "версия laya")):
        if meta.get(field) != loaded.get(field):
            return False, f"{label} не совпадает: головы для {meta.get(field)}, загружена {loaded.get(field)}"
    try:
        from safetensors.torch import load_file

        weights = load_file(os.path.join(heads_dir, WEIGHTS))
    except Exception as e:  # noqa: BLE001
        return False, f"файл голов не читается: {e}"
    own = model.state_dict()
    foreign = [k for k in weights if not _is_head(k)]
    if foreign:
        return False, f"в файле не только головы: {', '.join(foreign[:3])}"
    for k, v in weights.items():
        if k not in own or own[k].shape != v.shape:
            return False, f"не подходит размер или ключ: {k}"
    with __import__("torch").no_grad():
        for k, v in weights.items():
            own[k].copy_(v.to(own[k].dtype))
    return True, f"головы {meta.get('createdAt', '')}: {len(weights)} тензоров"
