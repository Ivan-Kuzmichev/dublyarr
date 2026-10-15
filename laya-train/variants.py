"""Варианты формулировки вопросов «тот ли сериал» и финальной проверки — для сравнения на базовой Laya (--eval-only).

  python variants.py data/labeled.json   →  data/labeled-v1.json, data/labeled-v2.json

V1 — «да/нет» с описанием ответов и подписями A/B (README Laya: noul без описаний может идти за словами true/false).
V2 — выбор A/B с описаниями. Без отрицаний (README: отрицания ломают модель).
В строке `act` — вариант, при котором Dublyarr действует сам (уверенный «другой» и так уходит вопросом).
"""

import copy
import json
import re
import sys

MATCH = {
    "A": "Это раздача этого сериала: то же название, подходящие годы, сезоны и серии",
    "B": "Это другое произведение: другой сериал, фильм, ремейк, спин-офф или передача",
}
MATCH_MOVIE = {
    "A": "Это раздача этого фильма: то же название и год",
    "B": "Это другое произведение: другой фильм, сериал, ремейк или продолжение",
}


def final_desc(q):
    # «Это серия 5 сезона 4 сериала «X» в озвучке Y?» → что нужно и в какой озвучке
    m = re.match(r"Это (.+) (?:сериала|фильма) «.+» в озвучке (.+)\?$", q["instructions"])
    what, dub = (m.group(1), m.group(2)) if m else ("нужная серия", "нужная")
    return {
        "A": f"В раздаче есть {what} в озвучке {dub}",
        "B": f"В раздаче другие серии, другой сезон или другая озвучка",
    }


def variant(row, kind):
    if row["task"] not in ("match", "final"):
        return row
    r = copy.deepcopy(row)
    q = r["question"]
    if r["task"] == "match":
        crit = MATCH_MOVIE if "фильм" in q["instructions"] else MATCH
        instr = "Что это за раздача?"
    else:
        crit = final_desc(q)
        instr = "Что в этой раздаче?"
    yes = row["target"] is True
    if kind == "v1":
        r["question"] = {"type": "noul", "instructions": instr, "criteria": {"true": crit["A"], "false": crit["B"]}, "labels": {"true": "A", "false": "B"}}
    else:
        r["question"] = {"type": "choice", "instructions": instr, "criteria": crit}
        r["target"] = "A" if yes else "B"
        r["act"] = "A"
    return r


if __name__ == "__main__":
    src = sys.argv[1]
    rows = json.load(open(src))["rows"]
    for kind in ("v1", "v2"):
        out = src.replace(".json", f"-{kind}.json")
        json.dump({"rows": [variant(r, kind) for r in rows]}, open(out, "w"), ensure_ascii=False)
        print(out, len(rows))
