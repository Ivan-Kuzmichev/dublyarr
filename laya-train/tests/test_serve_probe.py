import serve


class FakeAgent:
    def system_one(self, st, questions):
        return {"answers": {qid: {"type": "noul", "noul": 0.3} for qid in questions}}


def test_probe_failure_falls_back_to_laya_answer_and_is_logged(monkeypatch, capsys):
    monkeypatch.setattr(serve, "agent", FakeAgent())
    monkeypatch.setattr(serve, "probes", {"match": {"w": [1.0], "b": 0.0, "mu": [0.0], "sd": [1.0]}})

    def broken(_texts):
        raise RuntimeError("encoder exploded")

    monkeypatch.setattr(serve, "embed", broken)
    out = serve.ask({"сериал": "X"}, {"q": {"type": "noul", "instructions": "Тот же?"}}, 5, {"q": "match"})
    assert out == {"q": {"noul": 0.3}}
    assert "encoder exploded" in capsys.readouterr().out


def test_probe_applies_when_working(monkeypatch):
    monkeypatch.setattr(serve, "agent", FakeAgent())
    monkeypatch.setattr(serve, "probes", {"match": {"w": [1.0, 0.0], "b": 0.0, "mu": [0.0, 0.0], "sd": [1.0, 1.0]}})
    monkeypatch.setattr(serve, "embed", lambda texts: [[1.0] for _ in texts])
    out = serve.ask({"сериал": "X"}, {"q": {"type": "noul", "instructions": "Тот же?"}}, 5, {"q": "match"})
    assert out["q"]["base"] == 0.3 and abs(out["q"]["noul"] - 0.3) < 1e-3
