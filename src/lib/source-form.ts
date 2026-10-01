export type SourceInput = { name: string; url: string; apiKey: string; timeoutMs: number };

export function parseSourceForm(form: FormData): SourceInput | { error: string } {
  const url = String(form.get('url') ?? '').trim();
  if (!/^https?:\/\/\S+$/.test(url) || !URL.canParse(url)) return { error: 'Адрес — http(s)://…' };
  const sec = Number(form.get('timeout') ?? 15);
  if (!Number.isFinite(sec) || sec < 3 || sec > 60) return { error: 'Таймаут — от 3 до 60 с' };
  return { name: String(form.get('name') ?? '').trim() || 'Jackett', url, apiKey: String(form.get('apiKey') ?? '').trim(), timeoutMs: Math.round(sec * 1000) };
}
