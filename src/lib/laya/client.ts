import { logger } from '../log';

const llog = logger('laya');
// Клиент laya-serve (127.0.0.1): вопросы «выбор» и «да/нет». Любой сбой — null: решение по правилам.

export type LayaHealth = { status: 'downloading' | 'loading' | 'ready' | 'error'; runtime?: 'torch' | 'stub'; laya?: string; model?: string; error?: string };
export type Question = { type: 'choice'; instructions: string; criteria: Record<string, string> } | { type: 'noul'; instructions: string };
export type Answer = { choice?: string; probabilities?: Record<string, number>; noul?: number };
export type AskResult = { answers: Record<string, Answer>; ms: number };

// всего ждём ответ 30 с: до 20 с в очереди laya-serve (вопросы — по одному) + до 10 с на сам ответ
const TIMEOUT_MS = 30_000;
const ANSWER_MS = 10_000;
const PAUSE_AFTER = 3; // таймаутов подряд
const PAUSE_MS = 10 * 60_000;

export function createLayaClient(o: { port: number; fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number }) {
  const f = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now;
  const base = `http://127.0.0.1:${o.port}`;
  let timeouts = 0;
  let pausedUntil = 0;
  let lastMs: number | null = null;
  return {
    async health(): Promise<LayaHealth | null> {
      try {
        const r = await f(`${base}/health`, { signal: AbortSignal.timeout(3000) });
        return r.ok ? ((await r.json()) as LayaHealth) : null;
      } catch {
        return null;
      }
    },
    async ask(state: unknown, questions: Record<string, Question>): Promise<AskResult | null> {
      if (now() < pausedUntil) return null;
      try {
        const r = await f(`${base}/ask`, { method: 'POST', body: JSON.stringify({ state, questions, maxWaitMs: Math.max(0, (o.timeoutMs ?? TIMEOUT_MS) - ANSWER_MS) }), signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS) });
        // 503 «занята» (долго в очереди) или «загружает модель» — не зависание: паузы не будет
        timeouts = 0;
        if (!r.ok) return null;
        const body = (await r.json()) as AskResult;
        // ответ на каждый вопрос нужного типа — иначе не доверяем
        for (const [id, q] of Object.entries(questions)) {
          const a = body.answers?.[id];
          if (!a || (q.type === 'noul' ? typeof a.noul !== 'number' : typeof a.choice !== 'string')) return null;
        }
        lastMs = body.ms;
        llog.debug({ questions: Object.keys(questions), answers: body.answers, ms: body.ms }, 'laya ask');
        return body;
      } catch (e) {
        llog.warn({ questions: Object.keys(questions), err: e instanceof Error ? e.message : String(e) }, 'laya ask failed');
        if (e instanceof Error && /abort|timeout/i.test(`${e.name} ${e.message}`) && ++timeouts >= PAUSE_AFTER) {
          pausedUntil = now() + PAUSE_MS; // Laya «зависла» — не ждём её каждый раз
          timeouts = 0;
        }
        return null;
      }
    },
    last: () => lastMs,
  };
}

export type LayaClient = ReturnType<typeof createLayaClient>;

let shared: LayaClient | null = null;
/** Общий клиент процесса (порт из конфигурации). */
export function layaClient(): LayaClient {
  shared ??= createLayaClient({ port: Number(process.env.LAYA_PORT || 8765) });
  return shared;
}
