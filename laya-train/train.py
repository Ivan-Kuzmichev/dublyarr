"""Дообучение голов Laya на наборе Dublyarr (GET /api/v1/laya/dataset) — на Mac (MPS).

  python train.py --data data/dataset.json --out ../laya/heads [--keys scorer,type_emb] [--epochs 8]

Энкодер заморожен, учатся только головы. Разбиение по сериалам 70/10/20 (обучение / калибровка / проверка).
Код выхода: 0 — по каждой проверенной задаче не хуже базовой и хотя бы одна заметно лучше (файлы записаны), 2 — иначе (ничего не записано).
"""

import argparse
import datetime
import json
import math
import os
import random
import sys
from collections import defaultdict

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "laya"))

from encode import encode_rows, forward, logits_of, probs, split_by_group  # noqa: E402
from heads_util import CALIBRATION, save_heads  # noqa: E402
from laya.common import QTYPES  # noqa: E402

MODEL = "convaiinnovations/laya-multilingual"
THRESHOLD = 0.85
# порог 0,85 = автоматика выгодна, если 0,15 × цена ошибки < цены вопроса: уверенная ошибка ≈ 6,7 вопроса
WRONG_COST = (1 - THRESHOLD) ** -1
MIN_CHECKED = 50


def load_rows(path):
    with open(path) as f:
        text = f.read().strip()
    if text.startswith("{"):
        return json.loads(text)["rows"]
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def metrics(agent, rows, items):
    """По задачам: log-loss, точность, «решает сама» (уверенность ≥ 0,85) и «сама и верно»."""
    out = defaultdict(lambda: {"n": 0, "loss": 0.0, "right": 0, "auto": 0, "auto_right": 0})
    for row, item, lg in zip(rows, items, logits_of(agent, items)):
        p = probs(agent, row, lg)
        y = item["y"]
        m = out[row["task"]]
        m["n"] += 1
        m["loss"] += -math.log(max(1e-9, float(p[y])))
        m["right"] += int(int(p.argmax()) == y)
        if p.max() >= THRESHOLD:
            m["auto"] += 1
            m["auto_right"] += int(int(p.argmax()) == y)
    res = {t: {"n": m["n"], "logloss": m["loss"] / m["n"], "accuracy": m["right"] / m["n"], "auto": m["auto"] / m["n"],
               "auto_correct": m["auto_right"] / m["n"], "auto_wrong": (m["auto"] - m["auto_right"]) / m["n"]} for t, m in out.items()}
    for m in res.values():
        m["cost"] = (1 - m["auto"]) + WRONG_COST * m["auto_wrong"]  # вопросы + уверенные ошибки, меньше — лучше
    return res


