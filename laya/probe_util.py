"""Надстройка над Laya (2.6): логистическая регрессия поверх ответа базовой модели и эмбеддинга вопроса тем же энкодером.

Сама Laya не меняется. Веса учатся на Mac (laya-train/probe.py) по ответам пользователя и лежат в laya/probe/<задача>.json
(свои — ${LAYA_DIR}/probe, важнее образа). Файл помнит модель, ревизию и версию laya: другое — не применяется.
Выключателя нет (2.8): есть веса — применяются всегда.
"""

import json
import math
import os
from typing import Dict, Optional

FORMAT = 1  # формат текста вопроса для эмбеддинга (text_of): другой — веса не годятся
DIR = "probe"


def text_of(state, instructions: str) -> str:
    """Вопрос как текст для эмбеддинга: строки «ключ: значение» состояния и формулировка. Одинаково в обучении и в бою."""
    lines = [f"{k}: {v}" for k, v in state.items()] if isinstance(state, dict) else [str(state)]
    return "\n".join(lines + [instructions or ""])


def _logit(p: float) -> float:
    q = min(1 - 1e-4, max(1e-4, p))
    return math.log(q / (1 - q))


def features(p_base: float, emb) -> list:
    """[logit(p Laya), эмбеддинг единичной длины]."""
    norm = math.sqrt(sum(float(v) * float(v) for v in emb)) or 1.0
    return [_logit(p_base)] + [float(v) / norm for v in emb]


def apply(probe: Dict, p_base: float, emb) -> float:
    x = features(p_base, emb)
    z = probe["b"] + sum(w * (v - m) / s for w, v, m, s in zip(probe["w"], x, probe["mu"], probe["sd"]))
    return 1 / (1 + math.exp(-max(-50.0, min(50.0, z))))


def save_probe(path: str, w, b: float, mu, sd, meta: Dict) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    body = {**meta, "format": FORMAT, "w": [float(v) for v in w], "b": float(b), "mu": [float(v) for v in mu], "sd": [float(v) for v in sd]}
    with open(path, "w") as f:
        json.dump(body, f, ensure_ascii=False)


def pick_dir(laya_dir: str, image_dir: str) -> Optional[str]:
    """Свои веса (${LAYA_DIR}/probe) важнее, чем в образе."""
    for d in (os.path.join(laya_dir, DIR), image_dir):
        if os.path.isdir(d) and any(n.endswith(".json") for n in os.listdir(d)):
            return d
    return None


def load_probes(d: Optional[str], loaded: Dict, dim: int) -> Dict[str, Dict]:
    """Надстройки по задачам ({задача: веса}); не та модель, формат или размер — пропускаются (с причиной в "skipped")."""
    out: Dict[str, Dict] = {}
    if not d:
        return out
    for name in sorted(os.listdir(d)):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(d, name)) as f:
                p = json.load(f)
        except Exception as e:  # noqa: BLE001
            out.setdefault("skipped", {})[name] = f"не читается: {e}"
            continue
        why = next((f"{k}: {p.get(k)} ≠ {loaded.get(k)}" for k in ("model", "revision", "laya") if p.get(k) != loaded.get(k)), None)
        if not why and p.get("format") != FORMAT:
            why = f"формат {p.get('format')} ≠ {FORMAT}"
        if not why and not (len(p.get("w", [])) == len(p.get("mu", [])) == len(p.get("sd", [])) == dim + 1):
            why = "размер не тот"
        if why:
            out.setdefault("skipped", {})[name] = why
            continue
        out[p.get("task") or name[:-5]] = p
    return out
