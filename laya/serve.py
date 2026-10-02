"""laya-serve для Dublyarr: многоязычная модель Laya отвечает на вопросы (выбор / да-нет), текст не генерирует.

Модель скачивается при первом запуске в $LAYA_DIR/base (ревизия закреплена), работает на CPU (PyTorch).
Пока модель скачивается или загружается, /ask отвечает 503 — Dublyarr решает по правилам.
LAYA_STUB=1 — без модели: предсказуемые ответы для тестов и разработки.

GET  /health -> {"status": "downloading|loading|ready|error", "runtime", "laya", "model", "error"?}
POST /ask    {"state": ..., "questions": {...}} -> {"answers": {id: {"choice", "probabilities"} | {"noul"}}, "ms"}
"""
import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get("LAYA_MODEL", "convaiinnovations/laya-multilingual")
STUB = os.environ.get("LAYA_STUB") == "1"
LAYA_DIR = os.environ.get("LAYA_DIR", "/data/laya")
RETRY_AFTER_ERROR = 3600

state = {"status": "loading", "runtime": None, "laya": None, "model": None, "error": None}
agent = None
ask_lock = threading.Lock()  # один вопрос за раз: CPU NAS и память


def stub_answers(st, questions):
    """Предсказуемо и «безвредно» для сценариев без Laya: финальная проверка — уверенное «да»,
    «тот ли сериал» — не уверена (вопрос остаётся пользователю), «какая студия» — «новая»."""
    out = {}
    for qid, q in questions.items():
        if q.get("type") == "choice":
            keys = list(q.get("criteria", {}).keys())
            pick = "новая" if "новая" in keys else keys[0]
            p = 0.9 if pick == "новая" else 0.5
            rest = (1 - p) / (len(keys) - 1) if len(keys) > 1 else 0
            out[qid] = {"choice": pick, "probabilities": {k: (p if k == pick else rest) for k in keys}}
        else:
            final = "в озвучке" in q.get("instructions", "")
            out[qid] = {"noul": 0.95 if final else 0.5}
    return out


def load_model():
    """Скачать (если нужно) и загрузить модель; при ошибке — повтор через час."""
    global agent
    while True:
        try:
            os.environ.setdefault("HF_HOME", os.path.join(LAYA_DIR, "base"))
            import laya
            from huggingface_hub import snapshot_download

            revision = laya.PINNED_REVISIONS.get(MODEL)
            state.update(status="downloading", laya=laya.__version__, model=f"{MODEL}@{(revision or 'main')[:12]}", error=None)
            snapshot_download(MODEL, revision=revision)
            state["status"] = "loading"
            import torch

            torch.set_num_threads(max(1, os.cpu_count() or 1))
            agent = laya.load(MODEL, device="cpu", revision=revision)
            state.update(status="ready", runtime="torch")
            return
        except Exception as e:  # сеть, диск, несовместимость — без Laya всё работает
            state.update(status="error", error=str(e)[:300])
            time.sleep(RETRY_AFTER_ERROR)


class Busy(Exception):
    """Вопрос простоял в очереди дольше, чем клиент готов ждать: считать незачем."""


def ask(st, questions, max_wait):
    if STUB:
        return stub_answers(st, questions)
    if not ask_lock.acquire(timeout=max(0.0, max_wait)):
        raise Busy()
    try:
        r = agent.system_one(st, questions)
    finally:
        ask_lock.release()
    out = {}
    for qid, a in r["answers"].items():
        if a.get("type") == "choice":
            out[qid] = {"choice": a["choice"], "probabilities": a["probabilities"]}
        elif a.get("type") == "noul":
            out[qid] = {"noul": a["noul"]}
        else:
            out[qid] = {"score": a.get("score"), "probabilities": a.get("probabilities")}
    return out


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            # клиент перестал ждать — одна строка в журнал вместо трассировки
            print(json.dumps({"level": 30, "area": "laya", "msg": "клиент не дождался ответа"}, ensure_ascii=False), flush=True)

    def do_GET(self):
        if self.path == "/health":
            return self.send(200, {k: v for k, v in state.items() if v is not None})
        self.send(404, {})

    def do_POST(self):
        if self.path != "/ask":
            return self.send(404, {})
        if state["status"] != "ready":
            return self.send(503, {"error": state["status"]})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            max_wait = float(body.get("maxWaitMs", 20000)) / 1000
            t = time.time()
            answers = ask(body["state"], body["questions"], max_wait)
            self.send(200, {"answers": answers, "ms": round((time.time() - t) * 1000)})
        except Busy:
            self.send(503, {"error": "busy"})
        except Exception as e:
            self.send(400, {"error": str(e)[:300]})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    port = parser.parse_args().port
    if STUB:
        state.update(status="ready", runtime="stub", laya="stub", model="stub")
    else:
        threading.Thread(target=load_model, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