def train(agent, keys, train_items, cal_items, epochs, lr, batch, seed, log, l2sp=0.0, distill=0.0):
    for p in agent.model.parameters():
        p.requires_grad_(False)
    params = [p for k in keys for p in getattr(agent.model, k).parameters()]
    for p in params:
        p.requires_grad_(True)
    start = [p.detach().clone() for p in params]  # L2-SP: не уходить далеко от исходных голов
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=0.01)
    rnd = random.Random(seed)

    if distill:
        # ответы базовой модели — чтобы выбор (студия) не терял уверенности из-за общего scorer
        base_lg = logits_of(agent, train_items)
        for it, lg in zip(train_items, base_lg):
            it["base"] = lg

    def loss_of(items, with_distill=False):
        lg = forward(agent, items, grad=True).float()
        y = torch.tensor([it["y"] for it in items], device=lg.device)
        loss = F.cross_entropy(lg, y)
        if with_distill and distill:
            kl = []
            for j, it in enumerate(items):
                if it.get("keep"):
                    k = len(it["markers"])
                    p0 = F.softmax(torch.tensor(it["base"], device=lg.device), dim=-1)
                    kl.append(F.kl_div(F.log_softmax(lg[j, :k], dim=-1), p0, reduction="sum"))
            if kl:
                loss = loss + distill * torch.stack(kl).mean()
        return loss

    def cal_loss():
        agent.model.eval()
        with torch.no_grad():
            total = sum(float(loss_of(cal_items[i:i + batch]).detach()) * len(cal_items[i:i + batch]) for i in range(0, len(cal_items), batch))
        return total / max(1, len(cal_items))

    best = (cal_loss(), {k: v.detach().clone() for k, v in agent.model.state_dict().items() if any(k.startswith(x) for x in keys)})
    log(f"калибровочная часть до обучения: loss {best[0]:.4f}")
    worse = 0
    for epoch in range(epochs):
        # режим обучения (dropout) — только у того, что учим; энкодер и замороженные головы — как в бою
        agent.model.eval()
        for k in keys:
            getattr(agent.model, k).train()
        order = list(range(len(train_items)))
        rnd.shuffle(order)
        total = 0.0
        for i in range(0, len(order), batch):
            part = [train_items[j] for j in order[i:i + batch]]
            opt.zero_grad()
            loss = loss_of(part, with_distill=True)
            if l2sp:
                loss = loss + l2sp * sum(((p - p0) ** 2).sum() for p, p0 in zip(params, start))
            loss.backward()
            opt.step()
            total += float(loss.detach()) * len(part)
        cl = cal_loss()
        log(f"эпоха {epoch + 1}: обучение {total / len(order):.4f} · калибровочная {cl:.4f}")
        if cl < best[0] - 1e-4:
            best, worse = (cl, {k: v.detach().clone() for k, v in agent.model.state_dict().items() if any(k.startswith(x) for x in keys)}), 0
        else:
            worse += 1
            if worse >= 2:
                break
    own = agent.model.state_dict()
    with torch.no_grad():
        for k, v in best[1].items():
            own[k].copy_(v)
    agent.model.eval()


