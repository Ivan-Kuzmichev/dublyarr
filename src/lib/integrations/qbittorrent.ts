export type QbitConfig = { url: string; username: string; password: string };
type Result = { ok: true; version: string } | { ok: false; error: string };

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Проверка подключения к qBittorrent WebAPI v2: вход и запрос версии. */
export async function checkQbittorrent(cfg: QbitConfig, fetchImpl: typeof fetch = fetch): Promise<Result> {
  const base = cfg.url.trim().replace(/\/+$/, '');
  try {
    const login = await fetchImpl(`${base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: base },
      body: new URLSearchParams({ username: cfg.username, password: cfg.password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (login.status === 403) return { ok: false, error: 'IP заблокирован qBittorrent после неудачных входов' };
    const text = (await login.text()).trim();
    const sid = /SID=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1];
    if (text !== 'Ok.' || !sid) return { ok: false, error: 'Неверный логин или пароль qBittorrent' };
    const v = await fetchImpl(`${base}/api/v2/app/version`, { headers: { Cookie: `SID=${sid}` }, signal: AbortSignal.timeout(10_000) });
    if (!v.ok) return { ok: false, error: `qBittorrent не отвечает: HTTP ${v.status}` };
    return { ok: true, version: (await v.text()).trim() };
  } catch (e) {
    return { ok: false, error: `qBittorrent не отвечает: ${reason(e)}` };
  }
}
