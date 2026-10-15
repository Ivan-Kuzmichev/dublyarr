"""Проба: логистическая регрессия поверх замороженной Laya — logit(p «да») базовой модели + эмбеддинг вопроса тем же энкодером.

  python probe.py --data data/combined.json [--task match] [--seeds 1,2,3]

Сама Laya не меняется (головы не учим — на наших объёмах они «схлопываются», issue #963 у авторов Laya).
Разбиение — по сериалам, как в train.py; сила L2 — по калибровочной части; веса классов — поровну.
Отчёт — по источникам строк: user (ответы пользователя) важнее всего — ровно то, что Laya видит в бою.
"""

import argparse
import hashlib
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np
import torch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "laya"))

from encode import encode_rows, logits_of, probs, split_by_group  # noqa: E402
from train import THRESHOLD, WRONG_COST, load_rows, MODEL  # noqa: E402
from probe_util import features, save_probe, text_of as _text_of  # noqa: E402


def text_of(row):
    return _text_of(row["state"], row["question"].get("instructions", ""))


def embed(agent, texts, cache):
    from laya.shortlist import embed_fn_from_agent

    if os.path.exists(cache):
        z = np.load(cache)
        if z.shape[0] == len(texts):
            return z
    z = np.asarray(embed_fn_from_agent(agent, max_length=512, batch_size=16)(texts), dtype=np.float32)
    np.save(cache, z)
    return z


def fit_lr(x, y, l2, steps=400):
    """Логистическая регрессия: веса классов поровну, L2, полный батч (LBFGS)."""
    xt, yt = torch.tensor(x), torch.tensor(y, dtype=torch.float32)
    pos = max(1.0, float(yt.sum()))
    neg = max(1.0, float(len(yt) - yt.sum()))
    wt = torch.where(yt > 0.5, len(yt) / (2 * pos), len(yt) / (2 * neg))
    w = torch.zeros(x.shape[1], requires_grad=True)
    b = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([w, b], max_iter=steps, line_search_fn="strong_wolfe")

    def closure():
        opt.zero_grad()
        z = xt @ w + b
        loss = (torch.nn.functional.binary_cross_entropy_with_logits(z, yt, weight=wt)) + l2 * (w[1:] ** 2).sum()
        loss.backward()
        return loss

    opt.step(closure)
    return w.detach().numpy(), float(b.detach())


def predict(x, wb):
    w, b = wb
    return 1 / (1 + np.exp(-(x @ w + b)))


