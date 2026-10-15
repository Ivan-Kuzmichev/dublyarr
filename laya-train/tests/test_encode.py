import numpy as np

from encode import encode_rows, logits_of, split_by_group, target_index

ROWS = [
    {"task": "match", "group": "tv:1", "state": {"сериал": "Тед Лассо (Ted Lasso), 2020", "раздача": "Ted Lasso / S4E1-10 of 10 [2026, WEB-DL 2160p]", "размер": "82 ГБ"},
     "question": {"type": "noul", "instructions": "Эта раздача — тот же сериал?"}, "target": True},
    {"task": "match", "group": "tv:2", "state": {"сериал": "Братья (Brothers), 2026", "раздача": "Action Brothers - [2010, DVD5]", "размер": "2,4 ГБ"},
     "question": {"type": "noul", "instructions": "Эта раздача — тот же сериал?"}, "target": False},
    {"task": "studio", "group": "LF", "state": {"раздача": "Reacher S04E01 MVO (LF)", "трекер": "RuTracker", "подпись": "LF"},
     "question": {"type": "choice", "instructions": "Какая студия озвучки скрывается за подписью «LF»?", "criteria": {"LostFilm": "LostFilm, LF", "HDrezka Studio": "HDrezka Studio", "новая": "этой студии нет в списке"}}, "target": "LostFilm"},
]


def test_logits_match_agent_before_training(agent):
    """Кодирование скрипта = боевое: до обучения вероятности совпадают с agent.system_one."""
    items = encode_rows(agent, ROWS)
    raw = logits_of(agent, items)
    for row, logits in zip(ROWS, raw):
        ans = agent.system_one(row["state"], {"q": row["question"]})["answers"]["q"]
        if row["question"]["type"] == "noul":
            mine = agent_probs(agent, row, logits)[1]
            assert abs(mine - ans["noul"]) < 2e-3
        else:
            mine = agent_probs(agent, row, logits)
            want = [ans["probabilities"][k] for k in row["question"]["criteria"]]
            assert np.allclose(mine, want, atol=2e-3)


def agent_probs(agent, row, logits):
    from encode import probs

    return probs(agent, row, logits)


def test_target_index():
    assert target_index(ROWS[0]) == 1  # «да» — второй вариант (false, true)
    assert target_index(ROWS[1]) == 0
    assert target_index(ROWS[2]) == 0


def test_split_by_group_no_leak():
    rows = [{"group": f"g{i % 50}", "task": "match"} for i in range(1000)]
    train, cal, test = split_by_group(rows, seed=1)
    groups = lambda part: {r["group"] for r in part}
    assert not groups(train) & groups(test) and not groups(cal) & groups(test) and not groups(train) & groups(cal)
    assert 0.08 < len(test) / len(rows) < 0.35  # по сериалам точно 20 % не выйдет — около того
