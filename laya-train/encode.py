"""Кодирование строк обучающего набора Dublyarr ровно так, как Laya кодирует боевые вопросы."""

import hashlib
from typing import Dict, List, Sequence

import numpy as np
import torch
from laya.common import QTYPES, collate_items, temp_bucket


def _internal(agent, question: Dict) -> Dict:
    agent._check_question("q", question)
    return {"q": agent._to_internal(question)}


def encode_rows(agent, rows: Sequence[Dict]) -> List[Dict]:
    """Строка → item Laya (ids, markers, qtype) + индекс правильного варианта."""
    out = []
    for row in rows:
        item = agent._encode_state(row["state"], ["q"], _internal(agent, row["question"]))[0]
        item["y"] = target_index(row)
        out.append(item)
    return out


def target_index(row: Dict) -> int:
    """«да/нет» — варианты (нет, да); выбор — порядок ключей criteria."""
    q = row["question"]
    if q["type"] == "noul":
        return 1 if row["target"] is True else 0
    return list(q["criteria"].keys()).index(row["target"])


def batch(agent, items: Sequence[Dict]) -> Dict[str, torch.Tensor]:
    b = collate_items([[it] for it in items], agent.tok.pad_token_id)
    return {k: v.to(agent.device) for k, v in b.items() if isinstance(v, torch.Tensor)}


def forward(agent, items: Sequence[Dict], grad: bool = False) -> torch.Tensor:
    """Логиты вариантов (по строке на item), без температуры; энкодер всегда без градиента."""
    b = batch(agent, items)
    ctx = torch.enable_grad() if grad else torch.no_grad()
    with ctx:
        logits, _ = agent.model(b["input_ids"], b["attention_mask"], b["marker_pos"], b["marker_mask"], b["qtype"], detach_encoder=True)
    return logits


def logits_of(agent, items: Sequence[Dict], size: int = 16) -> List[np.ndarray]:
    agent.model.eval()
    out = []
    for i in range(0, len(items), size):
        part = items[i : i + size]
        lg = forward(agent, part).float().cpu().numpy()
        out += [lg[j, : len(it["markers"])] for j, it in enumerate(part)]
    return out


def probs(agent, row: Dict, logits: np.ndarray) -> np.ndarray:
    """Вероятности вариантов с температурой — как Agent._decode_answers."""
    qt = QTYPES[row["question"]["type"]]
    k = len(logits)
    t = agent.temperature_by_options.get(temp_bucket(qt, k), agent.temperature[qt])
    z = logits / t
    p = np.exp(z - z.max())
    return p / p.sum()


def split_by_group(rows: Sequence[Dict], seed: int = 1):
    """70 / 10 / 20 по сериалам: обучение / калибровка / проверка — без утечки сериала между частями."""
    train, cal, test = [], [], []
    for r in rows:
        h = int(hashlib.sha1(f"{seed}|{r['group']}".encode()).hexdigest(), 16) % 100
        (test if h < 20 else cal if h < 30 else train).append(r)
    return train, cal, test