def calibrate(agent, rows, items, types=("noul",)):
    """Температуры по калибровочной части — чтобы «85 %» значило 85 %. Только для выбранных типов вопросов:
    у остальных (мало примеров) остаются базовые."""
    import copy

    keep_t, keep_b = copy.deepcopy(agent.temperature), copy.deepcopy(agent.temperature_by_options)
    records = [(QTYPES[r["question"]["type"]], lg.astype(np.float64), it["y"], len(lg))
               for r, it, lg in zip(rows, items, logits_of(agent, items)) if r["question"]["type"] in types]
    if not records:
        return None
    agent.fit_temperatures(records)
    qts = {QTYPES[t] for t in types}
    agent.temperature = [agent.temperature[i] if i in qts else keep_t[i] for i in range(len(keep_t))]
    # ключи корзин — «noul:2», «choice:3-5»
    agent.temperature_by_options = {**{k: v for k, v in keep_b.items() if k.split(":")[0] not in types},
                                    **{k: v for k, v in agent.temperature_by_options.items() if k.split(":")[0] in types}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--keys", default="scorer,type_emb")
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    ap.add_argument("--l2sp", type=float, default=0.0)
    ap.add_argument("--eval-only", action="store_true", help="только оценить базовую модель на проверочной части")
    ap.add_argument("--distill", type=float, default=0.0, help="вес удержания ответов базовой модели на вопросах выбора")
    ap.add_argument("--balance", action="store_true", help="уравнять задачи в обучении повтором строк (не больше ×8)")
    a = ap.parse_args()
    keys = tuple(k.strip() for k in a.keys.split(",") if k.strip())
    lines = []

    def log(s):
        print(s, flush=True)
        lines.append(s)

    import laya

    torch.manual_seed(a.seed)
    revision = laya.PINNED_REVISIONS.get(MODEL)
    agent = laya.load(MODEL, device=a.device, revision=revision)
    rows = load_rows(a.data)
    tr, cal, te = split_by_group(rows, seed=a.seed)
    log(f"строк: {len(rows)} · обучение {len(tr)} · калибровка {len(cal)} · проверка {len(te)} · учим {', '.join(keys)} · {a.device}")
    enc = lambda part: encode_rows(agent, part)  # noqa: E731
    tr_i, cal_i, te_i = enc(tr), enc(cal), enc(te)
    for r, it in zip(tr, tr_i):
        it["keep"] = r["question"]["type"] != "noul"
    if a.balance:
        # общий scorer: без уравнивания «да/нет» (их больше всего) уводит выбор студии
        by_task = defaultdict(list)
        for r, it in zip(tr, tr_i):
            by_task[r["task"]].append(it)
        top = max(len(v) for v in by_task.values())
        tr_i = [it for v in by_task.values() for it in v * min(8, max(1, round(top / len(v))))]
        log("обучение после уравнивания: " + ", ".join(f"{t} ×{min(8, max(1, round(top / len(v))))}" for t, v in by_task.items()))

    base = metrics(agent, te, te_i)
    if a.eval_only:
        for t, m in sorted(base.items()):
            log(f"| {t} | {m['n']} | {m['logloss']:.3f} | {m['accuracy']:.0%} | {m['auto_correct']:.0%} | {m['auto_wrong']:.0%} | {m['cost']:.2f} |")
        return
    train(agent, keys, tr_i, cal_i, a.epochs, a.lr, a.batch, a.seed, log, a.l2sp, a.distill)
    calibrate(agent, cal, cal_i)
    tuned = metrics(agent, te, te_i)

    ok = True
    improved = False
    log("\n| задача | строк | log-loss: было → стало | точность | сама и верно | сама и ошиблась | цена | |\n|---|---|---|---|---|---|---|---|")
    for t in sorted(set(base) | set(tuned)):
        b, n = base[t], tuned[t]
        checked = b["n"] >= MIN_CHECKED
        # цена решений: вопросы + 6,7 × уверенные ошибки (из порога 0,85) — не дороже, и log-loss не хуже
        better = n["logloss"] <= b["logloss"] + 1e-6 and n["cost"] <= b["cost"] + 1e-6
        # «всегда спрашивать» стоит 1,0 — головы, которые почти ничего не решают сами, пользы не дают
        better = better and (n["cost"] < 0.95 or not checked)
        improved |= checked and better and n["cost"] < b["cost"] - 0.01
        ok &= better or not checked
        mark = "не проверено" if not checked else ("✓" if better else "хуже")
        log(f"| {t} | {b['n']} | {b['logloss']:.3f} → {n['logloss']:.3f} | {b['accuracy']:.0%} → {n['accuracy']:.0%} | {b['auto_correct']:.0%} → {n['auto_correct']:.0%} | {b['auto_wrong']:.0%} → {n['auto_wrong']:.0%} | {b['cost']:.2f} → {n['cost']:.2f} | {mark} |")

    report = "\n".join(lines) + "\n"
    if not ok or not improved:
        log("\nХуже базовой хотя бы по одной задаче — головы не сохранены." if not ok else "\nЗаметного улучшения нет — головы не сохранены.")
        print(report, file=open(os.path.join(os.path.dirname(a.data) or ".", "report.md"), "w"))
        sys.exit(2)
    meta = {"laya": laya.__version__, "model": MODEL, "revision": revision, "createdAt": datetime.date.today().isoformat(),
            "rows": {"train": len(tr), "calibration": len(cal), "test": len(te)}, "metrics": {"base": base, "tuned": tuned}}
    save_heads(agent.model, a.out, keys=keys + ("temperature",), meta=meta)
    agent.save_calibration(os.path.join(a.out, CALIBRATION))
    with open(os.path.join(a.out, "report.md"), "w") as f:
        f.write(report)
    log(f"\nГоловы сохранены в {a.out}")


if __name__ == "__main__":
    main()