def scores(p, y):
    """Как train.metrics для «да/нет»: сама решает только уверенное «да»."""
    n = len(y)
    if not n:
        return None
    p = np.clip(p, 1e-6, 1 - 1e-6)
    ll = float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))
    acc = float(np.mean((p >= 0.5) == (y > 0.5)))
    auto = p >= THRESHOLD
    ac = float(np.mean(auto & (y > 0.5)))
    aw = float(np.mean(auto & (y < 0.5)))
    return {"n": n, "logloss": ll, "accuracy": acc, "auto_correct": ac, "auto_wrong": aw, "cost": (1 - float(np.mean(auto))) + WRONG_COST * aw}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--task", default="match")
    ap.add_argument("--seeds", default="1,2,3")
    ap.add_argument("--save", help="сохранить надстройку (обучение на всём наборе) — например ../laya/probe/match.json")
    ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    a = ap.parse_args()

    import laya

    agent = laya.load(MODEL, device=a.device, revision=laya.PINNED_REVISIONS.get(MODEL))
    rows = [r for r in load_rows(a.data) if r["task"] == a.task and r["question"]["type"] == "noul"]
    # группа — по названию сериала из вопроса, а не по id: в ручной разметке id условные, и один сериал
    # (разметка + выгрузка с NAS) иначе попадал бы и в обучение, и в проверку
    for r in rows:
        st = r["state"] if isinstance(r["state"], dict) else {}
        name = str(st.get("сериал") or st.get("фильм") or r["group"]).split(",")[0].lower()
        r["group"] = "name:" + name
    y = np.array([1.0 if r["target"] is True else 0.0 for r in rows], dtype=np.float32)
    items = encode_rows(agent, rows)
    p_base = np.array([float(probs(agent, r, lg)[1]) for r, lg in zip(rows, logits_of(agent, items))], dtype=np.float32)
    tag = hashlib.sha1(json.dumps([text_of(r) for r in rows], ensure_ascii=False).encode()).hexdigest()[:12]
    emb = embed(agent, [text_of(r) for r in rows], os.path.join(os.path.dirname(a.data) or ".", f"emb-{tag}.npy"))
    # те же признаки, что в laya-serve (probe_util.features)
    x_full = np.array([features(float(p), e) for p, e in zip(p_base, emb)], dtype=np.float32)
    print(f"строк: {len(rows)} · да {int(y.sum())} · признаков {x_full.shape[1]}")

    total = defaultdict(lambda: defaultdict(list))
    cal_loss = defaultdict(list)  # L2 → калибровочный log-loss по разбиениям (для --save)
    for seed in [int(s) for s in a.seeds.split(",")]:
        idx = {id(r): i for i, r in enumerate(rows)}
        tr, cal, te = split_by_group(rows, seed=seed)
        it, ic, ie = ([idx[id(r)] for r in part] for part in (tr, cal, te))
        mu, sd = x_full[it].mean(0), x_full[it].std(0) + 1e-6
        x = (x_full - mu) / sd
        best = None
        for l2 in (1e-4, 1e-3, 1e-2, 3e-2, 1e-1):
            wb = fit_lr(x[it], y[it], l2)
            s = scores(predict(x[ic], wb), y[ic])
            if s:
                cal_loss[l2].append(s["logloss"])
            if s and (best is None or s["logloss"] < best[0]):
                best = (s["logloss"], l2, wb)
        _, l2, wb = best
        p_probe = predict(x, wb)
        print(f"\nразбиение {seed}: обучение {len(it)} · калибровка {len(ic)} · проверка {len(ie)} · L2 {l2}")
        print("| источник | строк | точность | сама и верно | сама и ошиблась | цена |\n|---|---|---|---|---|---|")
        for src in sorted({rows[i].get("source", "") for i in ie}) + ["всё"]:
            sel = [i for i in ie if src == "всё" or rows[i].get("source", "") == src]
            b, n = scores(p_base[sel], y[sel]), scores(p_probe[sel], y[sel])
            if not b:
                continue
            for k in ("accuracy", "auto_correct", "auto_wrong", "cost"):
                total[src][k].append((b[k], n[k], b["n"]))
            f = lambda k, fmt="{:.0%}": f"{fmt.format(b[k])} → {fmt.format(n[k])}"  # noqa: E731
            print(f"| {src} | {b['n']} | {f('accuracy')} | {f('auto_correct')} | {f('auto_wrong')} | {f('cost', '{:.2f}')} |")

    summary = {}
    print("\nвзвешенно по трём разбиениям:")
    print("| источник | строк | точность | сама и верно | сама и ошиблась | цена |\n|---|---|---|---|---|---|")
    for src, ks in total.items():
        n = sum(w for _, _, w in ks["accuracy"])
        avg = lambda k, j: sum(v[j] * v[2] for v in ks[k]) / n  # noqa: E731
        f = lambda k, fmt="{:.0%}": f"{fmt.format(avg(k, 0))} → {fmt.format(avg(k, 1))}"  # noqa: E731
        print(f"| {src} | {n} | {f('accuracy')} | {f('auto_correct')} | {f('auto_wrong')} | {f('cost', '{:.2f}')} |")
        summary[src] = {"n": n, **{k: {"base": round(avg(k, 0), 4), "probe": round(avg(k, 1), 4)} for k in ("accuracy", "auto_correct", "auto_wrong", "cost")}}

    if a.save:
        import datetime

        l2 = min(cal_loss, key=lambda k: sum(cal_loss[k]) / len(cal_loss[k]))
        mu, sd = x_full.mean(0), x_full.std(0) + 1e-6
        w, b = fit_lr((x_full - mu) / sd, y, l2)
        meta = {"task": a.task, "model": MODEL, "revision": laya.PINNED_REVISIONS.get(MODEL), "laya": laya.__version__,
                "createdAt": datetime.date.today().isoformat(), "rows": len(rows), "l2": l2, "metrics": summary}
        save_probe(a.save, w, b, mu, sd, meta)
        print(f"\nнадстройка сохранена: {a.save} · строк {len(rows)} · L2 {l2}")


if __name__ == "__main__":
    main()
